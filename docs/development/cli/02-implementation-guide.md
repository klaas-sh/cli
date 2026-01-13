# Nexo CLI Implementation Guide

**Version:** 0.1.0
**Status:** Draft
**Last Updated:** January 2025

---

## 1. Project Setup

### 1.1 Directory Structure

```
packages/cli/
├── Cargo.toml
├── Cargo.lock
├── build.rs              # Build script for version info
├── src/
│   ├── main.rs           # Entry point, argument parsing
│   ├── lib.rs            # Library root (for testing)
│   ├── app.rs            # Application orchestration
│   ├── pty.rs            # PTY spawning and management
│   ├── terminal.rs       # Raw mode, resize handling
│   ├── interceptor.rs    # Command interception state machine
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── attach.rs     # /attach implementation
│   │   ├── detach.rs     # /detach implementation
│   │   ├── status.rs     # /status implementation
│   │   └── help.rs       # /help implementation
│   ├── remote/
│   │   ├── mod.rs
│   │   ├── websocket.rs  # WebSocket client
│   │   ├── messages.rs   # Protocol message types
│   │   ├── reconnect.rs  # Reconnection logic
│   │   └── queue.rs      # Message queue
│   ├── auth/
│   │   ├── mod.rs
│   │   ├── device_flow.rs    # OAuth Device Flow
│   │   ├── token.rs          # Token management
│   │   └── keychain.rs       # Credential storage
│   ├── types.rs          # Shared types (SessionId, DeviceId, etc.)
│   ├── config.rs         # Configuration constants
│   └── error.rs          # Error types
├── tests/
│   └── integration/      # Integration tests
└── README.md
```

### 1.2 Cargo.toml

```toml
[package]
name = "nexo"
version = "0.1.0"
edition = "2021"
authors = ["Nexo Team"]
description = "Remote access wrapper for Claude Code"
license = "MIT"
repository = "https://github.com/example/nexo"

[dependencies]
# Async runtime
tokio = { version = "1", features = ["full"] }

# PTY handling
portable-pty = "0.8"

# Terminal
crossterm = "0.27"

# WebSocket
tokio-tungstenite = { version = "0.21", features = ["native-tls"] }
futures-util = "0.3"

# HTTP client (for auth)
reqwest = { version = "0.11", features = ["json"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Keychain
keyring = "2"

# CLI arguments
clap = { version = "4", features = ["derive"] }

# IDs
ulid = "1"

# Encoding
base64 = "0.21"

# Time
chrono = { version = "0.4", features = ["serde"] }

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# Error handling
thiserror = "1"
anyhow = "1"

# Crypto (for device keys)
ed25519-dalek = "2"
rand = "0.8"

[dev-dependencies]
tokio-test = "0.4"
mockall = "0.12"
tempfile = "3"

[profile.release]
lto = true
codegen-units = 1
strip = true
```

### 1.3 Build Configuration

Create `build.rs` to embed version info:

```rust
fn main() {
    // Embed git commit hash if available
    if let Ok(output) = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
    {
        if output.status.success() {
            let hash = String::from_utf8_lossy(&output.stdout);
            println!("cargo:rustc-env=GIT_HASH={}", hash.trim());
        }
    }
    println!("cargo:rerun-if-changed=.git/HEAD");
}
```

---

## 2. Core Types

### 2.1 types.rs

```rust
use serde::{Deserialize, Serialize};
use ulid::Ulid;

/// Session identifier (ULID)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(String);

impl SessionId {
    pub fn new() -> Self {
        Self(Ulid::new().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Device identifier (ULID)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DeviceId(String);

impl DeviceId {
    pub fn new() -> Self {
        Self(Ulid::new().to_string())
    }

    pub fn from_string(s: String) -> Self {
        Self(s)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Connection state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Detached,
    Connecting,
    Attached,
    Reconnecting,
}

/// Command interceptor state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InterceptorState {
    Normal,
    ReadingCommand,
}
```

