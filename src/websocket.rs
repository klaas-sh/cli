//! WebSocket client for connecting to the SessionHub Durable Object.
//!
//! This module handles:
//! - Connecting to the server via WebSocket with JWT authentication
//! - Sending session attach/detach messages
//! - Forwarding PTY output as encrypted E2EE messages
//! - Receiving prompts, resize commands, and pings from the server
//! - Automatic reconnection with exponential backoff
//! - Transparent end-to-end encryption (always enabled, no user interaction)

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{HeaderValue, AUTHORIZATION};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{debug, error, info, warn};
use url::Url;

use crate::crypto::{
    decrypt_content, derive_session_key, encrypt_content, EncryptedContent, SecretKey,
};
use crate::error::{CliError, Result};

/// Maximum number of reconnection attempts before giving up.
const MAX_RECONNECT_ATTEMPTS: u32 = 10;

/// Base delay for exponential backoff (milliseconds).
const BASE_BACKOFF_MS: u64 = 500;

/// Maximum backoff delay (milliseconds).
const MAX_BACKOFF_MS: u64 = 30_000;

/// Maximum messages to queue during reconnection.
const MAX_QUEUE_SIZE: usize = 100;

/// Maximum age of queued messages (5 minutes).
const MAX_QUEUE_AGE: Duration = Duration::from_secs(5 * 60);

// ============================================================================
// Message Types
// ============================================================================

/// Messages sent from CLI to server.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    /// Attach a session to the server.
    SessionAttach {
        session_id: String,
        device_id: String,
        device_name: String,
        cwd: String,
        /// Optional human-readable session name (max 20 chars).
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    /// Terminal output data (base64 encoded plaintext).
    /// Kept for backward compatibility but no longer used - all output is now
    /// encrypted using EncryptedOutput.
    #[allow(dead_code)]
    Output {
        session_id: String,
        data: String,
        timestamp: String,
    },
    /// Terminal output data (E2EE encrypted).
    /// This is the only output format used - E2EE is always enabled.
    /// Serializes as "output" to match server expectations.
    #[serde(rename = "output")]
    EncryptedOutput {
        session_id: String,
        encrypted: EncryptedContent,
        timestamp: String,
    },
    /// Detach the session from the server.
    SessionDetach { session_id: String },
    /// Heartbeat response.
    Pong,
}

/// Messages received from server to CLI.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    /// Prompt from a web client (E2EE encrypted).
    /// All prompts are encrypted - E2EE is always enabled.
    Prompt {
        session_id: String,
        encrypted: EncryptedContent,
        source: String,
        timestamp: String,
    },
    /// Terminal resize request from web client.
    Resize {
        session_id: String,
        cols: u16,
        rows: u16,
    },
    /// Heartbeat request from server.
    Ping,
    /// Error message from server.
    Error { code: String, message: String },
}

/// Queued message with timestamp for expiration.
#[derive(Debug)]
struct QueuedMessage {
    message: OutgoingMessage,
    timestamp: Instant,
}

// ============================================================================
// WebSocket Client
// ============================================================================

/// Split WebSocket write half wrapped for async access.
type WsSender = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

/// Split WebSocket read half.
type WsReceiver = SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;

/// WebSocket client for communicating with the SessionHub.
///
/// Provides methods for:
/// - Connecting with JWT authentication
/// - Sending terminal output (always E2EE encrypted)
/// - Receiving commands from web clients
/// - Automatic reconnection with exponential backoff
/// - Transparent end-to-end encryption (always enabled)
pub struct WebSocketClient {
    /// WebSocket sender (write half).
    sender: Arc<Mutex<Option<WsSender>>>,
    /// WebSocket receiver (read half).
    receiver: Arc<Mutex<Option<WsReceiver>>>,
    /// Connection URL.
    url: Url,
    /// JWT token for authentication.
    token: String,
    /// Session ID for this connection.
    session_id: String,
    /// Device ID for this device.
    device_id: String,
    /// Device name (hostname).
    device_name: String,
    /// Current working directory.
    cwd: String,
    /// Optional session name (human-readable).
    session_name: Option<String>,
    /// Message queue for reconnection.
    message_queue: Arc<Mutex<VecDeque<QueuedMessage>>>,
    /// Whether currently connected.
    is_connected: Arc<Mutex<bool>>,
    /// Current reconnection attempt.
    reconnect_attempt: Arc<Mutex<u32>>,
    /// Master Encryption Key for E2EE (optional).
    mek: Arc<Mutex<Option<SecretKey>>>,
    /// Cached session key derived from MEK (derived lazily).
    session_key: Arc<Mutex<Option<SecretKey>>>,
}

