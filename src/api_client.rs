//! HTTP API client for the klaas backend.
//!
//! This module provides an HTTP client for making authenticated API calls
//! to the klaas backend service. It handles session management and
//! other API operations.
//!
//! # Example
//!
//! ```ignore
//! use klaas::api_client::ApiClient;
//! use klaas::config::API_URL;
//!
//! let client = ApiClient::new(API_URL, "access_token_here");
//! let sessions = client.get_sessions().await?;
//! ```

use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;
use tracing::debug;

use crate::billing_error::BillingError;
use crate::error::{CliError, Result};

/// Converts a non-success HTTP response into a [`CliError`].
///
/// Thin async wrapper around [`classify_http_error`] that consumes the
/// body. When the status is 402 or 403 and the body parses as a
/// billing-gate payload (`code: 'feature_gate' | 'trial_expired'`),
/// returns [`CliError::Billing`]. Otherwise falls back to
/// [`CliError::NetworkError`] with the raw body so the caller still gets
/// actionable diagnostics.
pub(crate) async fn error_from_response(response: Response, api_base_url: &str) -> CliError {
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "Unknown error".to_string());
    classify_http_error(status, &body, api_base_url)
}

/// Pure status/body classifier. Separated from [`error_from_response`]
/// so it can be unit-tested without building a `reqwest::Response`.
///
/// `api_base_url` is forwarded to [`BillingError::from_json`] so relative
/// `upgrade_url` values are normalised against the API host.
fn classify_http_error(status: StatusCode, body: &str, api_base_url: &str) -> CliError {
    if matches!(status, StatusCode::PAYMENT_REQUIRED | StatusCode::FORBIDDEN) {
        if let Some(billing) = BillingError::from_json(body, api_base_url) {
            debug!(
                status = %status,
                code = %billing.code,
                "Detected billing error in HTTP response"
            );
            return CliError::Billing(billing);
        }
    }

    CliError::NetworkError(format!("API request failed ({}): {}", status, body))
}

/// Session data returned by the API.
///
/// Represents a klaas session with its metadata and current state.
/// Sessions track CLI connections and allow remote access via the dashboard.
#[derive(Debug, Clone, Deserialize)]
pub struct Session {
    /// Unique session identifier (ULID format).
    pub session_id: String,

    /// Device identifier that created this session (ULID format).
    pub device_id: String,

    /// Human-readable name of the device.
    pub device_name: String,

    /// Optional custom name for the session.
    pub name: Option<String>,

    /// Current session status: "attached" or "detached".
    pub status: String,

    /// ISO 8601 timestamp when the session was started.
    pub started_at: String,

    /// ISO 8601 timestamp when the session was last attached (if any).
    pub attached_at: Option<String>,

    /// Current working directory of the session.
    pub cwd: String,
}

/// API response wrapper for session list.
#[derive(Debug, Deserialize)]
struct SessionsResponse {
    /// List of sessions.
    sessions: Vec<Session>,
}

/// API response wrapper for single session.
#[derive(Debug, Deserialize)]
struct SessionResponse {
    /// The session data.
    session: Session,
}

/// HTTP client for the klaas API.
///
/// Provides methods for interacting with the klaas backend API,
/// including session management operations.
///
/// # Example
///
/// ```ignore
/// let client = ApiClient::new("https://api.klaas.sh", "your_token");
/// let sessions = client.get_sessions().await?;
/// ```
#[derive(Debug, Clone)]
pub struct ApiClient {
    /// Base URL for the API (e.g., "https://api.klaas.sh").
    base_url: String,

    /// JWT access token for authentication.
    access_token: String,

    /// Underlying HTTP client.
    client: Client,
}

