//! Implementation of the /nexo help command.

use crate::error::Result;
use crate::terminal::TerminalManager;

/// Help text displayed by the /nexo help command.
const HELP_TEXT: &str = r#"
Nexo Wrapper Commands:
  /nexo help    - Show this help
  /nexo status  - Show session info and connection status
  /nexo attach  - Connect this session for remote access
  /nexo detach  - Disconnect from remote (continue locally)

All other input (including Claude Code's /commands) passes through unchanged.
"#;

/// Executes the /nexo help command.
///
/// Displays available wrapper commands and usage information.
pub async fn execute_help(terminal: &TerminalManager) -> Result<()> {
    terminal.write_line(HELP_TEXT)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_text_contains_commands() {
        assert!(HELP_TEXT.contains("/nexo help"));
        assert!(HELP_TEXT.contains("/nexo status"));
        assert!(HELP_TEXT.contains("/nexo attach"));
        assert!(HELP_TEXT.contains("/nexo detach"));
    }
}