impl WebSocketClient {
    /// Creates a new WebSocket client and connects to the server.
    ///
    /// # Arguments
    ///
    /// * `url` - WebSocket URL (wss://api.klaas.sh/ws)
    /// * `token` - JWT access token for authentication
    /// * `session_id` - ULID session identifier
    /// * `device_id` - ULID device identifier
    /// * `device_name` - Human-readable device name (hostname)
    /// * `cwd` - Current working directory
    /// * `session_name` - Optional human-readable session name
    ///
    /// # Returns
    ///
    /// A connected WebSocketClient or an error if connection fails.
    pub async fn connect(
        url: &str,
        token: &str,
        session_id: &str,
        device_id: &str,
        device_name: &str,
        cwd: &str,
        session_name: Option<&str>,
    ) -> Result<Self> {
        // Parse and validate URL
        let mut parsed_url = Url::parse(url)
            .map_err(|e| CliError::WebSocketError(format!("Invalid WebSocket URL: {}", e)))?;

        // Add session_id, device_id, device_name, cwd and client=host query parameters
        // These are used by the API to create session/device records in D1
        // client=host indicates this CLI owns the PTY (vs guest which is a viewer)
        parsed_url
            .query_pairs_mut()
            .append_pair("session_id", session_id)
            .append_pair("device_id", device_id)
            .append_pair("device_name", device_name)
            .append_pair("cwd", cwd)
            .append_pair("client", "host");

        let client = Self {
            sender: Arc::new(Mutex::new(None)),
            receiver: Arc::new(Mutex::new(None)),
            url: parsed_url,
            token: token.to_string(),
            session_id: session_id.to_string(),
            device_id: device_id.to_string(),
            device_name: device_name.to_string(),
            cwd: cwd.to_string(),
            session_name: session_name.map(|s| s.to_string()),
            message_queue: Arc::new(Mutex::new(VecDeque::new())),
            is_connected: Arc::new(Mutex::new(false)),
            reconnect_attempt: Arc::new(Mutex::new(0)),
            mek: Arc::new(Mutex::new(None)),
            session_key: Arc::new(Mutex::new(None)),
        };

        // Perform initial connection
        client.do_connect().await?;

        // Send session_attach message
        client.send_session_attach().await?;

        Ok(client)
    }

    /// Performs the actual WebSocket connection.
    async fn do_connect(&self) -> Result<()> {
        debug!(url = %self.url, "Connecting to WebSocket server");

        // Build request with Authorization header
        let mut request = self
            .url
            .as_str()
            .into_client_request()
            .map_err(|e| CliError::WebSocketError(format!("Failed to build request: {}", e)))?;

        // Add authorization header
        let auth_value = HeaderValue::from_str(&format!("Bearer {}", self.token))
            .map_err(|e| CliError::WebSocketError(format!("Invalid auth header: {}", e)))?;
        request.headers_mut().insert(AUTHORIZATION, auth_value);

        // Connect to server
        let (ws_stream, response) = connect_async(request)
            .await
            .map_err(|e| CliError::WebSocketError(format!("Failed to connect: {}", e)))?;

        debug!(
            status = %response.status(),
            "WebSocket connection established"
        );

        // Split into sender and receiver
        let (sender, receiver) = ws_stream.split();

        // Store the split streams
        *self.sender.lock().await = Some(sender);
        *self.receiver.lock().await = Some(receiver);
        *self.is_connected.lock().await = true;
        *self.reconnect_attempt.lock().await = 0;

        info!("Connected to WebSocket server");

        // Drain any queued messages
        self.drain_message_queue().await?;

        Ok(())
    }

    /// Sends the session_attach message to the server.
    async fn send_session_attach(&self) -> Result<()> {
        let msg = OutgoingMessage::SessionAttach {
            session_id: self.session_id.clone(),
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            cwd: self.cwd.clone(),
            name: self.session_name.clone(),
        };

        self.send_message(&msg).await
    }

