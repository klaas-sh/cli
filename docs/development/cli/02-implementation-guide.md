# Klaas CLI Implementation Guide

**Version:** 0.2.0
**Status:** Draft
**Last Updated:** January 2025

---

## 1. Overview

The Klaas CLI wraps Claude Code with automatic remote access. On startup, the CLI
authenticates (if needed), connects to the SessionHub via WebSocket, and streams
all PTY I/O bidirectionally. No user commands are required - the connection is
always on.

### Architecture Flow

```
1. CLI starts
2. Check keychain for stored credentials
3. If no credentials → OAuth Device Flow (show code, wait for auth)
4. Connect WebSocket to SessionHub
5. Start full duplex streaming:
   - PTY output → WebSocket (to remote viewers)
   - WebSocket input → PTY (from remote prompts)
6. On CLI exit (Ctrl+C or process end) → disconnect WebSocket
```

---

## 2. Project Setup

### 2.1 Directory Structure

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

### 2.2 Cargo.toml

```toml
[package]
name = "nexo"
version = "0.2.0"
edition = "2021"
authors = ["Klaas Team"]
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

# Hostname
hostname = "0.3"

[dev-dependencies]
tokio-test = "0.4"
mockall = "0.12"
tempfile = "3"

[profile.release]
lto = true
codegen-units = 1
strip = true
```

### 2.3 Build Configuration

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

## 3. Core Types

### 3.1 types.rs

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
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
}
```

### 3.2 error.rs

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum KlaasError {
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

pub type Result<T> = std::result::Result<T, KlaasError>;
```

### 3.3 config.rs

```rust
/// API base URL
pub const API_BASE_URL: &str = "https://api.nexo.dev";

/// WebSocket URL
pub const WS_URL: &str = "wss://api.nexo.dev/ws";

/// Keychain service name
pub const KEYCHAIN_SERVICE: &str = "dev.nexo.cli";

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
```

---

## 4. Entry Point

### 4.1 main.rs

```rust
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod app;
mod auth;
mod config;
mod error;
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

## 5. Application Orchestration

### 5.1 app.rs

The app orchestrates startup, authentication, WebSocket connection, and the
main I/O loop. All remote connectivity happens automatically on startup.

```rust
use crate::{
    auth::{device_flow, keychain, token},
    config,
    error::{KlaasError, Result},
    pty::PtyManager,
    remote::RemoteClient,
    terminal::TerminalManager,
    types::{ConnectionState, DeviceId, SessionId},
};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Run the application
pub async fn run(claude_args: Vec<String>) -> Result<i32> {
    // Generate session ID
    let session_id = SessionId::new();
    tracing::info!("Starting session: {}", session_id);

    // Authenticate (blocking if device flow needed)
    let access_token = authenticate().await?;

    // Get or create device ID
    let device_id = get_or_create_device_id()?;
    let device_name = get_device_name();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // Set up terminal (raw mode)
    let mut terminal = TerminalManager::new()?;
    terminal.enter_raw_mode()?;

    // Spawn Claude Code in PTY
    let pty = PtyManager::spawn("claude", &claude_args)?;

    // Connect WebSocket to SessionHub
    tracing::info!("Connecting to SessionHub...");
    let remote = RemoteClient::connect(
        &access_token,
        &device_id,
        &session_id,
        &device_name,
        &cwd,
    )
    .await?;

    tracing::info!("Connected. Session ID: {}", session_id);

    // Run the main I/O loop with full duplex streaming
    let exit_code = run_io_loop(pty, terminal, remote, session_id).await?;

    Ok(exit_code)
}

/// Authenticate using stored credentials or device flow
async fn authenticate() -> Result<String> {
    // Try existing token
    if let Ok(Some(token)) = keychain::get_access_token() {
        if token::is_valid(&token) {
            tracing::debug!("Using stored access token");
            return Ok(token);
        }

        // Try refresh
        if let Ok(Some(refresh)) = keychain::get_refresh_token() {
            if let Ok((new_access, new_refresh)) = token::refresh(&refresh).await {
                keychain::store_access_token(&new_access)?;
                keychain::store_refresh_token(&new_refresh)?;
                tracing::debug!("Refreshed access token");
                return Ok(new_access);
            }
        }
    }

    // Need device flow
    tracing::info!("Starting authentication...");
    do_device_flow().await
}

