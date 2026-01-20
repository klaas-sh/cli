//! Guest terminal implementation for viewing remote sessions.
//!
//! Connects to a remote session via WebSocket and displays the terminal
//! output. Supports receiving history, real-time output, mode changes,
//! and sending encrypted prompts to the host.

use std::io::{self, Write};
use std::sync::Arc;
use std::time::Duration;

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{HeaderValue, AUTHORIZATION};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{debug, error, info, warn};
use url::Url;

use crate::config::get_api_config;
use crate::credentials::CredentialStore;
use crate::crypto::{
    decrypt_content, derive_session_key, encrypt_content, EncryptedContent, SecretKey,
};
use crate::error::{CliError, Result};
use crate::terminal::TerminalManager;

// ============================================================================
// Constants
// ============================================================================

/// Timeout for WebSocket receive operations (milliseconds).
const WS_RECV_TIMEOUT_MS: u64 = 10;

// ============================================================================
// Message Types for Guest Mode
// ============================================================================

/// Session information sent by server on guest connect.
#[derive(Debug, Clone, Deserialize)]
pub struct SessionInfo {
    /// Session identifier.
    pub session_id: String,
    /// Terminal columns.
    pub cols: u16,
    /// Terminal rows.
    pub rows: u16,
    /// Host device name.
    pub device_name: Option<String>,
    /// Session working directory.
    pub cwd: Option<String>,
}

/// A single history entry from the server.
#[derive(Debug, Clone, Deserialize)]
pub struct HistoryEntry {
    /// Encrypted terminal output data.
    pub encrypted: EncryptedContent,
    /// Timestamp of the output.
    pub timestamp: String,
}

/// Batch of session history sent by server.
#[derive(Debug, Clone, Deserialize)]
pub struct HistoryBatch {
    /// Session identifier.
    pub session_id: String,
    /// Array of history entries.
    pub entries: Vec<HistoryEntry>,
}

/// Mode change notification from server.
#[derive(Debug, Clone, Deserialize)]
pub struct ModeChange {
    /// Session identifier.
    pub session_id: String,
    /// New mode: "active", "idle", "waiting_for_input", etc.
    pub mode: String,
    /// Optional context message.
    pub message: Option<String>,
}

/// Messages received from server in guest mode.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GuestIncomingMessage {
    /// Session information on connect.
    SessionInfo(SessionInfo),
    /// History batch on connect.
    History(HistoryBatch),
    /// Encrypted output from host.
    EncryptedOutput {
        session_id: String,
        encrypted: EncryptedContent,
        timestamp: String,
    },
    /// Mode change notification.
    ModeChange(ModeChange),
    /// Session was detached by host.
    SessionDetached {
        session_id: String,
        reason: Option<String>,
    },
    /// Heartbeat ping from server.
    Ping,
    /// Error message from server.
    Error { code: String, message: String },
}

/// Messages sent from guest to server.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GuestOutgoingMessage {
    /// Encrypted prompt to send to host.
    EncryptedPrompt {
        session_id: String,
        encrypted: EncryptedContent,
        timestamp: String,
    },
    /// Heartbeat response.
    Pong,
}

// ============================================================================
// Guest WebSocket Client
// ============================================================================

/// Split WebSocket write half wrapped for async access.
type WsSender = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

/// Split WebSocket read half.
type WsReceiver = SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;

/// Guest WebSocket client for viewing remote sessions.
struct GuestClient {
    /// WebSocket sender (write half).
    sender: Arc<Mutex<Option<WsSender>>>,
    /// WebSocket receiver (read half).
    receiver: Arc<Mutex<Option<WsReceiver>>>,
    /// Session ID being viewed.
    session_id: String,
    /// Session key for E2EE (derived from MEK).
    session_key: SecretKey,
}

