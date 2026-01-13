//! Implementation of the /attach command.
//!
//! Note: Full implementation requires remote connectivity which is out of scope
//! for the local-only CLI. This provides stub functionality.

use crate::error::Result;
use crate::terminal::TerminalManager;
use crate::types::{ConnectionState, SessionId};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Executes the /attach command.
///
/// In the MVP, this is a stub that displays a message about the feature
/// not being available. Full implementation will:
/// 1. Check for existing credentials
/// 2. Perform OAuth Device Flow if needed
/// 3. Establish WebSocket connection
/// 4. Send session attach message
///
/// # Arguments
/// * `terminal` - Terminal manager for output.
/// * `session_id` - Current session ID.
/// * `connection_state` - Shared connection state.
/// * `_cwd` - Current working directory.
pub async fn execute_attach(
    terminal: &TerminalManager,
    session_id: &SessionId,
    connection_state: Arc<Mutex<ConnectionState>>,
    _cwd: &str,
) -> Result<()> {
    // Check if already attached
    {
        let state = connection_state.lock().await;
        if *state == ConnectionState::Attached {
            terminal.write_line(&format!(
                "\nAlready attached. Session ID: {}\n",
                session_id
            ))?;
            return Ok(());
        }
    }

    // Stub implementation - remote connectivity not yet implemented
    terminal.write_line(
        "\nRemote attachment not yet available.\n\
         Session ID: {}\n\
         \n\
         This feature requires the cloud backend to be implemented.\n\
         For now, you can use Claude Code locally without remote access.\n"
    )?;

    // In full implementation, this would:
    // 1. Update state to Connecting
    // 2. Check for stored credentials
    // 3. Run OAuth Device Flow if needed
    // 4. Connect WebSocket
    // 5. Update state to Attached

    Ok(())
}