/// Run OAuth Device Flow
async fn do_device_flow() -> Result<String> {
    let device_response = device_flow::request_device_code().await?;

    // Display auth instructions to user
    eprintln!();
    eprintln!("To authenticate, visit: {}", device_response.verification_uri);
    eprintln!("Enter code: {}", device_response.user_code);
    eprintln!();
    eprintln!("Waiting for authorization...");

    let token_response = device_flow::poll_for_token(
        &device_response.device_code,
        device_response.interval,
        device_response.expires_in,
    )
    .await?;

    // Store tokens
    keychain::store_access_token(&token_response.access_token)?;
    keychain::store_refresh_token(&token_response.refresh_token)?;

    eprintln!("Authenticated successfully.");
    eprintln!();

    Ok(token_response.access_token)
}

/// Get or create device ID
fn get_or_create_device_id() -> Result<DeviceId> {
    match keychain::get_device_id() {
        Ok(Some(id)) => Ok(DeviceId::from_string(id)),
        _ => {
            let id = DeviceId::new();
            keychain::store_device_id(id.as_str())?;
            Ok(id)
        }
    }
}

/// Get device name from hostname
fn get_device_name() -> String {
    hostname::get()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string())
}

/// Main I/O loop - full duplex streaming between PTY and WebSocket
async fn run_io_loop(
    pty: PtyManager,
    terminal: TerminalManager,
    mut remote: RemoteClient,
    session_id: SessionId,
) -> Result<i32> {
    use tokio::select;

    // Create channels for PTY I/O
    let (pty_output_tx, mut pty_output_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

    // Spawn PTY reader task
    let pty_reader = pty.clone_reader();
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match pty_reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    if pty_output_tx.send(buf[..n].to_vec()).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Spawn stdin reader task
    let (stdin_tx, mut stdin_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);
    tokio::spawn(async move {
        use std::io::Read;
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 1024];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if stdin_tx.send(buf[..n].to_vec()).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    loop {
        select! {
            // PTY output → terminal + WebSocket
            Some(output) = pty_output_rx.recv() => {
                // Write to local terminal
                terminal.write(&output)?;

                // Stream to remote viewers
                if let Err(e) = remote.send_output(&output).await {
                    tracing::warn!("Failed to send output: {}", e);
                    // Continue - don't fail locally if remote fails
                }
            }

            // Local stdin → PTY
            Some(input) = stdin_rx.recv() => {
                pty.write(&input).await?;
            }

            // WebSocket messages → PTY
            msg = remote.recv() => {
                match msg {
                    Ok(Some(crate::remote::messages::IncomingMessage::Prompt { text, .. })) => {
                        // Remote prompt - write to PTY
                        pty.write(text.as_bytes()).await?;
                    }
                    Ok(Some(crate::remote::messages::IncomingMessage::Resize { cols, rows, .. })) => {
                        // Resize PTY (for remote viewer sizing)
                        let _ = pty.resize(cols, rows).await;
                    }
                    Ok(Some(crate::remote::messages::IncomingMessage::Error { message, .. })) => {
                        tracing::error!("Server error: {}", message);
                    }
                    Ok(Some(_)) => {} // Ping handled internally
                    Ok(None) => {
                        // WebSocket closed - attempt reconnect
                        tracing::warn!("WebSocket disconnected");
                        // Reconnection handled by RemoteClient
                    }
                    Err(e) => {
                        tracing::warn!("WebSocket error: {}", e);
                    }
                }
            }

            // PTY process exited
            else => {
                tracing::info!("PTY process exited");
                break;
            }
        }
    }

    // Disconnect WebSocket on exit
    let _ = remote.disconnect().await;

    Ok(pty.exit_code().unwrap_or(0))
}
```

---

## 6. PTY Management

### 6.1 pty.rs

```rust
use crate::error::{KlaasError, Result};
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
        let size = get_terminal_size();

        let pair = pty_system
            .openpty(size)
            .map_err(|e| KlaasError::SpawnError(e.to_string()))?;

        let mut cmd = CommandBuilder::new(command);
        for arg in args {
            cmd.arg(arg);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| KlaasError::SpawnError(e.to_string()))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| KlaasError::SpawnError(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| KlaasError::SpawnError(e.to_string()))?;

        Ok(Self {
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
            reader: Arc::new(Mutex::new(reader)),
            writer: Arc::new(Mutex::new(writer)),
        })
    }

    /// Clone the reader for async reading
    pub fn clone_reader(&self) -> PtyReader {
        PtyReader {
            reader: self.reader.clone(),
        }
    }

    /// Write bytes to PTY stdin
    pub async fn write(&self, data: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock().await;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
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
            .map_err(KlaasError::PtyError)?;
        Ok(())
    }

    /// Get exit code (if process has exited)
    pub fn exit_code(&self) -> Option<i32> {
        None // Implementation depends on portable-pty version
    }
}