impl ApiClient {
    /// Creates a new API client.
    ///
    /// # Arguments
    ///
    /// * `base_url` - Base URL of the API (e.g., "https://api.klaas.sh")
    /// * `access_token` - JWT access token for authentication
    ///
    /// # Returns
    ///
    /// A new `ApiClient` instance configured with the provided credentials.
    pub fn new(base_url: &str, access_token: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            access_token: access_token.to_string(),
            client: Client::new(),
        }
    }

    /// Fetches all sessions for the authenticated user.
    ///
    /// Calls `GET /sessions` and returns the list of sessions
    /// associated with the current user's account.
    ///
    /// # Returns
    ///
    /// A vector of `Session` objects on success.
    ///
    /// # Errors
    ///
    /// Returns `CliError::NetworkError` if the request fails or
    /// the response cannot be parsed.
    pub async fn get_sessions(&self) -> Result<Vec<Session>> {
        let url = format!("{}/sessions", self.base_url);

        debug!(url = %url, "Fetching sessions");

        let response = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| CliError::NetworkError(format!("Failed to fetch sessions: {}", e)))?;

        if !response.status().is_success() {
            return Err(error_from_response(response, &self.base_url).await);
        }

        let data: SessionsResponse = response.json().await.map_err(|e| {
            CliError::NetworkError(format!("Failed to parse sessions response: {}", e))
        })?;

        debug!(count = data.sessions.len(), "Fetched sessions");

        Ok(data.sessions)
    }

    /// Fetches a single session by its identifier.
    ///
    /// Calls `GET /sessions/:identifier` where the identifier can be
    /// either a session ID (ULID) or a session name.
    ///
    /// # Arguments
    ///
    /// * `identifier` - Session ID (ULID) or session name
    ///
    /// # Returns
    ///
    /// - `Ok(Some(session))` if the session exists
    /// - `Ok(None)` if the session is not found (404)
    /// - `Err(...)` if the request fails
    ///
    /// # Errors
    ///
    /// Returns `CliError::NetworkError` if the request fails (except 404)
    /// or the response cannot be parsed.
    pub async fn get_session(&self, identifier: &str) -> Result<Option<Session>> {
        let url = format!("{}/sessions/{}", self.base_url, identifier);

        debug!(url = %url, identifier = %identifier, "Fetching session");

        let response = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| CliError::NetworkError(format!("Failed to fetch session: {}", e)))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            debug!(identifier = %identifier, "Session not found");
            return Ok(None);
        }

        if !response.status().is_success() {
            return Err(error_from_response(response, &self.base_url).await);
        }

        let data: SessionResponse = response.json().await.map_err(|e| {
            CliError::NetworkError(format!("Failed to parse session response: {}", e))
        })?;

        debug!(session_id = %data.session.session_id, "Fetched session");

        Ok(Some(data.session))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_client_new() {
        let client = ApiClient::new("https://api.klaas.sh/", "test_token");

        // Base URL should have trailing slash removed
        assert_eq!(client.base_url, "https://api.klaas.sh");
        assert_eq!(client.access_token, "test_token");
    }

    #[test]
    fn test_api_client_new_no_trailing_slash() {
        let client = ApiClient::new("https://api.klaas.sh", "test_token");

        assert_eq!(client.base_url, "https://api.klaas.sh");
    }

    #[test]
    fn test_session_deserialization() {
        let json = r#"{
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "device_id": "01HQXK8V8G3N5M2R4P6T1W9Y0A",
            "device_name": "MacBook Pro",
            "name": "my-session",
            "status": "attached",
            "started_at": "2024-01-15T10:30:00Z",
            "attached_at": "2024-01-15T10:31:00Z",
            "cwd": "/Users/bjorn/projects"
        }"#;

        let session: Session = serde_json::from_str(json).unwrap();

        assert_eq!(session.session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
        assert_eq!(session.device_id, "01HQXK8V8G3N5M2R4P6T1W9Y0A");
        assert_eq!(session.device_name, "MacBook Pro");
        assert_eq!(session.name, Some("my-session".to_string()));
        assert_eq!(session.status, "attached");
        assert_eq!(session.started_at, "2024-01-15T10:30:00Z");
        assert_eq!(
            session.attached_at,
            Some("2024-01-15T10:31:00Z".to_string())
        );
        assert_eq!(session.cwd, "/Users/bjorn/projects");
    }

    #[test]
    fn test_session_deserialization_minimal() {
        let json = r#"{
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "device_id": "01HQXK8V8G3N5M2R4P6T1W9Y0A",
            "device_name": "MacBook Pro",
            "name": null,
            "status": "detached",
            "started_at": "2024-01-15T10:30:00Z",
            "attached_at": null,
            "cwd": "/home/user"
        }"#;

        let session: Session = serde_json::from_str(json).unwrap();

        assert_eq!(session.session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
        assert_eq!(session.name, None);
        assert_eq!(session.status, "detached");
        assert_eq!(session.attached_at, None);
    }

    #[test]
    fn test_sessions_response_deserialization() {
        let json = r#"{
            "sessions": [
                {
                    "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
                    "device_id": "01HQXK8V8G3N5M2R4P6T1W9Y0A",
                    "device_name": "MacBook Pro",
                    "name": null,
                    "status": "attached",
                    "started_at": "2024-01-15T10:30:00Z",
                    "attached_at": null,
                    "cwd": "/home/user"
                }
            ]
        }"#;

        let response: SessionsResponse = serde_json::from_str(json).unwrap();

        assert_eq!(response.sessions.len(), 1);
        assert_eq!(
            response.sessions[0].session_id,
            "01HQXK7V8G3N5M2R4P6T1W9Y0Z"
        );
    }

    #[test]
    fn test_classify_http_error_detects_feature_gate_403() {
        let body = r#"{
            "code": "feature_gate",
            "feature_id": "sessions.limit",
            "upgrade_url": "https://klaas.sh/settings/billing",
            "message": "Session limit reached."
        }"#;
        let err = classify_http_error(StatusCode::FORBIDDEN, body, "https://api.klaas.sh");

        match err {
            CliError::Billing(b) => {
                assert_eq!(b.code, "feature_gate");
                assert_eq!(b.message, "Session limit reached.");
                assert_eq!(
                    b.upgrade_url.as_deref(),
                    Some("https://klaas.sh/settings/billing")
                );
            }
            other => panic!("expected Billing, got {:?}", other),
        }
    }

    #[test]
    fn test_classify_http_error_detects_trial_expired_402() {
        let body = r#"{"code":"trial_expired","message":"trial ended"}"#;
        let err = classify_http_error(StatusCode::PAYMENT_REQUIRED, body, "https://api.klaas.sh");
        assert!(matches!(err, CliError::Billing(_)));
    }

    #[test]
    fn test_classify_http_error_normalises_relative_upgrade_url() {
        // When the 403 body carries `/settings/billing`, it must be
        // prepended with the configured API host so the CLI prints a
        // working link.
        let body = r#"{
            "code": "feature_gate",
            "upgrade_url": "/settings/billing",
            "message": "gated"
        }"#;
        let err = classify_http_error(StatusCode::FORBIDDEN, body, "https://api.klaas.sh");
        match err {
            CliError::Billing(b) => assert_eq!(
                b.upgrade_url.as_deref(),
                Some("https://api.klaas.sh/settings/billing")
            ),
            other => panic!("expected Billing, got {:?}", other),
        }
    }

    #[test]
    fn test_classify_http_error_falls_back_on_non_billing_403() {
        let body = r#"{"code":"forbidden","message":"no"}"#;
        let err = classify_http_error(StatusCode::FORBIDDEN, body, "https://api.klaas.sh");
        assert!(matches!(err, CliError::NetworkError(_)));
    }

    #[test]
    fn test_classify_http_error_non_402_or_403_never_billing() {
        // Even with a billing-shaped body, 500 is not a gate response.
        let body = r#"{"code":"feature_gate","message":"x"}"#;
        let err = classify_http_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            body,
            "https://api.klaas.sh",
        );
        assert!(matches!(err, CliError::NetworkError(_)));
    }

    #[test]
    fn test_classify_http_error_handles_plain_text_body() {
        let err = classify_http_error(
            StatusCode::FORBIDDEN,
            "Not authorised",
            "https://api.klaas.sh",
        );
        assert!(matches!(err, CliError::NetworkError(_)));
    }

    #[test]
    fn test_session_response_deserialization() {
        let json = r#"{
            "session": {
                "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
                "device_id": "01HQXK8V8G3N5M2R4P6T1W9Y0A",
                "device_name": "MacBook Pro",
                "name": "test-session",
                "status": "attached",
                "started_at": "2024-01-15T10:30:00Z",
                "attached_at": "2024-01-15T10:31:00Z",
                "cwd": "/home/user"
            }
        }"#;

        let response: SessionResponse = serde_json::from_str(json).unwrap();

        assert_eq!(response.session.session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
        assert_eq!(response.session.name, Some("test-session".to_string()));
    }
}
