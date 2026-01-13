//! Implementation of the /help command.

use crate::error::Result;
use crate::terminal::TerminalManager;

/// Help text displayed by the /help command.
const HELP_TEXT: &str = r#"
Commands:
  /attach  - Connect this session for remote access
  /detach  - Disconnect from remote (continue locally)
  /status  - Show connection status
  /help    - Show this help

All other input is sent to Claude Code.
Type // to send a literal /
"#;

/// Executes the /help command.
///
/// Displays available commands and usage information.
pub async fn execute_help(terminal: &TerminalManager) -> Result<()> {
    terminal.write_line(HELP_TEXT)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_text_contains_commands() {
        assert!(HELP_TEXT.contains("/attach"));
        assert!(HELP_TEXT.contains("/detach"));
        assert!(HELP_TEXT.contains("/status"));
        assert!(HELP_TEXT.contains("/help"));
        assert!(HELP_TEXT.contains("//"));
    }
}
