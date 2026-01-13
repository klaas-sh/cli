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

/// State of the command interceptor state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InterceptorState {
    /// Normal mode: forwarding input to PTY.
    Normal,
    /// Reading a potential command after detecting '/'.
    ReadingCommand,
}

/// Intercepted command from user input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// /attach - Connect session for remote access.
    Attach,
    /// /detach - Disconnect from remote.
    Detach,
    /// /status - Show connection status.
    Status,
    /// /help - Show available commands.
    Help,
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
}