/// Reader handle for async PTY output reading
pub struct PtyReader {
    reader: Arc<Mutex<Box<dyn Read + Send>>>,
}

impl PtyReader {
    /// Read bytes from PTY (blocking)
    pub fn read(&self, buf: &mut [u8]) -> std::io::Result<usize> {
        // Use blocking read in spawned task
        let reader = self.reader.blocking_lock();
        // Note: This is simplified - real impl needs proper async
        Ok(0) // Placeholder
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

## 7. Terminal Management

### 7.1 terminal.rs

```rust
use crate::error::Result;
use crossterm::terminal;
use std::io::{self, Write};

/// Manages terminal raw mode
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

    /// Write to stdout
    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut stdout = io::stdout();
        stdout.write_all(data)?;
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
        let _ = self.exit_raw_mode();
    }
}
```

---

## 8. Remote Client

### 8.1 remote/mod.rs

```rust
pub mod messages;
pub mod queue;
pub mod reconnect;
pub mod websocket;

pub use websocket::RemoteClient;
```

### 8.2 remote/messages.rs

```rust
use serde::{Deserialize, Serialize};

/// Messages sent from CLI to server
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    SessionConnect {
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
    SessionDisconnect {
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

### 8.3 remote/websocket.rs

```rust
use crate::{
    config,
    error::{KlaasError, Result},
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
            .map_err(|e| KlaasError::WebSocketError(e.into()))?;

        let (ws, _) = connect_async(request).await?;

        let mut client = Self {
            ws,
            session_id: session_id.clone(),
        };

        // Send connect message
        client
            .send(OutgoingMessage::SessionConnect {
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

    /// Disconnect and close WebSocket
    pub async fn disconnect(mut self) -> Result<()> {
        let msg = OutgoingMessage::SessionDisconnect {
            session_id: self.session_id.to_string(),
        };
        let _ = self.send(msg).await;
        let _ = self.ws.close(None).await;
        Ok(())
    }

    /// Receive next message from server
    pub async fn recv(&mut self) -> Result<Option<IncomingMessage>> {
        match self.ws.next().await {
            Some(Ok(Message::Text(text))) => {
                let msg: IncomingMessage = serde_json::from_str(&text)
                    .map_err(|e| KlaasError::Other(e.to_string()))?;

                // Handle ping automatically
                if matches!(msg, IncomingMessage::Ping) {
                    self.send(OutgoingMessage::Pong).await?;
                    return self.recv().await;
                }

                Ok(Some(msg))
            }
            Some(Ok(Message::Close(_))) => Ok(None),
            Some(Ok(_)) => self.recv().await,
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    async fn send(&mut self, msg: OutgoingMessage) -> Result<()> {
        let json = serde_json::to_string(&msg)
            .map_err(|e| KlaasError::Other(e.to_string()))?;
        self.ws.send(Message::Text(json)).await?;
        Ok(())
    }
}
```

### 8.4 remote/reconnect.rs

```rust
use crate::config;
use rand::Rng;
use std::time::Duration;
use tokio::time::sleep;

/// Reconnection state machine with exponential backoff
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

### 8.5 remote/queue.rs

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

    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }

    pub fn len(&self) -> usize {
        self.messages.len()
    }
}
```

---

## 9. Authentication

### 9.1 auth/mod.rs

```rust
pub mod device_flow;
pub mod keychain;
pub mod token;
```

### 9.2 auth/device_flow.rs

```rust
use crate::{config, error::{KlaasError, Result}};
use serde::Deserialize;
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
            TokenPollResponse::Pending { error } => match error.as_str() {
                "authorization_pending" => continue,
                "slow_down" => {
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }
                "expired_token" => {
                    return Err(KlaasError::AuthError("Authorization expired".to_string()));
                }
                "access_denied" => {
                    return Err(KlaasError::AuthError("Authorization denied".to_string()));
                }
                _ => {
                    return Err(KlaasError::AuthError(format!(
                        "Unexpected error: {}",
                        error
                    )));
                }
            },
        }
    }

    Err(KlaasError::AuthError("Authorization timed out".to_string()))
}
```

### 9.3 auth/keychain.rs

```rust
use crate::{config, error::{KlaasError, Result}};

fn entry(key: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(config::KEYCHAIN_SERVICE, key)
        .map_err(|e| KlaasError::KeychainError(e.to_string()))
}

fn store(key: &str, value: &str) -> Result<()> {
    entry(key)?
        .set_password(value)
        .map_err(|e| KlaasError::KeychainError(e.to_string()))
}

fn get(key: &str) -> Result<Option<String>> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(KlaasError::KeychainError(e.to_string())),
    }
}