### 2.2 error.rs

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum NexoError {
    #[error("Failed to spawn Claude Code: {0}")]
    SpawnError(String),

    #[error("PTY error: {0}")]
    PtyError(#[from] portable_pty::Error),

    #[error("Terminal error: {0}")]
    TerminalError(#[from] crossterm::ErrorKind),

    #[error("WebSocket error: {0}")]
    WebSocketError(#[from] tokio_tungstenite::tungstenite::Error),

    #[error("Authentication failed: {0}")]
    AuthError(String),

    #[error("Keychain error: {0}")]
    KeychainError(String),

    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, NexoError>;
```

### 2.3 config.rs

```rust
/// API base URL
pub const API_BASE_URL: &str = "https://api.nexo.dev";

/// WebSocket URL
pub const WS_URL: &str = "wss://api.nexo.dev/ws";

/// Keychain service name
pub const KEYCHAIN_SERVICE: &str = "dev.nexo.cli";

/// Command interception timeout (milliseconds)
pub const COMMAND_TIMEOUT_MS: u64 = 100;

/// Reconnection settings
pub const RECONNECT_BASE_DELAY_MS: u64 = 500;
pub const RECONNECT_MAX_DELAY_MS: u64 = 30_000;
pub const RECONNECT_MAX_ATTEMPTS: u32 = 10;
pub const RECONNECT_JITTER_MS: u64 = 1000;

/// Message queue settings
pub const MESSAGE_QUEUE_MAX_SIZE: usize = 100;
pub const MESSAGE_QUEUE_MAX_AGE_SECS: u64 = 300; // 5 minutes

/// Heartbeat interval (seconds)
pub const HEARTBEAT_INTERVAL_SECS: u64 = 30;

/// Session timeout for server (seconds)
pub const SESSION_TIMEOUT_SECS: u64 = 30;
```

---

## 3. Entry Point

### 3.1 main.rs

```rust
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod app;
mod auth;
mod commands;
mod config;
mod error;
mod interceptor;
mod pty;
mod remote;
mod terminal;
mod types;

#[derive(Parser)]
#[command(name = "nexo")]
#[command(about = "Remote access wrapper for Claude Code")]
#[command(version)]
struct Cli {
    /// Arguments to pass through to Claude Code
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    claude_args: Vec<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nexo=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .init();

    let cli = Cli::parse();

    // Run the application
    let exit_code = app::run(cli.claude_args).await?;

    std::process::exit(exit_code);
}
```

---

## 4. Application Orchestration

### 4.1 app.rs

```rust
use crate::{
    config, error::Result, interceptor::CommandInterceptor,
    pty::PtyManager, remote::RemoteClient, terminal::TerminalManager,
    types::{ConnectionState, SessionId},
};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

/// Main application state
pub struct App {
    session_id: SessionId,
    connection_state: Arc<Mutex<ConnectionState>>,
    pty: PtyManager,
    terminal: TerminalManager,
    interceptor: CommandInterceptor,
    remote: Option<RemoteClient>,
}

/// Run the application
pub async fn run(claude_args: Vec<String>) -> Result<i32> {
    // Generate session ID
    let session_id = SessionId::new();
    tracing::info!("Starting session: {}", session_id);

    // Set up terminal (raw mode)
    let mut terminal = TerminalManager::new()?;
    terminal.enter_raw_mode()?;

    // Spawn Claude Code in PTY
    let pty = PtyManager::spawn("claude", &claude_args)?;

    // Create channels for I/O
    let (stdin_tx, stdin_rx) = mpsc::channel::<Vec<u8>>(256);
    let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>(256);
    let (cmd_tx, cmd_rx) = mpsc::channel::<Command>(16);

    // Create interceptor
    let interceptor = CommandInterceptor::new(cmd_tx);

    // Create app state
    let connection_state = Arc::new(Mutex::new(ConnectionState::Detached));
    let app = Arc::new(Mutex::new(App {
        session_id: session_id.clone(),
        connection_state: connection_state.clone(),
        pty,
        terminal,
        interceptor,
        remote: None,
    }));

    // Run the main I/O loop
    let exit_code = run_io_loop(app, stdin_rx, stdout_rx, cmd_rx).await?;

    // Cleanup (terminal restore handled by Drop)
    Ok(exit_code)
}

/// Main I/O loop - multiplexes between stdin, PTY, and WebSocket
async fn run_io_loop(
    app: Arc<Mutex<App>>,
    mut stdin_rx: mpsc::Receiver<Vec<u8>>,
    mut stdout_rx: mpsc::Receiver<Vec<u8>>,
    mut cmd_rx: mpsc::Receiver<Command>,
) -> Result<i32> {
    use tokio::select;

    loop {
        select! {
            // Handle user input
            Some(input) = stdin_rx.recv() => {
                let mut app = app.lock().await;
                app.handle_stdin(&input).await?;
            }

            // Handle PTY output
            Some(output) = stdout_rx.recv() => {
                let mut app = app.lock().await;
                app.handle_pty_output(&output).await?;
            }

            // Handle intercepted commands
            Some(cmd) = cmd_rx.recv() => {
                let mut app = app.lock().await;
                app.handle_command(cmd).await?;
            }

            // PTY process exited
            else => break,
        }
    }

    // Get exit code from PTY
    let app = app.lock().await;
    Ok(app.pty.exit_code().unwrap_or(0))
}

/// Intercepted command
#[derive(Debug)]
pub enum Command {
    Attach,
    Detach,
    Status,
    Help,
}
```

---

## 5. PTY Management

### 5.1 pty.rs

```rust
use crate::error::{NexoError, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Manages the PTY containing Claude Code
pub struct PtyManager {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    reader: Arc<Mutex<Box<dyn Read + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl PtyManager {
    /// Spawn Claude Code in a new PTY
    pub fn spawn(command: &str, args: &[String]) -> Result<Self> {
        let pty_system = native_pty_system();

        // Get terminal size
        let size = get_terminal_size();

        // Create PTY
        let pair = pty_system
            .openpty(size)
            .map_err(|e| NexoError::SpawnError(e.to_string()))?;

        // Build command
        let mut cmd = CommandBuilder::new(command);
        for arg in args {
            cmd.arg(arg);
        }

        // Spawn child process
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| NexoError::SpawnError(e.to_string()))?;

        // Get reader/writer for master PTY
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| NexoError::SpawnError(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| NexoError::SpawnError(e.to_string()))?;

        Ok(Self {
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
            reader: Arc::new(Mutex::new(reader)),
            writer: Arc::new(Mutex::new(writer)),
        })
    }

    /// Write bytes to PTY stdin
    pub async fn write(&self, data: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock().await;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    /// Read bytes from PTY stdout
    pub async fn read(&self, buf: &mut [u8]) -> Result<usize> {
        let mut reader = self.reader.lock().await;
        Ok(reader.read(buf)?)
    }

    /// Resize the PTY
    pub async fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let master = self.master.lock().await;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| NexoError::PtyError(e))?;
        Ok(())
    }

    /// Check if child process has exited
    pub async fn try_wait(&self) -> Result<Option<u32>> {
        let mut child = self.child.lock().await;
        match child.try_wait() {
            Ok(Some(status)) => Ok(Some(status.exit_code())),
            Ok(None) => Ok(None),
            Err(e) => Err(NexoError::SpawnError(e.to_string())),
        }
    }

    /// Get exit code (blocking)
    pub fn exit_code(&self) -> Option<i32> {
        // Implementation depends on portable-pty version
        None
    }
}

/// Get current terminal size
fn get_terminal_size() -> PtySize {
    use crossterm::terminal::size;

    let (cols, rows) = size().unwrap_or((80, 24));
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}
```

---

## 6. Terminal Management

### 6.1 terminal.rs

```rust
use crate::error::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    terminal::{self, EnterAlternateScreen, LeaveAlternateScreen},
    ExecutableCommand,
};
use std::io::{self, Write};

/// Manages terminal raw mode and input handling
pub struct TerminalManager {
    was_raw: bool,
}

impl TerminalManager {
    pub fn new() -> Result<Self> {
        Ok(Self { was_raw: false })
    }

    /// Enter raw mode
    pub fn enter_raw_mode(&mut self) -> Result<()> {
        terminal::enable_raw_mode()?;
        self.was_raw = true;
        Ok(())
    }

    /// Exit raw mode
    pub fn exit_raw_mode(&mut self) -> Result<()> {
        if self.was_raw {
            terminal::disable_raw_mode()?;
            self.was_raw = false;
        }
        Ok(())
    }

    /// Read a single event (non-blocking)
    pub fn poll_event(&self, timeout: std::time::Duration) -> Result<Option<Event>> {
        if event::poll(timeout)? {
            Ok(Some(event::read()?))
        } else {
            Ok(None)
        }
    }

    /// Write to stdout
    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut stdout = io::stdout();
        stdout.write_all(data)?;
        stdout.flush()?;
        Ok(())
    }

    /// Write a line (for Nexo messages)
    pub fn write_line(&self, msg: &str) -> Result<()> {
        let mut stdout = io::stdout();
        // Move to new line, write message
        write!(stdout, "\r\n{}\r\n", msg)?;
        stdout.flush()?;
        Ok(())
    }

    /// Get terminal size
    pub fn size(&self) -> Result<(u16, u16)> {
        Ok(terminal::size()?)
    }
}

impl Drop for TerminalManager {
    fn drop(&mut self) {
        // Restore terminal state
        let _ = self.exit_raw_mode();
    }
}
```

---

## 7. Command Interceptor

### 7.1 interceptor.rs

```rust
use crate::{app::Command, config::COMMAND_TIMEOUT_MS, types::InterceptorState};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// State machine for intercepting /commands
pub struct CommandInterceptor {
    state: InterceptorState,
    buffer: String,
    at_line_start: bool,
    command_start: Option<Instant>,
    cmd_tx: mpsc::Sender<Command>,
}

impl CommandInterceptor {
    pub fn new(cmd_tx: mpsc::Sender<Command>) -> Self {
        Self {
            state: InterceptorState::Normal,
            buffer: String::new(),
            at_line_start: true,
            command_start: None,
            cmd_tx,
        }
    }

    /// Process input byte(s), returns bytes to forward to PTY
    pub async fn process(&mut self, input: &[u8]) -> Vec<u8> {
        let mut forward = Vec::new();

        for &byte in input {
            match self.process_byte(byte).await {
                ProcessResult::Forward(bytes) => forward.extend(bytes),
                ProcessResult::Buffer => {}
                ProcessResult::Command(cmd) => {
                    let _ = self.cmd_tx.send(cmd).await;
                }
            }
        }

        forward
    }

    /// Check for command timeout
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

    async fn process_byte(&mut self, byte: u8) -> ProcessResult {
        match self.state {
            InterceptorState::Normal => self.process_normal(byte),
            InterceptorState::ReadingCommand => self.process_reading(byte),
        }
    }

    fn process_normal(&mut self, byte: u8) -> ProcessResult {
        match byte {
            b'/' if self.at_line_start => {
                self.state = InterceptorState::ReadingCommand;
                self.buffer.clear();
                self.command_start = Some(Instant::now());
                ProcessResult::Buffer
            }
            b'\n' | b'\r' => {
                self.at_line_start = true;
                ProcessResult::Forward(vec![byte])
            }
            _ => {
                self.at_line_start = false;
                ProcessResult::Forward(vec![byte])
            }
        }
    }

    fn process_reading(&mut self, byte: u8) -> ProcessResult {
        match byte {
            b'\n' | b'\r' => {
                // End of command input
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
            b'/' if self.buffer.is_empty() => {
                // Double slash escape - send single /
                self.state = InterceptorState::Normal;
                self.at_line_start = false;
                self.command_start = None;
                ProcessResult::Forward(vec![b'/'])
            }
            0x7f | 0x08 => {
                // Backspace
                if self.buffer.is_empty() {
                    self.state = InterceptorState::Normal;
                    self.command_start = None;
                    ProcessResult::Forward(vec![b'/', byte])
                } else {
                    self.buffer.pop();
                    ProcessResult::Buffer
                }
            }
            b' ' => {
                // Space - check if we have a command
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
            _ => {
                self.buffer.push(byte as char);
                ProcessResult::Buffer
            }
        }
    }

    fn match_command(&self) -> Option<Command> {
        match self.buffer.to_lowercase().as_str() {
            "attach" => Some(Command::Attach),
            "detach" => Some(Command::Detach),
            "status" => Some(Command::Status),
            "help" => Some(Command::Help),
            _ => None,
        }
    }

    fn flush_buffer(&mut self) -> Vec<u8> {
        self.state = InterceptorState::Normal;
        self.at_line_start = false;
        self.command_start = None;

        let mut bytes = vec![b'/'];
        bytes.extend(self.buffer.bytes());
        self.buffer.clear();
        bytes
    }
}

enum ProcessResult {
    Forward(Vec<u8>),
    Buffer,
    Command(Command),
}
```

---

## 8. Command Implementations

### 8.1 commands/mod.rs

```rust
pub mod attach;
pub mod detach;
pub mod help;
pub mod status;

pub use attach::execute_attach;
pub use detach::execute_detach;
pub use help::execute_help;
pub use status::execute_status;
```

### 8.2 commands/help.rs

```rust
use crate::terminal::TerminalManager;
use crate::error::Result;

const HELP_TEXT: &str = r#"
Nexo Commands:
  /attach  - Connect this session for remote access
  /detach  - Disconnect from remote (continue locally)
  /status  - Show connection status
  /help    - Show this help

All other input is sent to Claude Code.
Type // to send a literal /
"#;

pub async fn execute_help(terminal: &TerminalManager) -> Result<()> {
    terminal.write_line(HELP_TEXT)?;
    Ok(())
}
```

### 8.3 commands/status.rs

```rust
use crate::{
    error::Result,
    terminal::TerminalManager,
    types::{ConnectionState, DeviceId, SessionId},
};

pub async fn execute_status(
    terminal: &TerminalManager,
    session_id: &SessionId,
    connection_state: ConnectionState,
    device_name: Option<&str>,
    cwd: &str,
) -> Result<()> {
    let mut output = format!(
        "\nSession ID: {}\nStatus: {:?}\n",
        session_id, connection_state
    );

    if connection_state == ConnectionState::Attached {
        output.push_str("Connected to: api.nexo.dev\n");
        if let Some(name) = device_name {
            output.push_str(&format!("Device: {}\n", name));
        }
    }

    output.push_str(&format!("Working directory: {}\n", cwd));

    terminal.write_line(&output)?;
    Ok(())
}
```

### 8.4 commands/attach.rs

```rust
use crate::{
    auth::{device_flow, keychain, token},
    config,
    error::{NexoError, Result},
    remote::RemoteClient,
    terminal::TerminalManager,
    types::{ConnectionState, DeviceId, SessionId},
};
use std::sync::Arc;
use tokio::sync::Mutex;

pub async fn execute_attach(
    terminal: &TerminalManager,
    session_id: &SessionId,
    connection_state: Arc<Mutex<ConnectionState>>,
    cwd: &str,
) -> Result<Option<RemoteClient>> {
    // Check if already attached
    {
        let state = connection_state.lock().await;
        if *state == ConnectionState::Attached {
            terminal.write_line(&format!(
                "\nAlready attached. Session ID: {}\n",
                session_id
            ))?;
            return Ok(None);
        }
    }

    // Update state to connecting
    {
        let mut state = connection_state.lock().await;
        *state = ConnectionState::Connecting;
    }

    // Try to get existing token
    let access_token = match keychain::get_access_token() {
        Ok(Some(token)) if token::is_valid(&token) => token,
        Ok(Some(token)) => {
            // Try refresh
            match keychain::get_refresh_token() {
                Ok(Some(refresh)) => {
                    match token::refresh(&refresh).await {
                        Ok((new_access, new_refresh)) => {
                            keychain::store_access_token(&new_access)?;
                            keychain::store_refresh_token(&new_refresh)?;
                            new_access
                        }
                        Err(_) => {
                            // Refresh failed, need re-auth
                            do_device_flow(terminal).await?
                        }
                    }
                }
                _ => do_device_flow(terminal).await?,
            }
        }
        _ => do_device_flow(terminal).await?,
    };

    // Get or create device ID
    let device_id = match keychain::get_device_id() {
        Ok(Some(id)) => DeviceId::from_string(id),
        _ => {
            let id = DeviceId::new();
            keychain::store_device_id(id.as_str())?;
            id
        }
    };

    // Get device name
    let device_name = hostname::get()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());

    // Connect WebSocket
    terminal.write_line("\nConnecting...")?;

    let client = RemoteClient::connect(
        &access_token,
        &device_id,
        session_id,
        &device_name,
        cwd,
    )
    .await?;

    // Update state
    {
        let mut state = connection_state.lock().await;
        *state = ConnectionState::Attached;
    }

    terminal.write_line(&format!(
        "\n✓ Attached. Session ID: {}\n",
        session_id
    ))?;

    Ok(Some(client))
}

async fn do_device_flow(terminal: &TerminalManager) -> Result<String> {
    terminal.write_line("\nStarting authentication...")?;

    let device_response = device_flow::request_device_code().await?;

    terminal.write_line(&format!(
        "\nTo attach this session, visit: {}\nEnter code: {}\n",
        device_response.verification_uri, device_response.user_code
    ))?;

    terminal.write_line("Waiting for authorization...")?;

    let token_response = device_flow::poll_for_token(
        &device_response.device_code,
        device_response.interval,
        device_response.expires_in,
    )
    .await?;

    // Store tokens
    keychain::store_access_token(&token_response.access_token)?;
    keychain::store_refresh_token(&token_response.refresh_token)?;

    Ok(token_response.access_token)
}
```

### 8.5 commands/detach.rs

```rust
use crate::{
    error::Result,
    remote::RemoteClient,
    terminal::TerminalManager,
    types::ConnectionState,
};
use std::sync::Arc;
use tokio::sync::Mutex;

pub async fn execute_detach(
    terminal: &TerminalManager,
    connection_state: Arc<Mutex<ConnectionState>>,
    remote: &mut Option<RemoteClient>,
) -> Result<()> {
    let state = *connection_state.lock().await;

    if state != ConnectionState::Attached {
        terminal.write_line("\nNot attached.\n")?;
        return Ok(());
    }

    // Send detach and close connection
    if let Some(client) = remote.take() {
        client.detach().await?;
    }

    // Update state
    {
        let mut state = connection_state.lock().await;
        *state = ConnectionState::Detached;
    }

    terminal.write_line("\nDetached. Continuing locally.\n")?;
    Ok(())
}
```

---

## 9. Remote Client

### 9.1 remote/mod.rs

```rust
pub mod messages;
pub mod queue;
pub mod reconnect;
pub mod websocket;

pub use websocket::RemoteClient;
```

### 9.2 remote/messages.rs

```rust
use serde::{Deserialize, Serialize};

/// Messages sent from CLI to server
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    SessionAttach {
        session_id: String,
        device_id: String,
        device_name: String,
        cwd: String,
    },
    Output {
        session_id: String,
        data: String, // base64 encoded
        timestamp: String,
    },
    SessionDetach {
        session_id: String,
    },
    Pong,
}

/// Messages received from server
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    Prompt {
        session_id: String,
        text: String,
        from: String,
        timestamp: String,
    },
    Resize {
        session_id: String,
        cols: u16,
        rows: u16,
    },
    Ping,
    Error {
        code: String,
        message: String,
    },
}
```

### 9.3 remote/websocket.rs

```rust
use crate::{
    config,
    error::{NexoError, Result},
    remote::messages::{IncomingMessage, OutgoingMessage},
    types::{DeviceId, SessionId},
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{http::Request, Message},
    MaybeTlsStream, WebSocketStream,
};

pub struct RemoteClient {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    session_id: SessionId,
}

impl RemoteClient {
    /// Connect to the WebSocket server
    pub async fn connect(
        access_token: &str,
        device_id: &DeviceId,
        session_id: &SessionId,
        device_name: &str,
        cwd: &str,
    ) -> Result<Self> {
        let request = Request::builder()
            .uri(config::WS_URL)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("X-Device-ID", device_id.as_str())
            .header("X-Session-ID", session_id.as_str())
            .header("Host", "api.nexo.dev")
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header(
                "Sec-WebSocket-Key",
                tokio_tungstenite::tungstenite::handshake::client::generate_key(),
            )
            .body(())
            .map_err(|e| NexoError::WebSocketError(e.into()))?;

        let (ws, _) = connect_async(request).await?;

        let mut client = Self {
            ws,
            session_id: session_id.clone(),
        };

        // Send attach message
        client
            .send(OutgoingMessage::SessionAttach {
                session_id: session_id.to_string(),
                device_id: device_id.as_str().to_string(),
                device_name: device_name.to_string(),
                cwd: cwd.to_string(),
            })
            .await?;

        Ok(client)
    }

    /// Send output to server
    pub async fn send_output(&mut self, data: &[u8]) -> Result<()> {
        let msg = OutgoingMessage::Output {
            session_id: self.session_id.to_string(),
            data: BASE64.encode(data),
            timestamp: Utc::now().to_rfc3339(),
        };
        self.send(msg).await
    }

    /// Send detach message and close
    pub async fn detach(mut self) -> Result<()> {
        let msg = OutgoingMessage::SessionDetach {
            session_id: self.session_id.to_string(),
        };
        self.send(msg).await?;
        self.ws.close(None).await?;
        Ok(())
    }

    /// Receive next message from server
    pub async fn recv(&mut self) -> Result<Option<IncomingMessage>> {
        match self.ws.next().await {
            Some(Ok(Message::Text(text))) => {
                let msg: IncomingMessage = serde_json::from_str(&text)
                    .map_err(|e| NexoError::Other(e.to_string()))?;

                // Handle ping automatically
                if matches!(msg, IncomingMessage::Ping) {
                    self.send(OutgoingMessage::Pong).await?;
                    return self.recv().await; // Get next real message
                }

                Ok(Some(msg))
            }
            Some(Ok(Message::Close(_))) => Ok(None),
            Some(Ok(_)) => self.recv().await, // Ignore binary, ping, pong
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    async fn send(&mut self, msg: OutgoingMessage) -> Result<()> {
        let json = serde_json::to_string(&msg)
            .map_err(|e| NexoError::Other(e.to_string()))?;
        self.ws.send(Message::Text(json)).await?;
        Ok(())
    }
}
```

### 9.4 remote/reconnect.rs

```rust
use crate::config;
use rand::Rng;
use std::time::Duration;
use tokio::time::sleep;

/// Reconnection state machine
pub struct Reconnector {
    attempt: u32,
}

impl Reconnector {
    pub fn new() -> Self {
        Self { attempt: 0 }
    }

    /// Get delay before next attempt, or None if max attempts exceeded
    pub fn next_delay(&mut self) -> Option<Duration> {
        if self.attempt >= config::RECONNECT_MAX_ATTEMPTS {
            return None;
        }

        let base = config::RECONNECT_BASE_DELAY_MS;
        let max = config::RECONNECT_MAX_DELAY_MS;
        let jitter = config::RECONNECT_JITTER_MS;

        // Exponential backoff with jitter
        let exp_delay = base.saturating_mul(2u64.saturating_pow(self.attempt));
        let jitter_value = rand::thread_rng().gen_range(0..=jitter);
        let delay = exp_delay.saturating_add(jitter_value).min(max);

        self.attempt += 1;
        Some(Duration::from_millis(delay))
    }

    /// Reset after successful connection
    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

/// Wait for reconnection delay
pub async fn wait(reconnector: &mut Reconnector) -> bool {
    if let Some(delay) = reconnector.next_delay() {
        sleep(delay).await;
        true
    } else {
        false
    }
}
```

### 9.5 remote/queue.rs

```rust
use crate::{config, remote::messages::OutgoingMessage};
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

struct QueuedMessage {
    message: OutgoingMessage,
    timestamp: Instant,
}

/// Message queue for buffering during reconnection
pub struct MessageQueue {
    messages: VecDeque<QueuedMessage>,
    max_size: usize,
    max_age: Duration,
}

impl MessageQueue {
    pub fn new() -> Self {
        Self {
            messages: VecDeque::new(),
            max_size: config::MESSAGE_QUEUE_MAX_SIZE,
            max_age: Duration::from_secs(config::MESSAGE_QUEUE_MAX_AGE_SECS),
        }
    }

    /// Add message to queue
    pub fn push(&mut self, message: OutgoingMessage) {
        // Drop oldest if full
        if self.messages.len() >= self.max_size {
            self.messages.pop_front();
        }

        self.messages.push_back(QueuedMessage {
            message,
            timestamp: Instant::now(),
        });
    }

    /// Get all valid messages and clear queue
    pub fn drain(&mut self) -> Vec<OutgoingMessage> {
        let now = Instant::now();
        let max_age = self.max_age;

        self.messages
            .drain(..)
            .filter(|q| now.duration_since(q.timestamp) < max_age)
            .map(|q| q.message)
            .collect()
    }

    /// Check if queue has messages
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }

    /// Number of messages in queue
    pub fn len(&self) -> usize {
        self.messages.len()
    }
}
```

---

## 10. Authentication

### 10.1 auth/mod.rs

```rust
pub mod device_flow;
pub mod keychain;
pub mod token;
```

### 10.2 auth/device_flow.rs

```rust
use crate::{config, error::{NexoError, Result}};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TokenPollResponse {
    Success(TokenResponse),
    Pending { error: String },
}

/// Request a device code for OAuth Device Flow
pub async fn request_device_code() -> Result<DeviceCodeResponse> {
    let client = reqwest::Client::new();
    let url = format!("{}/auth/device", config::API_BASE_URL);

    let response = client
        .post(&url)
        .send()
        .await?
        .json::<DeviceCodeResponse>()
        .await?;

    Ok(response)
}

/// Poll for token after user authorizes
pub async fn poll_for_token(
    device_code: &str,
    interval: u64,
    expires_in: u64,
) -> Result<TokenResponse> {
    let client = reqwest::Client::new();
    let url = format!("{}/auth/token", config::API_BASE_URL);

    let poll_interval = Duration::from_secs(interval);
    let max_polls = expires_in / interval;

    for _ in 0..max_polls {
        sleep(poll_interval).await;

        let response = client
            .post(&url)
            .json(&serde_json::json!({
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
            }))
            .send()
            .await?;

        match response.json::<TokenPollResponse>().await? {
            TokenPollResponse::Success(token) => return Ok(token),
            TokenPollResponse::Pending { error } => {
                match error.as_str() {
                    "authorization_pending" => continue,
                    "slow_down" => {
                        sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                    "expired_token" => {
                        return Err(NexoError::AuthError(
                            "Authorization expired".to_string(),
                        ));
                    }
                    "access_denied" => {
                        return Err(NexoError::AuthError(
                            "Authorization denied".to_string(),
                        ));
                    }
                    _ => {
                        return Err(NexoError::AuthError(format!(
                            "Unexpected error: {}",
                            error
                        )));
                    }
                }
            }
        }
    }

    Err(NexoError::AuthError("Authorization timed out".to_string()))
}
```

### 10.3 auth/keychain.rs

```rust
use crate::{config, error::{NexoError, Result}};

/// Get entry for a key
fn entry(key: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(config::KEYCHAIN_SERVICE, key)
        .map_err(|e| NexoError::KeychainError(e.to_string()))
}

/// Store a value in keychain
fn store(key: &str, value: &str) -> Result<()> {
    entry(key)?
        .set_password(value)
        .map_err(|e| NexoError::KeychainError(e.to_string()))
}

/// Get a value from keychain
fn get(key: &str) -> Result<Option<String>> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(NexoError::KeychainError(e.to_string())),
    }
}

/// Delete a value from keychain
fn delete(key: &str) -> Result<()> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(NexoError::KeychainError(e.to_string())),
    }
}

