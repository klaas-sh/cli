//! Configuration constants for the CLI.
//!
//! This module provides default configuration values and functions to load
//! configuration from environment variables. Environment variables take
//! precedence over defaults.

use std::env;

/// Default API base URL for remote services.
pub const DEFAULT_API_URL: &str = "https://api.nexo.dev";

/// Default WebSocket URL for real-time communication.
pub const DEFAULT_WS_URL: &str = "wss://api.nexo.dev/ws";

/// Keychain service name for credential storage.
pub const KEYCHAIN_SERVICE: &str = "dev.nexo.cli";

/// OAuth device flow timeout in seconds (15 minutes).
pub const AUTH_TIMEOUT_SECS: u64 = 900;

/// Command interception timeout in milliseconds.
/// If a potential command is not completed within this time,
/// the partial input forwards to Claude Code.
pub const COMMAND_TIMEOUT_MS: u64 = 2000;

/// Base delay for reconnection attempts in milliseconds.
pub const RECONNECT_BASE_DELAY_MS: u64 = 500;

/// Maximum delay between reconnection attempts in milliseconds.
pub const RECONNECT_MAX_DELAY_MS: u64 = 30_000;

/// Maximum number of reconnection attempts before giving up.
pub const RECONNECT_MAX_ATTEMPTS: u32 = 10;

/// Random jitter added to reconnection delays to prevent thundering herd.
pub const RECONNECT_JITTER_MS: u64 = 1000;

/// Maximum number of messages to queue during reconnection.
pub const MESSAGE_QUEUE_MAX_SIZE: usize = 100;

/// Maximum age of queued messages in seconds before they're dropped.
pub const MESSAGE_QUEUE_MAX_AGE_SECS: u64 = 300; // 5 minutes

/// Heartbeat interval in seconds.
pub const HEARTBEAT_INTERVAL_SECS: u64 = 30;

/// Session timeout on server side in seconds.
pub const SESSION_TIMEOUT_SECS: u64 = 30;

/// Default terminal width if detection fails.
pub const DEFAULT_TERMINAL_COLS: u16 = 80;

/// Default terminal height if detection fails.
pub const DEFAULT_TERMINAL_ROWS: u16 = 24;

/// Claude Code command name.
pub const CLAUDE_COMMAND: &str = "claude";

/// Runtime configuration loaded from environment variables.
#[derive(Debug, Clone)]
pub struct ApiConfig {
    /// API base URL (from NEXO_API_URL or default).
    pub api_url: String,
    /// WebSocket URL (from NEXO_WS_URL or derived from api_url).
    pub ws_url: String,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self::from_env()
    }
}

impl ApiConfig {
    /// Load API configuration from environment variables.
    ///
    /// Environment variables:
    /// - `NEXO_API_URL`: Override the default API URL
    /// - `NEXO_WS_URL`: Override the WebSocket URL (if not set, derived from
    ///   API URL by replacing http(s) with ws(s))
    ///
    /// # Examples
    ///
    /// ```
    /// use nexo::config::ApiConfig;
    ///
    /// let config = ApiConfig::from_env();
    /// println!("API URL: {}", config.api_url);
    /// println!("WS URL: {}", config.ws_url);
    /// ```
    pub fn from_env() -> Self {
        let api_url = env::var("NEXO_API_URL").unwrap_or_else(|_| DEFAULT_API_URL.to_string());

        let ws_url = env::var("NEXO_WS_URL").unwrap_or_else(|_| derive_ws_url(&api_url));

        Self { api_url, ws_url }
    }
}

/// Derive WebSocket URL from an HTTP API URL.
///
/// Converts `https://` to `wss://` and `http://` to `ws://`,
/// then appends `/ws` path.
fn derive_ws_url(api_url: &str) -> String {
    let ws_base = if api_url.starts_with("https://") {
        api_url.replacen("https://", "wss://", 1)
    } else if api_url.starts_with("http://") {
        api_url.replacen("http://", "ws://", 1)
    } else {
        // Assume wss if no scheme
        format!("wss://{}", api_url)
    };

    // Remove trailing slash if present, then add /ws
    let ws_base = ws_base.trim_end_matches('/');
    format!("{}/ws", ws_base)
}

/// Get the API configuration from environment.
///
/// This is a convenience function that creates a new `ApiConfig` from
/// environment variables.
pub fn get_api_config() -> ApiConfig {
    ApiConfig::from_env()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_ws_url_https() {
        assert_eq!(
            derive_ws_url("https://api.nexo.dev"),
            "wss://api.nexo.dev/ws"
        );
    }

    #[test]
    fn test_derive_ws_url_http() {
        assert_eq!(
            derive_ws_url("http://localhost:8787"),
            "ws://localhost:8787/ws"
        );
    }

    #[test]
    fn test_derive_ws_url_with_trailing_slash() {
        assert_eq!(
            derive_ws_url("https://api.nexo.dev/"),
            "wss://api.nexo.dev/ws"
        );
    }

    #[test]
    fn test_derive_ws_url_no_scheme() {
        assert_eq!(derive_ws_url("api.nexo.dev"), "wss://api.nexo.dev/ws");
    }

    #[test]
    fn test_default_config() {
        // Clear env vars for deterministic test
        env::remove_var("NEXO_API_URL");
        env::remove_var("NEXO_WS_URL");

        let config = ApiConfig::from_env();
        assert_eq!(config.api_url, DEFAULT_API_URL);
        assert_eq!(config.ws_url, "wss://api.nexo.dev/ws");
    }
}