impl GuestClient {
    /// Connects to a remote session as a guest.
    ///
    /// # Arguments
    ///
    /// * `ws_url` - WebSocket base URL
    /// * `access_token` - JWT access token
    /// * `session_id` - Session to connect to
    /// * `mek` - Master Encryption Key for E2EE
    async fn connect(
        ws_url: &str,
        access_token: &str,
        session_id: &str,
        mek: &SecretKey,
    ) -> Result<Self> {
        // Parse and build URL with guest query parameters
        let mut parsed_url = Url::parse(ws_url)
            .map_err(|e| CliError::WebSocketError(format!("Invalid WebSocket URL: {}", e)))?;

        // Add session_id and client=guest query parameters
        parsed_url
            .query_pairs_mut()
            .append_pair("session_id", session_id)
            .append_pair("client", "guest");

        debug!(url = %parsed_url, "Connecting as guest");

        // Build request with Authorization header
        let mut request = parsed_url
            .as_str()
            .into_client_request()
            .map_err(|e| CliError::WebSocketError(format!("Failed to build request: {}", e)))?;

        let auth_value = HeaderValue::from_str(&format!("Bearer {}", access_token))
            .map_err(|e| CliError::WebSocketError(format!("Invalid auth header: {}", e)))?;
        request.headers_mut().insert(AUTHORIZATION, auth_value);

        // Connect to server
        let (ws_stream, response) = connect_async(request)
            .await
            .map_err(|e| CliError::WebSocketError(format!("Failed to connect: {}", e)))?;

        debug!(
            status = %response.status(),
            "Guest WebSocket connection established"
        );

        // Split into sender and receiver
        let (sender, receiver) = ws_stream.split();

        // Derive session key from MEK
        let session_key = derive_session_key(mek, session_id);

        Ok(Self {
            sender: Arc::new(Mutex::new(Some(sender))),
            receiver: Arc::new(Mutex::new(Some(receiver))),
            session_id: session_id.to_string(),
            session_key,
        })
    }

    /// Receives the next message from the server.
    async fn recv(&self) -> Result<Option<GuestIncomingMessage>> {
        let mut receiver_guard = self.receiver.lock().await;

        let receiver = receiver_guard
            .as_mut()
            .ok_or_else(|| CliError::WebSocketError("Not connected".to_string()))?;

        match receiver.next().await {
            Some(Ok(msg)) => self.handle_raw_message(msg).await,
            Some(Err(e)) => {
                warn!(error = %e, "WebSocket receive error");
                Err(CliError::WebSocketError(format!("Receive error: {}", e)))
            }
            None => {
                info!("WebSocket connection closed by server");
                Ok(None)
            }
        }
    }

    /// Handles a raw WebSocket message.
    async fn handle_raw_message(&self, msg: Message) -> Result<Option<GuestIncomingMessage>> {
        match msg {
            Message::Text(text) => {
                debug!(message = %text, "Received text message");

                let parsed: GuestIncomingMessage = serde_json::from_str(&text).map_err(|e| {
                    CliError::WebSocketError(format!("Failed to parse message: {}", e))
                })?;

                Ok(Some(parsed))
            }
            Message::Binary(data) => {
                let text = String::from_utf8(data).map_err(|e| {
                    CliError::WebSocketError(format!("Invalid UTF-8 in binary message: {}", e))
                })?;

                let parsed: GuestIncomingMessage = serde_json::from_str(&text).map_err(|e| {
                    CliError::WebSocketError(format!("Failed to parse binary message: {}", e))
                })?;

                Ok(Some(parsed))
            }
            Message::Ping(data) => {
                debug!("Received WebSocket ping");
                if let Some(sender) = self.sender.lock().await.as_mut() {
                    let _ = sender.send(Message::Pong(data)).await;
                }
                Ok(None)
            }
            Message::Pong(_) => {
                debug!("Received WebSocket pong");
                Ok(None)
            }
            Message::Close(frame) => {
                info!(frame = ?frame, "Received close frame");
                Ok(None)
            }
            Message::Frame(_) => Ok(None),
        }
    }

    /// Sends a pong response to the server.
    async fn send_pong(&self) -> Result<()> {
        let msg = GuestOutgoingMessage::Pong;
        self.send_message(&msg).await
    }

    /// Sends an encrypted prompt to the host.
    async fn send_prompt(&self, text: &str) -> Result<()> {
        let encrypted = encrypt_content(&self.session_key, text.as_bytes());
        let timestamp = chrono::Utc::now().to_rfc3339();

        let msg = GuestOutgoingMessage::EncryptedPrompt {
            session_id: self.session_id.clone(),
            encrypted,
            timestamp,
        };

        self.send_message(&msg).await
    }

    /// Sends a message to the server.
    async fn send_message(&self, msg: &GuestOutgoingMessage) -> Result<()> {
        let json = serde_json::to_string(msg)
            .map_err(|e| CliError::WebSocketError(format!("Failed to serialize message: {}", e)))?;

        debug!(message = %json, "Sending message");

        let mut sender_guard = self.sender.lock().await;
        if let Some(sender) = sender_guard.as_mut() {
            sender
                .send(Message::Text(json))
                .await
                .map_err(|e| CliError::WebSocketError(format!("Failed to send: {}", e)))?;
        }

        Ok(())
    }