// Access token
pub fn store_access_token(token: &str) -> Result<()> {
    store("access_token", token)
}

pub fn get_access_token() -> Result<Option<String>> {
    get("access_token")
}

pub fn delete_access_token() -> Result<()> {
    delete("access_token")
}

// Refresh token
pub fn store_refresh_token(token: &str) -> Result<()> {
    store("refresh_token", token)
}

pub fn get_refresh_token() -> Result<Option<String>> {
    get("refresh_token")
}

pub fn delete_refresh_token() -> Result<()> {
    delete("refresh_token")
}

// Device ID
pub fn store_device_id(id: &str) -> Result<()> {
    store("device_id", id)
}

pub fn get_device_id() -> Result<Option<String>> {
    get("device_id")
}

// Device key (Ed25519 private key, base64 encoded)
pub fn store_device_key(key: &str) -> Result<()> {
    store("device_key", key)
}

pub fn get_device_key() -> Result<Option<String>> {
    get("device_key")
}

/// Clear all stored credentials
pub fn clear_all() -> Result<()> {
    delete_access_token()?;
    delete_refresh_token()?;
    Ok(())
}
```

### 10.4 auth/token.rs

```rust
use crate::{config, error::Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Claims {
    exp: u64,
}

/// Check if token is still valid (not expired)
pub fn is_valid(token: &str) -> bool {
    // Decode JWT payload (without verification - server will verify)
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return false;
    }

    let payload = match base64::Engine::decode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        parts[1],
    ) {
        Ok(p) => p,
        Err(_) => return false,
    };

    let claims: Claims = match serde_json::from_slice(&payload) {
        Ok(c) => c,
        Err(_) => return false,
    };

    // Add 60 second buffer
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    claims.exp > now + 60
}

