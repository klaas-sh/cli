//! Command interceptor state machine.
//!
//! Detects and intercepts CLI commands (starting with `/`) while
//! forwarding all other input to Claude Code.

use crate::config::COMMAND_TIMEOUT_MS;
use crate::types::{Command, InterceptorState};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// Result of processing a byte through the interceptor.
enum ProcessResult {
    /// Bytes to forward to PTY.
    Forward(Vec<u8>),
    /// Byte buffered, waiting for more input.
    Buffer,
    /// Complete command detected.
    Command(Command),
}

/// State machine for intercepting CLI commands from user input.
pub struct CommandInterceptor {
    /// Current state of the interceptor.
    state: InterceptorState,
    /// Buffer for potential command being typed.
    buffer: String,
    /// Whether we're at the start of a line.
    at_line_start: bool,
    /// When command reading started (for timeout).
    command_start: Option<Instant>,
    /// Channel to send detected commands.
    cmd_tx: mpsc::Sender<Command>,
}

impl CommandInterceptor {
    /// Creates a new command interceptor.
    ///
    /// # Arguments
    /// * `cmd_tx` - Channel sender for detected commands.
    pub fn new(cmd_tx: mpsc::Sender<Command>) -> Self {
        Self {
            state: InterceptorState::Normal,
            buffer: String::new(),
            at_line_start: true,
            command_start: None,
            cmd_tx,
        }
    }

    /// Processes input bytes, returning bytes to forward to PTY.
    ///
    /// Commands are sent through the command channel, not returned.
    pub async fn process(&mut self, input: &[u8]) -> Vec<u8> {
        let mut forward = Vec::new();

        for &byte in input {
            match self.process_byte(byte).await {
                ProcessResult::Forward(bytes) => forward.extend(bytes),
                ProcessResult::Buffer => {}
                ProcessResult::Command(cmd) => {
                    // Send command through channel, ignore send errors
                    let _ = self.cmd_tx.send(cmd).await;
                }
            }
        }

        forward
    }

    /// Checks for command timeout and returns any buffered bytes.
    ///
    /// Should be called periodically during the I/O loop.
    pub fn check_timeout(&mut self) -> Option<Vec<u8>> {
        if self.state == InterceptorState::ReadingCommand {
            if let Some(start) = self.command_start {
                if start.elapsed() > Duration::from_millis(COMMAND_TIMEOUT_MS) {
                    return Some(self.flush_buffer());
                }
            }
        }
        None
    }

    /// Processes a single byte.
    async fn process_byte(&mut self, byte: u8) -> ProcessResult {
        match self.state {
            InterceptorState::Normal => self.process_normal(byte),
            InterceptorState::ReadingCommand => self.process_reading(byte),
        }
    }

    /// Processes a byte in normal (forwarding) mode.
    fn process_normal(&mut self, byte: u8) -> ProcessResult {
        match byte {
            // '/' at line start triggers command reading
            b'/' if self.at_line_start => {
                self.state = InterceptorState::ReadingCommand;
                self.buffer.clear();
                self.command_start = Some(Instant::now());
                ProcessResult::Buffer
            }
            // Newline/carriage return resets line start
            b'\n' | b'\r' => {
                self.at_line_start = true;
                ProcessResult::Forward(vec![byte])
            }
            // Any other character
            _ => {
                self.at_line_start = false;
                ProcessResult::Forward(vec![byte])
            }
        }
    }

    /// Processes a byte while reading a potential command.
    fn process_reading(&mut self, byte: u8) -> ProcessResult {
        match byte {
            // Enter completes the command
            b'\n' | b'\r' => {
                self.state = InterceptorState::Normal;
                self.at_line_start = true;
                self.command_start = None;

                if let Some(cmd) = self.match_command() {
                    ProcessResult::Command(cmd)
                } else {
                    // Not a recognized command, forward everything
                    let mut bytes = vec![b'/'];
                    bytes.extend(self.buffer.bytes());
                    bytes.push(byte);
                    self.buffer.clear();
                    ProcessResult::Forward(bytes)
                }
            }
            // Double slash escapes to send single '/'
            b'/' if self.buffer.is_empty() => {
                self.state = InterceptorState::Normal;
                self.at_line_start = false;
                self.command_start = None;
                ProcessResult::Forward(vec![b'/'])
            }
            // Backspace handling
            0x7f | 0x08 => {
                if self.buffer.is_empty() {
                    // Cancel command reading
                    self.state = InterceptorState::Normal;
                    self.command_start = None;
                    ProcessResult::Forward(vec![b'/', byte])
                } else {
                    self.buffer.pop();
                    ProcessResult::Buffer
                }
            }
            // Space might complete a command
            b' ' => {
                if let Some(cmd) = self.match_command() {
                    self.state = InterceptorState::Normal;
                    self.at_line_start = false;
                    self.command_start = None;
                    self.buffer.clear();
                    ProcessResult::Command(cmd)
                } else {
                    self.buffer.push(byte as char);
                    ProcessResult::Buffer
                }
            }
            // Any other character adds to buffer
            _ => {
                self.buffer.push(byte as char);
                ProcessResult::Buffer
            }
        }
    }

