//! Terminal management for raw mode and I/O handling.

use crate::error::Result;
use crossterm::{
    event::{self, Event},
    terminal::{self, disable_raw_mode, enable_raw_mode},
};
use std::io::{self, Write};
use std::time::Duration;

/// Manages terminal state including raw mode.
/// Ensures terminal is restored on drop.
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
    pub fn enter_raw_mode(&mut self) -> Result<()> {
        if !self.was_raw {
            enable_raw_mode()?;
            self.was_raw = true;
        }
        Ok(())
    }

    /// Exits raw mode, restoring normal terminal behavior.
    pub fn exit_raw_mode(&mut self) -> Result<()> {
        if self.was_raw {
            disable_raw_mode()?;
            self.was_raw = false;
        }
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
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self { was_raw: false }
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
