//! Terminal management for raw mode and I/O handling.

use crate::error::Result;
use crossterm::{
    cursor::{MoveTo, RestorePosition, SavePosition},
    event::{self, DisableBracketedPaste, EnableBracketedPaste, Event},
    style::Print,
    terminal::{self, disable_raw_mode, enable_raw_mode, Clear, ClearType},
    ExecutableCommand,
};
use std::io::{self, Write};
use std::time::Duration;

/// Manages terminal state including raw mode.
/// Ensures terminal is restored on drop.
#[derive(Default)]
pub struct TerminalManager {
    /// Whether raw mode was enabled by this instance.
    was_raw: bool,
}

impl TerminalManager {
    /// Creates a new terminal manager.
    pub fn new() -> Result<Self> {
        Ok(Self { was_raw: false })
    }

    /// Enters raw mode for character-by-character input.
    /// Raw mode disables line buffering and echo.
    /// Also enables bracketed paste mode for proper paste handling.
    pub fn enter_raw_mode(&mut self) -> Result<()> {
        if !self.was_raw {
            enable_raw_mode()?;
            // Enable bracketed paste mode to receive paste events
            // This allows proper handling of pasted text including emojis
            io::stdout().execute(EnableBracketedPaste)?;
            self.was_raw = true;
        }
        Ok(())
    }

    /// Exits raw mode, restoring normal terminal behavior.
    pub fn exit_raw_mode(&mut self) -> Result<()> {
        if self.was_raw {
            // Release the status-bar scroll region and wipe the reserved row
            // so nothing is left behind in the shell the user returns to.
            let _ = self.clear_status_bar();
            // Disable bracketed paste mode first
            let _ = io::stdout().execute(DisableBracketedPaste);
            disable_raw_mode()?;
            self.was_raw = false;
        }
        Ok(())
    }

    /// Reserves the bottom row of the terminal for the klaas status bar.
    ///
    /// Uses DECSTBM (`ESC[top;bottom r`) to shrink the scrolling region to
    /// rows 1..rows-1 (1-based). Combined with sizing the PTY to rows-1, this
    /// prevents the wrapped program from writing to the reserved row and
    /// stops the shell prompt from colliding with the status line.
    ///
    /// Must be re-applied after terminal resize. DECSTBM homes the cursor, so
    /// this wraps the call in save/restore to preserve the wrapped program's
    /// cursor position.
    pub fn set_status_bar(&self) -> Result<()> {
        let (_cols, rows) = self.size()?;
        if rows < 2 {
            // Nothing useful we can do in a 1-row terminal.
            return Ok(());
        }
        let mut stdout = io::stdout();
        stdout.execute(SavePosition)?;
        // DECSTBM: scroll region spans rows 1..(rows-1), 1-based, inclusive.
        write!(stdout, "\x1b[1;{}r", rows - 1)?;
        // Clear the reserved row so pre-existing content doesn't linger.
        stdout.execute(MoveTo(0, rows - 1))?;
        stdout.execute(Clear(ClearType::CurrentLine))?;
        stdout.execute(RestorePosition)?;
        stdout.flush()?;
        Ok(())
    }

    /// Restores the full scrolling region and clears the status-bar row.
    /// Inverse of `set_status_bar`. Safe to call even if the status bar was
    /// never installed.
    pub fn clear_status_bar(&self) -> Result<()> {
        let (_cols, rows) = self.size()?;
        let mut stdout = io::stdout();
        stdout.execute(SavePosition)?;
        // Reset scrolling region to full screen.
        write!(stdout, "\x1b[r")?;
        if rows >= 1 {
            stdout.execute(MoveTo(0, rows - 1))?;
            stdout.execute(Clear(ClearType::CurrentLine))?;
        }
        stdout.execute(RestorePosition)?;
        stdout.flush()?;
        Ok(())
    }

    /// Polls for terminal events with a timeout.
    /// Returns None if no event occurs within the timeout.
    pub fn poll_event(&self, timeout: Duration) -> Result<Option<Event>> {
        if event::poll(timeout)? {
            Ok(Some(event::read()?))
        } else {
            Ok(None)
        }
    }

    /// Writes raw bytes to stdout.
    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut stdout = io::stdout();
        stdout.write_all(data)?;
        stdout.flush()?;
        Ok(())
    }

    /// Writes a line with proper terminal formatting.
    /// Moves to a new line, writes the message, then another new line.
    pub fn write_line(&self, msg: &str) -> Result<()> {
        let mut stdout = io::stdout();
        // \r\n for proper line handling in raw mode
        write!(stdout, "\r\n{}\r\n", msg)?;
        stdout.flush()?;
        Ok(())
    }

    /// Returns the current terminal size (columns, rows).
    pub fn size(&self) -> Result<(u16, u16)> {
        Ok(terminal::size()?)
    }

    /// Returns whether the terminal is currently in raw mode.
    pub fn is_raw(&self) -> bool {
        self.was_raw
    }

    /// Draws a status line at the bottom of the terminal.
    ///
    /// Saves cursor position, moves to bottom row, writes status, restores cursor.
    /// This is experimental - the agent may overwrite it.
    pub fn draw_status_line(&self, status: &str) -> Result<()> {
        let (cols, rows) = self.size()?;
        let mut stdout = io::stdout();

        // Save cursor position
        stdout.execute(SavePosition)?;

        // Move to bottom row (0-indexed, so rows-1)
        stdout.execute(MoveTo(0, rows - 1))?;

        // Clear the line
        stdout.execute(Clear(ClearType::CurrentLine))?;

        // Truncate status if too long
        let display_status = if status.len() > cols as usize {
            &status[..cols as usize]
        } else {
            status
        };

        // Write status
        stdout.execute(Print(display_status))?;

        // Restore cursor position
        stdout.execute(RestorePosition)?;

        stdout.flush()?;
        Ok(())
    }
}

impl Drop for TerminalManager {
    fn drop(&mut self) {
        // Always restore terminal state on drop
        let _ = self.exit_raw_mode();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_manager_tracks_raw_mode() {
        let manager = TerminalManager::new().unwrap();
        assert!(!manager.is_raw());
    }

    #[test]
    fn terminal_size_returns_valid_dimensions() {
        let manager = TerminalManager::new().unwrap();
        // This might fail in non-TTY environments like CI
        if let Ok((cols, rows)) = manager.size() {
            assert!(cols > 0);
            assert!(rows > 0);
        }
    }
}