    /// Attempts to match the current buffer to a command.
    fn match_command(&self) -> Option<Command> {
        match self.buffer.to_lowercase().as_str() {
            "attach" => Some(Command::Attach),
            "detach" => Some(Command::Detach),
            "status" => Some(Command::Status),
            "help" => Some(Command::Help),
            _ => None,
        }
    }

    /// Flushes the buffer, returning all buffered bytes.
    fn flush_buffer(&mut self) -> Vec<u8> {
        self.state = InterceptorState::Normal;
        self.at_line_start = false;
        self.command_start = None;

        let mut bytes = vec![b'/'];
        bytes.extend(self.buffer.bytes());
        self.buffer.clear();
        bytes
    }

    /// Returns the current interceptor state.
    pub fn state(&self) -> InterceptorState {
        self.state
    }

    /// Returns whether we're at the start of a line.
    pub fn is_at_line_start(&self) -> bool {
        self.at_line_start
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn create_interceptor() -> (CommandInterceptor, mpsc::Receiver<Command>) {
        let (tx, rx) = mpsc::channel(16);
        (CommandInterceptor::new(tx), rx)
    }

    #[tokio::test]
    async fn test_help_command() {
        let (mut interceptor, mut rx) = create_interceptor().await;

        // Type "/help\n"
        let forward = interceptor.process(b"/help\n").await;

        // Nothing should be forwarded
        assert!(forward.is_empty());

        // Command should be received
        let cmd = rx.recv().await.unwrap();
        assert!(matches!(cmd, Command::Help));
    }

    #[tokio::test]
    async fn test_status_command() {
        let (mut interceptor, mut rx) = create_interceptor().await;

        let forward = interceptor.process(b"/status\n").await;
        assert!(forward.is_empty());

        let cmd = rx.recv().await.unwrap();
        assert!(matches!(cmd, Command::Status));
    }

    #[tokio::test]
    async fn test_attach_command() {
        let (mut interceptor, mut rx) = create_interceptor().await;

        let forward = interceptor.process(b"/attach\n").await;
        assert!(forward.is_empty());

        let cmd = rx.recv().await.unwrap();
        assert!(matches!(cmd, Command::Attach));
    }

    #[tokio::test]
    async fn test_detach_command() {
        let (mut interceptor, mut rx) = create_interceptor().await;

        let forward = interceptor.process(b"/detach\n").await;
        assert!(forward.is_empty());

        let cmd = rx.recv().await.unwrap();
        assert!(matches!(cmd, Command::Detach));
    }

    #[tokio::test]
    async fn test_double_slash_escape() {
        let (mut interceptor, _rx) = create_interceptor().await;

        let forward = interceptor.process(b"//").await;

        // Single slash should be forwarded
        assert_eq!(forward, vec![b'/']);
    }

    #[tokio::test]
    async fn test_unrecognized_command_passthrough() {
        let (mut interceptor, _rx) = create_interceptor().await;

        let forward = interceptor.process(b"/unknown\n").await;

        // Full input should be forwarded
        assert_eq!(forward, b"/unknown\n");
    }

    #[tokio::test]
    async fn test_command_not_at_line_start() {
        let (mut interceptor, _rx) = create_interceptor().await;

        // Type some text first, then /help
        let forward1 = interceptor.process(b"text").await;
        assert_eq!(forward1, b"text");

        let forward2 = interceptor.process(b"/help\n").await;
        // Should be forwarded since not at line start
        assert_eq!(forward2, b"/help\n");
    }

    #[tokio::test]
    async fn test_newline_resets_line_start() {
        let (mut interceptor, mut rx) = create_interceptor().await;

        // Type text, newline, then /help
        let forward1 = interceptor.process(b"text\n").await;
        assert_eq!(forward1, b"text\n");

        let forward2 = interceptor.process(b"/help\n").await;
        assert!(forward2.is_empty());

        let cmd = rx.recv().await.unwrap();
        assert!(matches!(cmd, Command::Help));
    }

    #[tokio::test]
    async fn test_case_insensitive() {
        let (mut interceptor, mut rx) = create_interceptor().await;

        let forward = interceptor.process(b"/HELP\n").await;
        assert!(forward.is_empty());

        let cmd = rx.recv().await.unwrap();
        assert!(matches!(cmd, Command::Help));
    }

    #[tokio::test]
    async fn test_command_with_space() {
        let (mut interceptor, mut rx) = create_interceptor().await;

        // "/help " should trigger command on space
        let forward = interceptor.process(b"/help ").await;
        assert!(forward.is_empty());

        let cmd = rx.recv().await.unwrap();
        assert!(matches!(cmd, Command::Help));
    }
}