    /// Sends terminal output to the server.
    ///
    /// All output is encrypted using E2EE. The MEK is always available
    /// since it is auto-generated on first use and stored in the keychain.
    ///
    /// # Arguments
    ///
    /// * `data` - Raw terminal output bytes
    pub async fn send_output(&self, data: &[u8]) -> Result<()> {
        let timestamp = Utc::now().to_rfc3339();

        // Get session key (always available since MEK is auto-generated)
        let session_key = self
            .get_or_derive_session_key()
            .await
            .expect("MEK should always be available for E2EE");

        // Always encrypt - MEK is always available
        let encrypted = encrypt_content(&session_key, data);
        let msg = OutgoingMessage::EncryptedOutput {
            session_id: self.session_id.clone(),
            encrypted,
            timestamp,
        };

        self.send_message(&msg).await
    }

    /// Gets the cached session key or derives it from MEK if available.
    async fn get_or_derive_session_key(&self) -> Option<SecretKey> {
        // First check if we have a cached session key
        let session_key_guard = self.session_key.lock().await;
        if session_key_guard.is_some() {
            return session_key_guard.clone();
        }
        drop(session_key_guard);

        // Check if MEK is available
        let mek_guard = self.mek.lock().await;
        if let Some(ref mek) = *mek_guard {
            // Derive session key from MEK
            let derived_key = derive_session_key(mek, &self.session_id);
            drop(mek_guard);

            // Cache the derived key
            let mut session_key_guard = self.session_key.lock().await;
            *session_key_guard = Some(derived_key.clone());
            Some(derived_key)
        } else {
            None
        }
    }

    /// Sends a pong response to the server (heartbeat response).
    pub async fn send_pong(&self) -> Result<()> {
        self.send_message(&OutgoingMessage::Pong).await
    }

    /// Sends a session_detach message to the server.
    pub async fn send_session_detach(&self) -> Result<()> {
        let msg = OutgoingMessage::SessionDetach {
            session_id: self.session_id.clone(),
        };

        self.send_message(&msg).await
    }

    /// Receives the next message from the server.
    ///
    /// Returns None if the connection is closed gracefully.
    /// Returns an error if the connection is lost unexpectedly.
    pub async fn recv(&self) -> Result<Option<IncomingMessage>> {
        let mut receiver_guard = self.receiver.lock().await;

        let receiver = receiver_guard
            .as_mut()
            .ok_or_else(|| CliError::WebSocketError("Not connected".to_string()))?;

        match receiver.next().await {
            Some(Ok(msg)) => self.handle_raw_message(msg).await,
            Some(Err(e)) => {
                debug!(error = %e, "WebSocket receive error");
                *self.is_connected.lock().await = false;
                drop(receiver_guard);
                Err(CliError::WebSocketError(format!("Receive error: {}", e)))
            }
            None => {
                info!("WebSocket connection closed by server");
                *self.is_connected.lock().await = false;
                Ok(None)
            }
        }
    }

    /// Handles a raw WebSocket message.
    async fn handle_raw_message(&self, msg: Message) -> Result<Option<IncomingMessage>> {
        match msg {
            Message::Text(text) => {
                debug!(message = %text, "Received text message");

                let parsed: IncomingMessage = serde_json::from_str(&text).map_err(|e| {
                    CliError::WebSocketError(format!("Failed to parse message: {}", e))
                })?;

                Ok(Some(parsed))
            }
            Message::Binary(data) => {
                // Try to parse as JSON text
                let text = String::from_utf8(data).map_err(|e| {
                    CliError::WebSocketError(format!("Invalid UTF-8 in binary message: {}", e))
                })?;

                let parsed: IncomingMessage = serde_json::from_str(&text).map_err(|e| {
                    CliError::WebSocketError(format!("Failed to parse binary message: {}", e))
                })?;

                Ok(Some(parsed))
            }
            Message::Ping(data) => {
                debug!("Received WebSocket ping");
                // Send pong with same data
                if let Some(sender) = self.sender.lock().await.as_mut() {
                    let _ = sender.send(Message::Pong(data)).await;
                }
                // Continue waiting for next message (don't return ping)
                Ok(None)
            }
            Message::Pong(_) => {
                debug!("Received WebSocket pong");
                Ok(None)
            }
            Message::Close(frame) => {
                info!(frame = ?frame, "Received close frame");
                *self.is_connected.lock().await = false;
                Ok(None)
            }
            Message::Frame(_) => {
                // Raw frame, not expected in normal operation
                Ok(None)
            }
        }
    }