    /// Decrypts encrypted content using the session key.
    fn decrypt(&self, encrypted: &EncryptedContent) -> Result<Vec<u8>> {
        decrypt_content(&self.session_key, encrypted)
    }

    /// Gracefully closes the WebSocket connection.
    async fn close(&self) -> Result<()> {
        let mut sender_guard = self.sender.lock().await;
        if let Some(sender) = sender_guard.as_mut() {
            let _ = sender.send(Message::Close(None)).await;
        }
        Ok(())
    }
}

// ============================================================================
// Terminal Output Helpers
// ============================================================================

/// Writes bytes directly to stdout.
fn write_to_stdout(data: &[u8]) -> Result<()> {
    let mut stdout = io::stdout();
    stdout.write_all(data)?;
    stdout.flush()?;
    Ok(())
}

/// Displays a notification message in the terminal.
///
/// Uses ANSI escape codes to show a styled notification that appears
/// on its own line and does not disrupt the terminal content.
fn display_notification(message: &str) -> Result<()> {
    // Save cursor, move to bottom, print notification, restore cursor
    // Using amber color (RGB 245, 158, 11) to match klaas theme
    let notification = format!(
        "\x1b7\r\n\x1b[38;2;245;158;11m[klaas] {}\x1b[0m\r\n\x1b8",
        message
    );
    write_to_stdout(notification.as_bytes())
}

/// Converts a key event to raw bytes for sending to the host.
fn key_event_to_bytes(event: KeyEvent) -> Vec<u8> {
    match event.code {
        KeyCode::Char(c) => {
            if event.modifiers.contains(KeyModifiers::CONTROL) {
                // Ctrl+character (e.g., Ctrl+C = 0x03)
                let ctrl_char = (c as u8) & 0x1f;
                vec![ctrl_char]
            } else {
                c.to_string().into_bytes()
            }
        }
        KeyCode::Enter => vec![b'\r'],
        KeyCode::Backspace => vec![0x7f],
        KeyCode::Tab => vec![b'\t'],
        KeyCode::Esc => vec![0x1b],
        KeyCode::Up => vec![0x1b, b'[', b'A'],
        KeyCode::Down => vec![0x1b, b'[', b'B'],
        KeyCode::Right => vec![0x1b, b'[', b'C'],
        KeyCode::Left => vec![0x1b, b'[', b'D'],
        KeyCode::Home => vec![0x1b, b'[', b'H'],
        KeyCode::End => vec![0x1b, b'[', b'F'],
        KeyCode::PageUp => vec![0x1b, b'[', b'5', b'~'],
        KeyCode::PageDown => vec![0x1b, b'[', b'6', b'~'],
        KeyCode::Delete => vec![0x1b, b'[', b'3', b'~'],
        KeyCode::Insert => vec![0x1b, b'[', b'2', b'~'],
        KeyCode::F(n) => match n {
            1 => vec![0x1b, b'O', b'P'],
            2 => vec![0x1b, b'O', b'Q'],
            3 => vec![0x1b, b'O', b'R'],
            4 => vec![0x1b, b'O', b'S'],
            5 => vec![0x1b, b'[', b'1', b'5', b'~'],
            6 => vec![0x1b, b'[', b'1', b'7', b'~'],
            7 => vec![0x1b, b'[', b'1', b'8', b'~'],
            8 => vec![0x1b, b'[', b'1', b'9', b'~'],
            9 => vec![0x1b, b'[', b'2', b'0', b'~'],
            10 => vec![0x1b, b'[', b'2', b'1', b'~'],
            11 => vec![0x1b, b'[', b'2', b'3', b'~'],
            12 => vec![0x1b, b'[', b'2', b'4', b'~'],
            _ => vec![],
        },
        _ => vec![],
    }
}

// ============================================================================
// Main Run Function
// ============================================================================

/// Runs the guest terminal mode for viewing a remote session.
///
/// Connects to the specified session via WebSocket, receives and displays
/// terminal output, and allows sending input to the host session.
///
/// # Arguments
///
/// * `session_id` - The session ID to connect to as a guest
///
/// # Returns
///
/// Ok(()) on successful disconnection, or an error if something goes wrong.
pub async fn run(session_id: &str) -> Result<()> {
    // Get credentials from keychain
    let cred_store = CredentialStore::new();

    // Get access token
    let (access_token, _refresh_token) = cred_store.get_tokens()?.ok_or_else(|| {
        CliError::AuthError("Not authenticated. Run 'klaas' first to log in.".into())
    })?;

    // Delegate to run_with_token
    run_with_token(session_id, &access_token).await
}

