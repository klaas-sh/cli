//! Error types for the CLI.

use thiserror::Error;

use crate::billing_error::BillingError;

/// Primary error type for CLI operations.
#[derive(Error, Debug)]
pub enum CliError {
    /// Failed to spawn Claude Code process.
    #[error("Failed to spawn Claude Code: {0}")]
    SpawnError(String),

    /// PTY-related error.
    #[error("PTY error: {0}")]
    PtyError(String),

    /// Terminal handling error.
    #[error("Terminal error: {0}")]
    TerminalError(#[from] std::io::Error),

    /// Authentication failed.
    #[error("Authentication failed: {0}")]
    AuthError(String),

    /// Keychain/credential storage error.
    #[error("Keychain error: {0}")]
    KeychainError(String),

    /// Network/connection error.
    #[error("Network error: {0}")]
    NetworkError(String),

    /// WebSocket error.
    #[error("WebSocket error: {0}")]
    WebSocketError(String),

    /// Cryptographic operation error.
    #[error("Crypto error: {0}")]
    CryptoError(String),

    /// Billing-related denial (feature gate or trial expired). The
    /// embedded [`BillingError`] carries the structured details and
    /// renders itself with an upgrade-friendly message.
    #[error("{0}")]
    Billing(BillingError),

    /// Generic error.
    #[error("{0}")]
    Other(String),
}

impl From<BillingError> for CliError {
    fn from(err: BillingError) -> Self {
        CliError::Billing(err)
    }
}

/// Convenience type alias for Results using CliError.
pub type Result<T> = std::result::Result<T, CliError>;