    /// Sends a message to the server.
    ///
    /// If not connected, queues the message for later delivery.
    async fn send_message(&self, msg: &OutgoingMessage) -> Result<()> {
        let is_connected = *self.is_connected.lock().await;

        if !is_connected {
            // Queue message for later
            self.queue_message(msg.clone()).await;
            return Ok(());
        }

        let json = serde_json::to_string(msg)
            .map_err(|e| CliError::WebSocketError(format!("Failed to serialize message: {}", e)))?;

        debug!(message = %json, "Sending message");

        let mut sender_guard = self.sender.lock().await;
        if let Some(sender) = sender_guard.as_mut() {
            sender
                .send(Message::Text(json))
                .await
                .map_err(|e| CliError::WebSocketError(format!("Failed to send: {}", e)))?;
        } else {
            // Not connected, queue the message
            drop(sender_guard);
            self.queue_message(msg.clone()).await;
        }

        Ok(())
    }

    /// Queues a message for later delivery during reconnection.
    async fn queue_message(&self, msg: OutgoingMessage) {
        let mut queue = self.message_queue.lock().await;

        // Prune expired messages
        let now = Instant::now();
        queue.retain(|m| now.duration_since(m.timestamp) < MAX_QUEUE_AGE);

        // Add new message
        queue.push_back(QueuedMessage {
            message: msg,
            timestamp: now,
        });

        // Trim queue if too large
        while queue.len() > MAX_QUEUE_SIZE {
            queue.pop_front();
        }

        debug!(queue_size = queue.len(), "Message queued");
    }

    /// Drains the message queue after reconnection.
    async fn drain_message_queue(&self) -> Result<()> {
        let mut queue = self.message_queue.lock().await;
        let now = Instant::now();

        debug!(queue_size = queue.len(), "Draining message queue");

        while let Some(queued) = queue.pop_front() {
            // Skip expired messages
            if now.duration_since(queued.timestamp) >= MAX_QUEUE_AGE {
                debug!("Dropping expired queued message");
                continue;
            }

            let json = serde_json::to_string(&queued.message).map_err(|e| {
                CliError::WebSocketError(format!("Failed to serialize queued message: {}", e))
            })?;

            let mut sender_guard = self.sender.lock().await;
            if let Some(sender) = sender_guard.as_mut() {
                if let Err(e) = sender.send(Message::Text(json)).await {
                    debug!(error = %e, "Failed to send queued message");
                    // Re-queue and abort drain
                    drop(sender_guard);
                    queue.push_front(queued);
                    return Err(CliError::WebSocketError(format!(
                        "Failed to drain queue: {}",
                        e
                    )));
                }
            }
        }

        Ok(())
    }

    /// Attempts to reconnect with exponential backoff.
    ///
    /// # Returns
    ///
    /// Ok(true) if reconnected successfully.
    /// Ok(false) if max attempts reached.
    /// Err if a fatal error occurred.
    pub async fn reconnect(&self) -> Result<bool> {
        let mut attempt = self.reconnect_attempt.lock().await;

        if *attempt >= MAX_RECONNECT_ATTEMPTS {
            debug!(
                attempts = MAX_RECONNECT_ATTEMPTS,
                "Max reconnection attempts reached"
            );
            return Ok(false);
        }

        *attempt += 1;
        let current_attempt = *attempt;
        drop(attempt);

        // Calculate backoff with jitter
        let base_delay = BASE_BACKOFF_MS * 2u64.pow(current_attempt - 1);
        let jitter = rand::thread_rng().gen_range(0..1000);
        let delay = std::cmp::min(base_delay + jitter, MAX_BACKOFF_MS);

        info!(
            attempt = current_attempt,
            max_attempts = MAX_RECONNECT_ATTEMPTS,
            delay_ms = delay,
            "Attempting reconnection"
        );

        tokio::time::sleep(Duration::from_millis(delay)).await;

        match self.do_connect().await {
            Ok(()) => {
                // Re-send session attach
                if let Err(e) = self.send_session_attach().await {
                    error!(error = %e, "Failed to send session_attach");
                    return Err(e);
                }
                info!("Reconnected successfully");
                Ok(true)
            }
            Err(e) => {
                debug!(error = %e, "Reconnection attempt failed");
                // Try again (will be called in a loop by the caller)
                Err(e)
            }
        }
    }