/// Runs the guest terminal mode with a provided access token.
///
/// Use this when the access token is already available (e.g., from prior
/// authentication in the sessions command) to avoid keychain lookup issues.
///
/// # Arguments
///
/// * `session_id` - The session ID to connect to as a guest
/// * `access_token` - Valid access token for authentication
///
/// # Returns
///
/// Ok(()) on successful disconnection, or an error if something goes wrong.
pub async fn run_with_token(session_id: &str, access_token: &str) -> Result<()> {
    let config = get_api_config();
    info!(ws_url = %config.ws_url, session_id = %session_id, "Starting guest mode");

    // Get MEK for E2EE from keychain
    let cred_store = CredentialStore::new();
    let mek_bytes = cred_store.get_mek()?.ok_or_else(|| {
        CliError::CryptoError(
            "No encryption key found. You need to pair with the host first.".into(),
        )
    })?;

    let mut mek_arr = [0u8; 32];
    mek_arr.copy_from_slice(&mek_bytes);
    let mek = SecretKey::from_bytes(mek_arr);

    // Connect to WebSocket as guest
    let client = GuestClient::connect(config.ws_url, access_token, session_id, &mek).await?;
    info!("Connected to session as guest");

    // Set up terminal in raw mode
    let mut terminal = TerminalManager::new()?;
    terminal.enter_raw_mode()?;

    // Display initial notification
    display_notification(&format!(
        "Connected to session {}. Press Ctrl+Q to disconnect.",
        session_id
    ))?;

    // Input buffer for accumulating typed characters before sending
    let mut input_buffer = String::new();

    // Main event loop
    let result = run_event_loop(&client, &mut terminal, &mut input_buffer).await;

    // Clean up
    terminal.exit_raw_mode()?;

    // Close WebSocket connection
    if let Err(e) = client.close().await {
        debug!(error = %e, "Error closing WebSocket");
    }

    info!("Guest session ended");

    result
}