/// Refresh access token using refresh token
pub async fn refresh(refresh_token: &str) -> Result<(String, String)> {
    let client = reqwest::Client::new();
    let url = format!("{}/auth/refresh", config::API_BASE_URL);

    #[derive(Deserialize)]
    struct RefreshResponse {
        access_token: String,
        refresh_token: String,
    }

    let response: RefreshResponse = client
        .post(&url)
        .json(&serde_json::json!({
            "refresh_token": refresh_token
        }))
        .send()
        .await?
        .json()
        .await?;

    Ok((response.access_token, response.refresh_token))
}
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

Place unit tests in the same file as the code under test:

```rust
// In interceptor.rs
#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn test_command_detection() {
        let (tx, mut rx) = mpsc::channel(16);
        let mut interceptor = CommandInterceptor::new(tx);

        // Type "/help\n"
        let forward = interceptor.process(b"/help\n").await;

        // Nothing should be forwarded
        assert!(forward.is_empty());

        // Command should be received
        let cmd = rx.recv().await.unwrap();
        assert!(matches!(cmd, Command::Help));
    }

    #[tokio::test]
    async fn test_double_slash_escape() {
        let (tx, _rx) = mpsc::channel(16);
        let mut interceptor = CommandInterceptor::new(tx);

        let forward = interceptor.process(b"//").await;

        // Single slash should be forwarded
        assert_eq!(forward, vec![b'/']);
    }

    #[tokio::test]
    async fn test_non_command_passthrough() {
        let (tx, _rx) = mpsc::channel(16);
        let mut interceptor = CommandInterceptor::new(tx);

        let forward = interceptor.process(b"/unknown\n").await;

        // Full input should be forwarded
        assert_eq!(forward, b"/unknown\n");
    }
}
```

