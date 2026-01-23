//! Core types used throughout the CLI.

use serde::{Deserialize, Serialize};
use ulid::Ulid;

/// Session identifier using ULID format.
/// Each CLI invocation creates a unique session.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(String);

impl SessionId {
    /// Creates a new unique session ID.
    pub fn new() -> Self {
        Self(Ulid::new().to_string())
    }

    /// Creates a SessionId from an existing string.
    pub fn from_string(s: String) -> Self {
        Self(s)
    }

    /// Returns the session ID as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Device identifier using ULID format.
/// Represents a unique device where the CLI runs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DeviceId(String);

impl DeviceId {
    /// Creates a new unique device ID.
    pub fn new() -> Self {
        Self(Ulid::new().to_string())
    }

    /// Creates a DeviceId from an existing string.
    pub fn from_string(s: String) -> Self {
        Self(s)
    }

    /// Returns the device ID as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for DeviceId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for DeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Connection state of the CLI to the remote server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    /// Not connected to remote server (default state).
    Detached,
    /// Currently establishing connection.
    Connecting,
    /// Connected to remote server.
    Attached,
    /// Lost connection, attempting to reconnect.
    Reconnecting,
}

impl std::fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectionState::Detached => write!(f, "Detached"),
            ConnectionState::Connecting => write!(f, "Connecting"),
            ConnectionState::Attached => write!(f, "Attached"),
            ConnectionState::Reconnecting => write!(f, "Reconnecting"),
        }
    }
}

/// Input mode for multi-connection sessions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum InputMode {
    /// Only the host can send terminal input.
    HostOnly,
    /// Auto-locking: one client at a time, lock on first keystroke.
    #[default]
    AutoLock,
    /// Anyone can send input at any time.
    FreeForAll,
}

impl InputMode {
    /// Converts to the API wire format.
    pub fn to_wire(self) -> &'static str {
        match self {
            InputMode::HostOnly => "host-only",
            InputMode::AutoLock => "auto-lock",
            InputMode::FreeForAll => "free-for-all",
        }
    }
}

/// Default idle timeout in milliseconds.
fn default_idle_timeout() -> u64 {
    1500
}

/// Input configuration for multi-connection sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputConfig {
    /// Input mode (default: auto-lock).
    #[serde(default)]
    pub mode: InputMode,
    /// Lock idle timeout in milliseconds (default: 1500).
    #[serde(default = "default_idle_timeout")]
    pub idle_timeout_ms: u64,
}

impl Default for InputConfig {
    fn default() -> Self {
        Self {
            mode: InputMode::default(),
            idle_timeout_ms: default_idle_timeout(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_is_ulid_format() {
        let id = SessionId::new();
        // ULID is 26 characters, all uppercase alphanumeric
        assert_eq!(id.as_str().len(), 26);
        assert!(id.as_str().chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn device_id_is_ulid_format() {
        let id = DeviceId::new();
        assert_eq!(id.as_str().len(), 26);
        assert!(id.as_str().chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn connection_state_display() {
        assert_eq!(ConnectionState::Detached.to_string(), "Detached");
        assert_eq!(ConnectionState::Attached.to_string(), "Attached");
    }

    #[test]
    fn input_mode_default_is_auto_lock() {
        let mode = InputMode::default();
        assert_eq!(mode, InputMode::AutoLock);
    }

    #[test]
    fn input_mode_to_wire() {
        assert_eq!(InputMode::HostOnly.to_wire(), "host-only");
        assert_eq!(InputMode::AutoLock.to_wire(), "auto-lock");
        assert_eq!(InputMode::FreeForAll.to_wire(), "free-for-all");
    }

    #[test]
    fn input_mode_serde_roundtrip() {
        let modes = [
            InputMode::HostOnly,
            InputMode::AutoLock,
            InputMode::FreeForAll,
        ];

        for mode in modes {
            let json = serde_json::to_string(&mode).unwrap();
            let parsed: InputMode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, mode);
        }
    }

    #[test]
    fn input_mode_deserialize_kebab_case() {
        let cases = [
            (r#""host-only""#, InputMode::HostOnly),
            (r#""auto-lock""#, InputMode::AutoLock),
            (r#""free-for-all""#, InputMode::FreeForAll),
        ];

        for (json, expected) in cases {
            let parsed: InputMode = serde_json::from_str(json).unwrap();
            assert_eq!(parsed, expected);
        }
    }

    #[test]
    fn input_config_default_values() {
        let config = InputConfig::default();
        assert_eq!(config.mode, InputMode::AutoLock);
        assert_eq!(config.idle_timeout_ms, 1500);
    }

    #[test]
    fn input_config_serde_roundtrip() {
        let config = InputConfig {
            mode: InputMode::HostOnly,
            idle_timeout_ms: 2000,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: InputConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.mode, InputMode::HostOnly);
        assert_eq!(parsed.idle_timeout_ms, 2000);
    }

    #[test]
    fn input_config_deserialize_with_defaults() {
        // Empty object should use defaults
        let config: InputConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(config.mode, InputMode::AutoLock);
        assert_eq!(config.idle_timeout_ms, 1500);

        // Partial object should use defaults for missing fields
        let config: InputConfig = serde_json::from_str(r#"{"mode": "host-only"}"#).unwrap();
        assert_eq!(config.mode, InputMode::HostOnly);
        assert_eq!(config.idle_timeout_ms, 1500);
    }
}
