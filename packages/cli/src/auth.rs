//! OAuth Device Flow authentication for Klaas CLI.
//!
//! Implements RFC 8628 OAuth 2.0 Device Authorization Grant.
//! The flow:
//! 1. CLI calls POST /auth/device to get device_code and user_code
//! 2. User visits verification_uri and enters user_code
//! 3. CLI polls POST /auth/token with device_code until authorized
//! 4. On success, CLI receives access_token and refresh_token

use std::time::Instant;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, info, warn};

use crate::ui::{self, WaitingAnimation};

/// Errors that can occur during authentication.
#[derive(Error, Debug)]
pub enum AuthError {
    /// HTTP request failed.
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    /// Server returned an error response.
    #[error("Server error: {0}")]
    ServerError(String),

    /// Device code expired before user completed authorization.
    #[error("Device code expired. Please restart the authentication flow.")]
    ExpiredToken,

    /// Authorization is still pending (internal use during polling).
    #[error("Authorization pending")]
    AuthorizationPending,

    /// Client is polling too fast (should slow down).
    #[error("Polling too fast, slowing down")]
    SlowDown,

    /// Access denied by user or server.
    #[error("Access denied: {0}")]
    AccessDenied(String),

    /// Invalid refresh token.
    #[error("Invalid or expired refresh token")]
    InvalidGrant,

    /// Unsupported grant type.
    #[error("Unsupported grant type")]
    UnsupportedGrantType,

    /// Failed to parse server response.
    #[error("Failed to parse response: {0}")]
    ParseError(String),
}

/// Result type for authentication operations.
pub type AuthResult<T> = Result<T, AuthError>;

/// Response from POST /auth/device endpoint.
///
/// Contains all information needed to complete the device authorization flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceFlowResponse {
    /// Unique device code for polling the token endpoint.
    pub device_code: String,

    /// User-facing code to enter on the verification page (e.g., "ABCD-1234").
    pub user_code: String,

    /// URL where the user should enter the code.
    pub verification_uri: String,

    /// Optional complete URL with the code pre-filled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_uri_complete: Option<String>,

    /// Seconds until the device code expires.
    pub expires_in: u64,

    /// Minimum polling interval in seconds.
    pub interval: u64,
}

/// Response from POST /auth/token and POST /auth/refresh endpoints.
///
/// Contains the tokens needed for API authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    /// JWT access token for API requests.
    pub access_token: String,

    /// Token type (always "Bearer").
    #[serde(default = "default_token_type")]
    pub token_type: String,

    /// Seconds until the access token expires.
    pub expires_in: u64,

    /// Refresh token for obtaining new access tokens.
    pub refresh_token: String,
}

/// Default token type if not specified in response.
fn default_token_type() -> String {
    "Bearer".to_string()
}

/// Error response from the OAuth server.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OAuthErrorResponse {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

/// Request body for the token endpoint.
#[derive(Debug, Serialize)]
struct TokenRequest {
    device_code: String,
    grant_type: String,
}

/// Request body for the refresh endpoint.
#[derive(Debug, Serialize)]
struct RefreshRequest {
    refresh_token: String,
}

/// Starts the OAuth Device Flow by requesting a device code.
///
/// # Arguments
///
/// * `api_url` - Base URL of the Klaas API (e.g., "https://api.klaas.sh")
///
/// # Returns
///
/// * `DeviceFlowResponse` containing the device code and user instructions
///
/// # Example
///
/// ```ignore
/// let response = start_device_flow("https://api.klaas.sh").await?;
/// println!("Visit: {} and enter: {}", response.verification_uri, response.user_code);
/// ```
pub async fn start_device_flow(api_url: &str) -> AuthResult<DeviceFlowResponse> {
    let url = format!("{}/auth/device", api_url.trim_end_matches('/'));
    debug!("Starting device flow at {}", url);

    let client = reqwest::Client::new();
    let response = client.post(&url).send().await?;

    if response.status().is_success() {
        let device_response: DeviceFlowResponse = response.json().await?;
        debug!(
            "Device flow started, code expires in {} seconds",
            device_response.expires_in
        );
        Ok(device_response)
    } else {
        let error_text = response.text().await.unwrap_or_default();
        Err(AuthError::ServerError(error_text))
    }
}