### 11.2 Integration Tests

```rust
// tests/integration/pty_test.rs
use nexo::pty::PtyManager;

#[tokio::test]
async fn test_pty_spawn() {
    let pty = PtyManager::spawn("echo", &["hello".to_string()])
        .expect("Failed to spawn PTY");

    let mut buf = [0u8; 1024];
    let n = pty.read(&mut buf).await.expect("Failed to read");

    let output = String::from_utf8_lossy(&buf[..n]);
    assert!(output.contains("hello"));
}
```

### 11.3 Mock Server for WebSocket Tests

```rust
// tests/integration/mock_server.rs
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

pub async fn start_mock_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let ws = accept_async(stream).await.unwrap();
            // Handle messages...
        }
    });

    format!("ws://127.0.0.1:{}", addr.port())
}
```

---

## 12. Build and Distribution

### 12.1 Cross-Platform Build Script

Create `scripts/build.sh`:

```bash
#!/bin/bash
set -e

VERSION=$(grep '^version' Cargo.toml | head -1 | cut -d'"' -f2)
TARGETS=(
    "x86_64-apple-darwin"
    "aarch64-apple-darwin"
    "x86_64-unknown-linux-gnu"
    "aarch64-unknown-linux-gnu"
    "x86_64-pc-windows-msvc"
)

echo "Building nexo v${VERSION}"

mkdir -p dist

for target in "${TARGETS[@]}"; do
    echo "Building for ${target}..."

    cross build --release --target "$target"

    if [[ "$target" == *"windows"* ]]; then
        cp "target/${target}/release/nexo.exe" "dist/nexo-${VERSION}-${target}.exe"
    else
        cp "target/${target}/release/nexo" "dist/nexo-${VERSION}-${target}"
    fi
done

echo "Build complete!"
ls -la dist/
```

