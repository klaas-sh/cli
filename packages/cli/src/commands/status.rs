//! Implementation of the /status command.

use crate::error::Result;
use crate::terminal::TerminalManager;
use crate::types::{ConnectionState, SessionId};

/// Executes the /status command.
///
/// Displays current session and connection status.
///
/// # Arguments
/// * `terminal` - Terminal manager for output.
/// * `session_id` - Current session ID.
/// * `connection_state` - Current connection state.
/// * `device_name` - Device name (if known).
/// * `cwd` - Current working directory.
pub async fn execute_status(
    terminal: &TerminalManager,
    session_id: &SessionId,
    connection_state: ConnectionState,
    device_name: Option<&str>,
    cwd: &str,
) -> Result<()> {
    let mut output = format!(
        "\nSession ID: {}\nStatus: {}\n",
        session_id, connection_state
    );

    if connection_state == ConnectionState::Attached {
        output.push_str(&format!("Connected to: {}\n", crate::config::API_BASE_URL));
        if let Some(name) = device_name {
            output.push_str(&format!("Device: {}\n", name));
        }
    }

    output.push_str(&format!("Working directory: {}\n", cwd));

    terminal.write_line(&output)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_state_formats_correctly() {
        assert_eq!(format!("{}", ConnectionState::Detached), "Detached");
        assert_eq!(format!("{}", ConnectionState::Attached), "Attached");
        assert_eq!(format!("{}", ConnectionState::Connecting), "Connecting");
        assert_eq!(format!("{}", ConnectionState::Reconnecting), "Reconnecting");
    }
}