fn delete(key: &str) -> Result<()> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(KlaasError::KeychainError(e.to_string())),
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

/// Clear all stored credentials
pub fn clear_all() -> Result<()> {
    delete_access_token()?;
    delete_refresh_token()?;
    Ok(())
}
```

### 9.4 auth/token.rs

```rust
use crate::{config, error::Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Claims {
    exp: u64,
}

/// Check if token is still valid (not expired)
pub fn is_valid(token: &str) -> bool {
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

## 10. Testing

### 10.1 Unit Tests

Place unit tests in the same file as the code under test:

```rust
// In auth/token.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_token_format() {
        assert!(!is_valid("not.a.valid.token"));
        assert!(!is_valid(""));
        assert!(!is_valid("only.two"));
    }
}
```

### 10.2 Integration Tests

```rust
// tests/integration/pty_test.rs
use nexo::pty::PtyManager;

#[tokio::test]
async fn test_pty_spawn() {
    let pty = PtyManager::spawn("echo", &["hello".to_string()])
        .expect("Failed to spawn PTY");

    // PTY should be created successfully
    assert!(pty.exit_code().is_none());
}
```

---

## 11. Development Workflow

### 11.1 Local Development

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

### 11.2 Pre-commit Checks

```bash
#!/bin/bash
set -e

echo "Running pre-commit checks..."

cargo fmt --check
cargo clippy -- -D warnings
cargo test

echo "All checks passed!"
```

---

## 12. Implementation Order

### Phase 1: Local-Only CLI
1. `main.rs` - Entry point with clap
2. `terminal.rs` - Raw mode handling
3. `pty.rs` - Claude Code spawning
4. `app.rs` - Basic I/O loop (stdin -> PTY, PTY -> stdout)
5. Test: `nexo` works identically to `claude`

### Phase 2: Authentication
1. `auth/keychain.rs` - Credential storage
2. `auth/device_flow.rs` - OAuth implementation
3. `auth/token.rs` - Token validation
4. Test: Full device flow against mock/real server

### Phase 3: Remote Connectivity
1. `remote/messages.rs` - Message types
2. `remote/websocket.rs` - WebSocket client
3. `remote/queue.rs` - Message buffering
4. `remote/reconnect.rs` - Reconnection logic
5. Update `app.rs` - Auto-connect on startup, full duplex streaming
6. Test: Connect, stream output, receive prompts, disconnect on exit

### Phase 4: Polish
1. Error handling improvements
2. Cross-platform testing
3. Performance optimization