### 12.2 GitHub Actions Workflow

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
          - os: windows-latest
            target: x86_64-pc-windows-msvc

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Install Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: ${{ matrix.target }}

      - name: Build
        run: cargo build --release --target ${{ matrix.target }}

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: nexo-${{ matrix.target }}
          path: target/${{ matrix.target }}/release/nexo*

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Download artifacts
        uses: actions/download-artifact@v4

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: nexo-*/nexo*
```

---

## 13. Development Workflow

### 13.1 Local Development

```bash
# Build and run
cargo run -- -p "Hello"

# Run tests
cargo test

# Run with logging
RUST_LOG=nexo=debug cargo run

# Check formatting
cargo fmt --check

# Lint
cargo clippy -- -D warnings
```

### 13.2 Pre-commit Checks

Add to `packages/cli/scripts/pre-commit.sh`:

```bash
#!/bin/bash
set -e

echo "Running pre-commit checks..."

# Format check
cargo fmt --check

# Clippy
cargo clippy -- -D warnings

# Tests
cargo test

echo "All checks passed!"
```

---

## 14. Implementation Order

Recommended implementation sequence for MVP:

### Phase 1: Local-Only CLI
1. `main.rs` - Entry point with clap
2. `terminal.rs` - Raw mode handling
3. `pty.rs` - Claude Code spawning
4. `app.rs` - Basic I/O loop (stdin → PTY, PTY → stdout)
5. Test: `nexo` works identically to `claude`

### Phase 2: Command Interception
1. `interceptor.rs` - State machine
2. `commands/help.rs` - Simple command
3. `commands/status.rs` - Session info
4. Test: `/help` and `/status` work, other input passes through

### Phase 3: Authentication
1. `auth/keychain.rs` - Credential storage
2. `auth/device_flow.rs` - OAuth implementation
3. `auth/token.rs` - Token validation
4. Test: Full device flow against mock/real server

### Phase 4: Remote Connectivity
1. `remote/messages.rs` - Message types
2. `remote/websocket.rs` - WebSocket client
3. `remote/queue.rs` - Message buffering
4. `remote/reconnect.rs` - Reconnection logic
5. `commands/attach.rs` - Full attach flow
6. `commands/detach.rs` - Detach flow
7. Test: Attach, send/receive, detach

### Phase 5: Polish
1. Error handling improvements
2. Cross-platform testing
3. Performance optimization
4. Documentation
