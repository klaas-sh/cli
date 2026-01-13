//! Configuration constants for the CLI.

/// API base URL for remote services.
pub const API_BASE_URL: &str = "https://api.nexo.dev";

/// WebSocket URL for real-time communication.
pub const WS_URL: &str = "wss://api.nexo.dev/ws";

/// Keychain service name for credential storage.
pub const KEYCHAIN_SERVICE: &str = "dev.nexo.cli";

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