/// Polls the token endpoint until the user completes authorization.
///
/// Displays a spinner and status messages while waiting for the user.
///
/// # Arguments
///
/// * `api_url` - Base URL of the Klaas API
/// * `device_code` - The device code from `start_device_flow`
/// * `interval` - Initial polling interval in seconds
/// * `expires_in` - Seconds until the device code expires
///
/// # Returns
///
/// * `TokenResponse` containing access and refresh tokens
///
/// # Example
///
/// ```ignore
/// let tokens = poll_for_token(
///     "https://api.klaas.sh",
///     &device_response.device_code,
///     device_response.interval,
///     device_response.expires_in,
/// ).await?;
/// ```
pub async fn poll_for_token(
    api_url: &str,
    device_code: &str,
    interval: u64,
    expires_in: u64,
) -> AuthResult<TokenResponse> {
    let url = format!("{}/auth/token", api_url.trim_end_matches('/'));
    let client = reqwest::Client::new();

    let start_time = Instant::now();
    let expiry_duration = std::time::Duration::from_secs(expires_in);
    let mut current_interval_secs = interval;
    let animation_interval = ui::animation_interval();
    let mut animation = WaitingAnimation::new();
    let mut ticks_until_poll = 0u64;

    debug!(
        "Polling for token at {}, interval: {}s, expires in: {}s",
        url, interval, expires_in
    );

    loop {
        // Check if the device code has expired
        if start_time.elapsed() >= expiry_duration {
            animation.clear();
            return Err(AuthError::ExpiredToken);
        }

        // Render animation frame
        animation.render_frame();

        // Wait for animation interval
        tokio::time::sleep(animation_interval).await;

        // Count ticks until next poll (animation runs faster than polling)
        let ticks_per_poll = (current_interval_secs * 1000) / animation_interval.as_millis() as u64;
        ticks_until_poll += 1;

        if ticks_until_poll < ticks_per_poll {
            continue;
        }
        ticks_until_poll = 0;

        // Make the token request
        let request = TokenRequest {
            device_code: device_code.to_string(),
            grant_type: "urn:ietf:params:oauth:grant-type:device_code".to_string(),
        };

        let response = client.post(&url).json(&request).send().await?;

        if response.status().is_success() {
            animation.clear();
            ui::display_auth_success();
            let token_response: TokenResponse = response.json().await?;
            info!("Successfully obtained tokens");
            return Ok(token_response);
        }

        // Parse error response
        let error_response: OAuthErrorResponse = response
            .json()
            .await
            .map_err(|e| AuthError::ParseError(e.to_string()))?;

        match error_response.error.as_str() {
            "authorization_pending" => {
                // User has not yet completed authorization, continue polling
                debug!("Authorization pending, continuing to poll...");
                continue;
            }
            "slow_down" => {
                // Increase polling interval by 5 seconds
                current_interval_secs += 5;
                warn!(
                    "Server requested slow down, new interval: {}s",
                    current_interval_secs
                );
                continue;
            }
            "expired_token" => {
                animation.clear();
                return Err(AuthError::ExpiredToken);
            }
            "access_denied" => {
                animation.clear();
                return Err(AuthError::AccessDenied(
                    error_response
                        .error_description
                        .unwrap_or_else(|| "User denied access".to_string()),
                ));
            }
            _ => {
                animation.clear();
                return Err(AuthError::ServerError(format!(
                    "{}: {}",
                    error_response.error,
                    error_response.error_description.unwrap_or_default()
                )));
            }
        }
    }
}

/// Refreshes an expired access token using a refresh token.
///
/// # Arguments
///
/// * `api_url` - Base URL of the Klaas API
/// * `refresh_token` - The refresh token from a previous authentication
///
/// # Returns
///
/// * `TokenResponse` containing new access and refresh tokens
///
/// # Example
///
/// ```ignore
/// let new_tokens = refresh_token("https://api.klaas.sh", &old_refresh_token).await?;
/// ```
pub async fn refresh_token(api_url: &str, refresh_token: &str) -> AuthResult<TokenResponse> {
    let url = format!("{}/auth/refresh", api_url.trim_end_matches('/'));
    debug!("Refreshing token at {}", url);

    let client = reqwest::Client::new();
    let request = RefreshRequest {
        refresh_token: refresh_token.to_string(),
    };

    let response = client.post(&url).json(&request).send().await?;

    if response.status().is_success() {
        let token_response: TokenResponse = response.json().await?;
        info!("Successfully refreshed tokens");
        Ok(token_response)
    } else {
        let error_response: OAuthErrorResponse = response
            .json()
            .await
            .map_err(|e| AuthError::ParseError(e.to_string()))?;

        match error_response.error.as_str() {
            "invalid_grant" => Err(AuthError::InvalidGrant),
            _ => Err(AuthError::ServerError(format!(
                "{}: {}",
                error_response.error,
                error_response.error_description.unwrap_or_default()
            ))),
        }
    }
}