    /// Gracefully closes the WebSocket connection.
    pub async fn close(&self) -> Result<()> {
        info!("Closing WebSocket connection");

        // Send session_detach first
        if *self.is_connected.lock().await {
            let _ = self.send_session_detach().await;
        }

        // Send close frame
        let mut sender_guard = self.sender.lock().await;
        if let Some(sender) = sender_guard.as_mut() {
            let _ = sender.send(Message::Close(None)).await;
        }

        *self.is_connected.lock().await = false;

        Ok(())
    }

    /// Returns whether the client is currently connected.
    pub async fn is_connected(&self) -> bool {
        *self.is_connected.lock().await
    }

    /// Returns the session ID for this connection.
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Returns the device ID for this connection.
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// Sets the Master Encryption Key to enable E2EE.
    ///
    /// When set, all outgoing messages will be encrypted and incoming
    /// encrypted messages will be decrypted using session keys derived
    /// from this MEK.
    ///
    /// # Arguments
    ///
    /// * `mek` - The Master Encryption Key
    pub async fn set_mek(&self, mek: SecretKey) {
        info!("E2EE enabled: MEK set");

        // Clear any cached session key (will be re-derived on next use)
        *self.session_key.lock().await = None;

        // Set the new MEK
        *self.mek.lock().await = Some(mek);
    }

    /// Clears the MEK. This is only for testing or special cases.
    ///
    /// In normal operation, MEK is always set since it's auto-generated.
    /// Clearing the MEK will cause `send_output` to panic.
    #[allow(dead_code)]
    pub async fn clear_mek(&self) {
        warn!("E2EE disabled: MEK cleared (this should only happen in tests)");

        *self.session_key.lock().await = None;
        *self.mek.lock().await = None;
    }

    /// Returns whether E2EE is currently enabled (MEK is set).
    pub async fn is_e2ee_enabled(&self) -> bool {
        self.mek.lock().await.is_some()
    }