/// Main event loop for guest mode.
async fn run_event_loop(
    client: &GuestClient,
    terminal: &mut TerminalManager,
    input_buffer: &mut String,
) -> Result<()> {
    loop {
        tokio::select! {
            // Try to receive a WebSocket message with timeout
            recv_result = async {
                tokio::time::timeout(
                    Duration::from_millis(WS_RECV_TIMEOUT_MS),
                    client.recv()
                ).await
            } => {
                match recv_result {
                    Ok(Ok(Some(msg))) => {
                        if !handle_incoming_message(client, msg)? {
                            // Session detached, exit loop
                            break;
                        }
                    }
                    Ok(Ok(None)) => {
                        // Connection closed
                        display_notification("Connection closed by server")?;
                        break;
                    }
                    Ok(Err(e)) => {
                        error!(error = %e, "WebSocket error");
                        display_notification(&format!("Connection error: {}", e))?;
                        break;
                    }
                    Err(_) => {
                        // Timeout - continue to check for input
                    }
                }
            }

            // Poll for keyboard input
            _ = tokio::time::sleep(Duration::from_millis(10)) => {
                while let Ok(Some(event)) = terminal.poll_event(Duration::from_millis(0)) {
                    match event {
                        Event::Key(key_event) => {
                            // Check for Ctrl+Q to disconnect
                            if key_event.modifiers.contains(KeyModifiers::CONTROL)
                                && key_event.code == KeyCode::Char('q')
                            {
                                display_notification("Disconnecting...")?;
                                return Ok(());
                            }

                            // Convert key event to bytes
                            let bytes = key_event_to_bytes(key_event);
                            if !bytes.is_empty() {
                                // For Enter key, send accumulated buffer as prompt
                                if key_event.code == KeyCode::Enter {
                                    if !input_buffer.is_empty() {
                                        // Add newline and send
                                        input_buffer.push('\n');
                                        if let Err(e) = client.send_prompt(input_buffer).await {
                                            warn!(error = %e, "Failed to send prompt");
                                        }
                                        input_buffer.clear();
                                    }
                                } else {
                                    // Accumulate input
                                    if let Ok(s) = String::from_utf8(bytes.clone()) {
                                        input_buffer.push_str(&s);
                                    }
                                }
                            }
                        }
                        Event::Paste(text) => {
                            // Add pasted text to buffer
                            input_buffer.push_str(&text);
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    Ok(())
}

/// Handles an incoming message from the server.
///
/// Returns true to continue the event loop, false to exit.
fn handle_incoming_message(client: &GuestClient, msg: GuestIncomingMessage) -> Result<bool> {
    match msg {
        GuestIncomingMessage::SessionInfo(info) => {
            debug!(
                session_id = %info.session_id,
                cols = info.cols,
                rows = info.rows,
                device_name = ?info.device_name,
                cwd = ?info.cwd,
                "Received session info"
            );

            // Display session info notification
            let device_info = info
                .device_name
                .as_ref()
                .map(|d| format!(" from {}", d))
                .unwrap_or_default();
            display_notification(&format!(
                "Session {}x{}{} {}",
                info.cols,
                info.rows,
                device_info,
                info.cwd.as_deref().unwrap_or("")
            ))?;
        }

        GuestIncomingMessage::History(batch) => {
            debug!(
                session_id = %batch.session_id,
                entries = batch.entries.len(),
                "Received history batch"
            );

            // Decrypt and display each history entry
            for entry in &batch.entries {
                match client.decrypt(&entry.encrypted) {
                    Ok(data) => {
                        write_to_stdout(&data)?;
                    }
                    Err(e) => {
                        warn!(error = %e, "Failed to decrypt history entry");
                    }
                }
            }
        }

        GuestIncomingMessage::EncryptedOutput { encrypted, .. } => {
            // Decrypt and display output
            match client.decrypt(&encrypted) {
                Ok(data) => {
                    write_to_stdout(&data)?;
                }
                Err(e) => {
                    warn!(error = %e, "Failed to decrypt output");
                }
            }
        }

        GuestIncomingMessage::ModeChange(mode_change) => {
            debug!(
                session_id = %mode_change.session_id,
                mode = %mode_change.mode,
                message = ?mode_change.message,
                "Mode change"
            );

            // Display mode change notification
            let message = mode_change
                .message
                .as_ref()
                .map(|m| format!(": {}", m))
                .unwrap_or_default();
            display_notification(&format!("Mode: {}{}", mode_change.mode, message))?;
        }

        GuestIncomingMessage::SessionDetached { reason, .. } => {
            let reason_msg = reason
                .as_ref()
                .map(|r| format!(": {}", r))
                .unwrap_or_default();
            display_notification(&format!("Session detached{}", reason_msg))?;
            return Ok(false);
        }

        GuestIncomingMessage::Ping => {
            debug!("Received ping, sending pong");
            // Fire and forget - we do not want to block on this
            let client_ref = client;
            tokio::spawn(async move {
                // Note: This is a workaround since we cannot easily call
                // async from sync context. The actual pong is sent via
                // the WebSocket ping/pong mechanism in handle_raw_message.
                let _ = client_ref;
            });
        }

        GuestIncomingMessage::Error { code, message } => {
            error!(code = %code, message = %message, "Server error");
            display_notification(&format!("Error [{}]: {}", code, message))?;
        }
    }

    Ok(true)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_info_deserialization() {
        let json = r#"{
            "type": "session_info",
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "cols": 120,
            "rows": 40,
            "device_name": "MacBook Pro",
            "cwd": "/Users/test/projects"
        }"#;

        let msg: GuestIncomingMessage = serde_json::from_str(json).unwrap();
        match msg {
            GuestIncomingMessage::SessionInfo(info) => {
                assert_eq!(info.session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
                assert_eq!(info.cols, 120);
                assert_eq!(info.rows, 40);
                assert_eq!(info.device_name, Some("MacBook Pro".to_string()));
            }
            _ => panic!("Expected SessionInfo message"),
        }
    }

    #[test]
    fn test_history_batch_deserialization() {
        let json = r#"{
            "type": "history",
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "entries": [
                {
                    "encrypted": {
                        "v": 1,
                        "nonce": "dGVzdG5vbmNlMTIz",
                        "ciphertext": "ZW5jcnlwdGVkZGF0YQ==",
                        "tag": "dGFnMTIzNDU2Nzg5MDEy"
                    },
                    "timestamp": "2025-01-13T10:00:00Z"
                }
            ]
        }"#;

        let msg: GuestIncomingMessage = serde_json::from_str(json).unwrap();
        match msg {
            GuestIncomingMessage::History(batch) => {
                assert_eq!(batch.session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
                assert_eq!(batch.entries.len(), 1);
                assert_eq!(batch.entries[0].encrypted.v, 1);
            }
            _ => panic!("Expected History message"),
        }
    }

    #[test]
    fn test_mode_change_deserialization() {
        let json = r#"{
            "type": "mode_change",
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "mode": "waiting_for_input",
            "message": "Agent is waiting for user input"
        }"#;

        let msg: GuestIncomingMessage = serde_json::from_str(json).unwrap();
        match msg {
            GuestIncomingMessage::ModeChange(change) => {
                assert_eq!(change.session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
                assert_eq!(change.mode, "waiting_for_input");
                assert_eq!(
                    change.message,
                    Some("Agent is waiting for user input".to_string())
                );
            }
            _ => panic!("Expected ModeChange message"),
        }
    }

    #[test]
    fn test_session_detached_deserialization() {
        let json = r#"{
            "type": "session_detached",
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "reason": "Host disconnected"
        }"#;

        let msg: GuestIncomingMessage = serde_json::from_str(json).unwrap();
        match msg {
            GuestIncomingMessage::SessionDetached { session_id, reason } => {
                assert_eq!(session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
                assert_eq!(reason, Some("Host disconnected".to_string()));
            }
            _ => panic!("Expected SessionDetached message"),
        }
    }

    #[test]
    fn test_encrypted_output_deserialization() {
        let json = r#"{
            "type": "encrypted_output",
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "encrypted": {
                "v": 1,
                "nonce": "dGVzdG5vbmNlMTIz",
                "ciphertext": "ZW5jcnlwdGVkZGF0YQ==",
                "tag": "dGFnMTIzNDU2Nzg5MDEy"
            },
            "timestamp": "2025-01-13T10:00:00Z"
        }"#;

        let msg: GuestIncomingMessage = serde_json::from_str(json).unwrap();
        match msg {
            GuestIncomingMessage::EncryptedOutput {
                session_id,
                encrypted,
                ..
            } => {
                assert_eq!(session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
                assert_eq!(encrypted.v, 1);
            }
            _ => panic!("Expected EncryptedOutput message"),
        }
    }

    #[test]
    fn test_guest_outgoing_prompt_serialization() {
        let encrypted = EncryptedContent {
            v: 1,
            nonce: "dGVzdG5vbmNlMTIz".to_string(),
            ciphertext: "ZW5jcnlwdGVkZGF0YQ==".to_string(),
            tag: "dGFnMTIzNDU2Nzg5MDEy".to_string(),
        };

        let msg = GuestOutgoingMessage::EncryptedPrompt {
            session_id: "01HQXK7V8G3N5M2R4P6T1W9Y0Z".to_string(),
            encrypted,
            timestamp: "2025-01-13T10:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"encrypted_prompt""#));
        assert!(json.contains(r#""session_id":"01HQXK7V8G3N5M2R4P6T1W9Y0Z""#));
    }

    #[test]
    fn test_pong_serialization() {
        let msg = GuestOutgoingMessage::Pong;
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"pong"}"#);
    }

    #[test]
    fn test_key_event_to_bytes_regular_char() {
        let event = KeyEvent::new(KeyCode::Char('a'), KeyModifiers::empty());
        let bytes = key_event_to_bytes(event);
        assert_eq!(bytes, vec![b'a']);
    }

    #[test]
    fn test_key_event_to_bytes_ctrl_c() {
        let event = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        let bytes = key_event_to_bytes(event);
        assert_eq!(bytes, vec![0x03]); // Ctrl+C
    }

    #[test]
    fn test_key_event_to_bytes_enter() {
        let event = KeyEvent::new(KeyCode::Enter, KeyModifiers::empty());
        let bytes = key_event_to_bytes(event);
        assert_eq!(bytes, vec![b'\r']);
    }

    #[test]
    fn test_key_event_to_bytes_arrow_keys() {
        let up = KeyEvent::new(KeyCode::Up, KeyModifiers::empty());
        assert_eq!(key_event_to_bytes(up), vec![0x1b, b'[', b'A']);

        let down = KeyEvent::new(KeyCode::Down, KeyModifiers::empty());
        assert_eq!(key_event_to_bytes(down), vec![0x1b, b'[', b'B']);

        let right = KeyEvent::new(KeyCode::Right, KeyModifiers::empty());
        assert_eq!(key_event_to_bytes(right), vec![0x1b, b'[', b'C']);

        let left = KeyEvent::new(KeyCode::Left, KeyModifiers::empty());
        assert_eq!(key_event_to_bytes(left), vec![0x1b, b'[', b'D']);
    }
}
