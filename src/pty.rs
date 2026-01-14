//! PTY management for spawning and communicating with Claude Code.

use crate::config::{DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS};
use crate::error::{CliError, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Manages the pseudo-terminal containing Claude Code.
#[derive(Clone)]
pub struct PtyManager {
    /// Master side of the PTY.
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// Child process handle.
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    /// Reader for PTY output.
    reader: Arc<std::sync::Mutex<Box<dyn Read + Send>>>,
    /// Writer for PTY input.
    writer: Arc<std::sync::Mutex<Box<dyn Write + Send>>>,
}

impl PtyManager {
    /// Spawns a command in a new PTY.
    ///
    /// # Arguments
    /// * `command` - The command to execute (e.g., "claude")
    /// * `args` - Arguments to pass to the command
    ///
    /// # Returns
    /// A PtyManager instance managing the spawned process.
    pub fn spawn(command: &str, args: &[String]) -> Result<Self> {
        let pty_system = native_pty_system();

        // Get terminal size or use defaults
        let size = get_terminal_size();

        // Create PTY pair
        let pair = pty_system
            .openpty(size)
            .map_err(|e| CliError::SpawnError(format!("Failed to open PTY: {}", e)))?;

        // Build command with current working directory
        let mut cmd = CommandBuilder::new(command);
        if let Ok(cwd) = std::env::current_dir() {
            cmd.cwd(cwd);
        }
        for arg in args {
            cmd.arg(arg);
        }

        // Spawn child process in the PTY
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| CliError::SpawnError(format!("Failed to spawn {}: {}", command, e)))?;

        // Get reader/writer for master PTY
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| CliError::SpawnError(format!("Failed to clone PTY reader: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| CliError::SpawnError(format!("Failed to get PTY writer: {}", e)))?;

        Ok(Self {
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
            reader: Arc::new(std::sync::Mutex::new(reader)),
            writer: Arc::new(std::sync::Mutex::new(writer)),
        })
    }

    /// Writes bytes to the PTY (sends input to Claude Code) - blocking version.
    pub fn write_blocking(&self, data: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer
            .write_all(data)
            .map_err(|e| CliError::PtyError(format!("Write failed: {}", e)))?;
        writer
            .flush()
            .map_err(|e| CliError::PtyError(format!("Flush failed: {}", e)))?;
        Ok(())
    }

    /// Reads bytes from the PTY (output from Claude Code) - blocking version.
    /// Returns the number of bytes read.
    pub fn read_blocking(&self, buf: &mut [u8]) -> Result<usize> {
        let mut reader = self.reader.lock().unwrap();
        reader
            .read(buf)
            .map_err(|e| CliError::PtyError(format!("Read failed: {}", e)))
    }

    /// Resizes the PTY to new dimensions.
    pub async fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let master = self.master.lock().await;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| CliError::PtyError(format!("Resize failed: {}", e)))?;
        Ok(())
    }

    /// Checks if the child process has exited without blocking.
    /// Returns Some(exit_code) if exited, None if still running.
    pub async fn try_wait(&self) -> Result<Option<u32>> {
        let mut child = self.child.lock().await;
        match child.try_wait() {
            Ok(Some(status)) => Ok(Some(status.exit_code())),
            Ok(None) => Ok(None),
            Err(e) => Err(CliError::PtyError(format!("Wait failed: {}", e))),
        }
    }
}

/// Gets the current terminal size, falling back to defaults.
fn get_terminal_size() -> PtySize {
    let (cols, rows) =
        crossterm::terminal::size().unwrap_or((DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS));

    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spawn_echo() {
        // Test spawning a simple command
        let pty = PtyManager::spawn("echo", &["hello".to_string()]).expect("Failed to spawn PTY");

        // Read output
        let mut buf = [0u8; 1024];
        let n = pty.read_blocking(&mut buf).expect("Failed to read");

        let output = String::from_utf8_lossy(&buf[..n]);
        assert!(output.contains("hello"));
    }

    #[test]
    fn test_terminal_size() {
        let size = get_terminal_size();
        assert!(size.cols > 0);
        assert!(size.rows > 0);
    }
}