    /// Decrypts an incoming encrypted prompt message.
    ///
    /// Returns the decrypted text or an error if decryption fails
    /// (e.g., wrong key or corrupted data).
    pub async fn decrypt_prompt(&self, encrypted: &EncryptedContent) -> Result<String> {
        let session_key = self.get_or_derive_session_key().await.ok_or_else(|| {
            CliError::CryptoError("Cannot decrypt: E2EE not enabled (no MEK set)".into())
        })?;

        let plaintext = decrypt_content(&session_key, encrypted)?;

        String::from_utf8(plaintext).map_err(|e| {
            CliError::CryptoError(format!("Decrypted content is not valid UTF-8: {}", e))
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    #[test]
    fn test_outgoing_message_serialization() {
        let msg = OutgoingMessage::SessionAttach {
            session_id: "01HQXK7V8G3N5M2R4P6T1W9Y0Z".to_string(),
            device_id: "01HQXK7V8G3N5M2R4P6T1W9Y0A".to_string(),
            device_name: "MacBook Pro".to_string(),
            cwd: "/Users/test/projects".to_string(),
            name: None,
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"session_attach""#));
        assert!(json.contains(r#""session_id":"01HQXK7V8G3N5M2R4P6T1W9Y0Z""#));
        // name should be omitted when None
        assert!(!json.contains(r#""name""#));
    }

    #[test]
    fn test_outgoing_session_attach_with_name() {
        let msg = OutgoingMessage::SessionAttach {
            session_id: "01HQXK7V8G3N5M2R4P6T1W9Y0Z".to_string(),
            device_id: "01HQXK7V8G3N5M2R4P6T1W9Y0A".to_string(),
            device_name: "MacBook Pro".to_string(),
            cwd: "/Users/test/projects".to_string(),
            name: Some("my-session".to_string()),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"session_attach""#));
        assert!(json.contains(r#""name":"my-session""#));
    }

    #[test]
    fn test_outgoing_output_serialization() {
        let msg = OutgoingMessage::Output {
            session_id: "01HQXK7V8G3N5M2R4P6T1W9Y0Z".to_string(),
            data: BASE64.encode(b"Hello, World!"),
            timestamp: "2025-01-13T10:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"output""#));
        assert!(json.contains(r#""data":"SGVsbG8sIFdvcmxkIQ==""#));
    }

    #[test]
    fn test_outgoing_pong_serialization() {
        let msg = OutgoingMessage::Pong;
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"pong"}"#);
    }

    #[test]
    fn test_outgoing_detach_serialization() {
        let msg = OutgoingMessage::SessionDetach {
            session_id: "01HQXK7V8G3N5M2R4P6T1W9Y0Z".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"session_detach""#));
    }

    #[test]
    fn test_incoming_prompt_deserialization() {
        // All prompts are encrypted - server sends type "prompt" with encrypted field
        let json = r#"{
            "type": "prompt",
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "encrypted": {
                "v": 1,
                "nonce": "dGVzdG5vbmNlMTIz",
                "ciphertext": "ZW5jcnlwdGVkZGF0YQ==",
                "tag": "dGFnMTIzNDU2Nzg5MDEy"
            },
            "source": "web",
            "timestamp": "2025-01-13T10:00:00Z"
        }"#;

        let msg: IncomingMessage = serde_json::from_str(json).unwrap();
        match msg {
            IncomingMessage::Prompt {
                session_id,
                encrypted,
                source,
                ..
            } => {
                assert_eq!(session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
                assert_eq!(encrypted.v, 1);
                assert_eq!(encrypted.nonce, "dGVzdG5vbmNlMTIz");
                assert_eq!(source, "web");
            }
            _ => panic!("Expected Prompt message"),
        }
    }

    #[test]
    fn test_incoming_resize_deserialization() {
        let json = r#"{
            "type": "resize",
            "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
            "cols": 120,
            "rows": 40
        }"#;

        let msg: IncomingMessage = serde_json::from_str(json).unwrap();
        match msg {
            IncomingMessage::Resize {
                session_id,
                cols,
                rows,
            } => {
                assert_eq!(session_id, "01HQXK7V8G3N5M2R4P6T1W9Y0Z");
                assert_eq!(cols, 120);
                assert_eq!(rows, 40);
            }
            _ => panic!("Expected Resize message"),
        }
    }

    #[test]
    fn test_incoming_ping_deserialization() {
        let json = r#"{"type": "ping"}"#;
        let msg: IncomingMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, IncomingMessage::Ping));
    }

    #[test]
    fn test_incoming_error_deserialization() {
        let json = r#"{
            "type": "error",
            "code": "UNAUTHORIZED",
            "message": "Invalid token"
        }"#;

        let msg: IncomingMessage = serde_json::from_str(json).unwrap();
        match msg {
            IncomingMessage::Error { code, message } => {
                assert_eq!(code, "UNAUTHORIZED");
                assert_eq!(message, "Invalid token");
            }
            _ => panic!("Expected Error message"),
        }
    }

    #[test]
    fn test_base64_encoding() {
        let data = b"Hello, World!";
        let encoded = BASE64.encode(data);
        assert_eq!(encoded, "SGVsbG8sIFdvcmxkIQ==");
    }

    #[test]
    fn test_encrypted_output_serialization() {
        let msg = OutgoingMessage::EncryptedOutput {
            session_id: "01HQXK7V8G3N5M2R4P6T1W9Y0Z".to_string(),
            encrypted: EncryptedContent {
                v: 1,
                nonce: "dGVzdG5vbmNlMTIz".to_string(),
                ciphertext: "ZW5jcnlwdGVkZGF0YQ==".to_string(),
                tag: "dGFnMTIzNDU2Nzg5MDEy".to_string(),
            },
            timestamp: "2025-01-13T10:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        // EncryptedOutput serializes as "output" to match server expectations
        assert!(json.contains(r#""type":"output""#));
        assert!(json.contains(r#""encrypted""#));
        assert!(json.contains(r#""v":1"#));
        assert!(json.contains(r#""nonce""#));
        assert!(json.contains(r#""ciphertext""#));
        assert!(json.contains(r#""tag""#));
    }

    #[test]
    fn test_encrypted_content_roundtrip() {
        use crate::crypto::{derive_session_key, encrypt_content, SecretKey};

        // Create a test MEK and session key
        let mek = SecretKey::random();
        let session_id = "01HQXK7V8G3N5M2R4P6T1W9Y0Z";
        let session_key = derive_session_key(&mek, session_id);

        // Encrypt test data
        let plaintext = b"Hello, World!";
        let encrypted = encrypt_content(&session_key, plaintext);

        // Verify the encrypted content structure
        assert_eq!(encrypted.v, 1);
        assert!(!encrypted.nonce.is_empty());
        assert!(!encrypted.ciphertext.is_empty());
        assert!(!encrypted.tag.is_empty());

        // Serialize and deserialize
        let msg = OutgoingMessage::EncryptedOutput {
            session_id: session_id.to_string(),
            encrypted,
            timestamp: "2025-01-13T10:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"output""#));
    }
}