/// Displays user-friendly instructions for the device flow.
///
/// # Arguments
///
/// * `response` - The device flow response containing verification details
pub fn display_auth_instructions(response: &DeviceFlowResponse) {
    ui::display_auth_instructions(
        &response.verification_uri,
        &response.user_code,
        response.verification_uri_complete.as_deref(),
        response.expires_in / 60,
    );
}

/// Performs the complete device flow authentication.
///
/// This is a convenience function that combines all steps:
/// 1. Starts the device flow
/// 2. Displays instructions to the user
/// 3. Polls for token completion
///
/// # Arguments
///
/// * `api_url` - Base URL of the Klaas API
///
/// # Returns
///
/// * `TokenResponse` containing access and refresh tokens
///
/// # Example
///
/// ```ignore
/// let tokens = authenticate("https://api.klaas.sh").await?;
/// println!("Authenticated! Access token: {}", tokens.access_token);
/// ```
pub async fn authenticate(api_url: &str) -> AuthResult<TokenResponse> {
    // Display startup banner
    ui::display_startup_banner();

    // Start the device flow
    let device_response = start_device_flow(api_url).await?;

    // Display instructions to the user
    display_auth_instructions(&device_response);

    // Poll for token
    poll_for_token(
        api_url,
        &device_response.device_code,
        device_response.interval,
        device_response.expires_in,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_flow_response_deserialize() {
        let json = r#"{
            "device_code": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "user_code": "ABCD-1234",
            "verification_uri": "https://klaas.sh/device",
            "expires_in": 600,
            "interval": 5
        }"#;

        let response: DeviceFlowResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.device_code, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
        assert_eq!(response.user_code, "ABCD-1234");
        assert_eq!(response.verification_uri, "https://klaas.sh/device");
        assert_eq!(response.expires_in, 600);
        assert_eq!(response.interval, 5);
        assert!(response.verification_uri_complete.is_none());
    }

    #[test]
    fn test_device_flow_response_with_complete_uri() {
        let json = r#"{
            "device_code": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "user_code": "ABCD-1234",
            "verification_uri": "https://klaas.sh/device",
            "verification_uri_complete": "https://klaas.sh/device?code=ABCD-1234",
            "expires_in": 600,
            "interval": 5
        }"#;

        let response: DeviceFlowResponse = serde_json::from_str(json).unwrap();
        assert_eq!(
            response.verification_uri_complete,
            Some("https://klaas.sh/device?code=ABCD-1234".to_string())
        );
    }

    #[test]
    fn test_token_response_deserialize() {
        let json = r#"{
            "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": "refresh_abc123"
        }"#;

        let response: TokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(
            response.access_token,
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        );
        assert_eq!(response.token_type, "Bearer");
        assert_eq!(response.expires_in, 3600);
        assert_eq!(response.refresh_token, "refresh_abc123");
    }

    #[test]
    fn test_token_response_default_token_type() {
        let json = r#"{
            "access_token": "token",
            "expires_in": 3600,
            "refresh_token": "refresh"
        }"#;

        let response: TokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.token_type, "Bearer");
    }

    #[test]
    fn test_token_request_serialize() {
        let request = TokenRequest {
            device_code: "device_abc".to_string(),
            grant_type: "urn:ietf:params:oauth:grant-type:device_code".to_string(),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("device_code"));
        assert!(json.contains("device_abc"));
        assert!(json.contains("grant_type"));
    }

    #[test]
    fn test_refresh_request_serialize() {
        let request = RefreshRequest {
            refresh_token: "refresh_xyz".to_string(),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("refresh_token"));
        assert!(json.contains("refresh_xyz"));
    }

    #[test]
    fn test_auth_error_display() {
        let err = AuthError::ExpiredToken;
        assert!(err.to_string().contains("Device code expired"));

        let err = AuthError::InvalidGrant;
        assert!(err.to_string().contains("Invalid or expired refresh token"));

        let err = AuthError::AccessDenied("User cancelled".to_string());
        assert!(err.to_string().contains("User cancelled"));
    }
}
