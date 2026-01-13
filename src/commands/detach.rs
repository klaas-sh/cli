//! Implementation of the /detach command.

use crate::error::Result;
use crate::terminal::TerminalManager;
use crate::types::ConnectionState;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Executes the /detach command.
///
/// Disconnects from the remote server while continuing the local session.
///
/// # Arguments
/// * `terminal` - Terminal manager for output.
/// * `connection_state` - Shared connection state.
pub async fn execute_detach(
    terminal: &TerminalManager,
    connection_state: Arc<Mutex<ConnectionState>>,
) -> Result<()> {
    let state = *connection_state.lock().await;

    if state != ConnectionState::Attached {
        terminal.write_line("\nNot attached.\n")?;
        return Ok(());
    }

    // In full implementation, this would:
    // 1. Send session_detach message over WebSocket
    // 2. Close WebSocket connection gracefully

    // Update state
    {
        let mut state = connection_state.lock().await;
        *state = ConnectionState::Detached;
    }

    terminal.write_line("\nDetached. Continuing locally.\n")?;
    Ok(())
}
