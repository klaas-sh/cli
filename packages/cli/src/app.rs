//! Application orchestration and main I/O loop.
//!
//! Wraps Claude Code in a PTY and captures all I/O for remote streaming.
//! Handles authentication, WebSocket connection, and full-duplex I/O.

use std::sync::Arc;
use std::time::Duration;

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info, warn};

use crate::auth::{authenticate, refresh_token, AuthError};
use crate::config::{get_api_config, ApiConfig, CLAUDE_COMMAND};
use crate::credentials::CredentialStore;
use crate::error::{CliError, Result};
use crate::pty::PtyManager;
use crate::terminal::TerminalManager;
use crate::types::{ConnectionState, DeviceId, SessionId};
use crate::ui;
use crate::websocket::{IncomingMessage, WebSocketClient};

/// Interval for checking WebSocket reconnection (milliseconds).
const RECONNECT_CHECK_INTERVAL_MS: u64 = 100;

/// Timeout for WebSocket receive operations (milliseconds).
const WS_RECV_TIMEOUT_MS: u64 = 10;

/// Runs the CLI application.
///
/// Spawns Claude Code in a PTY, captures all I/O, and connects to the remote
/// session for streaming. Handles authentication, reconnection, and graceful
/// shutdown.
///
/// # Arguments
/// * `claude_args` - Arguments to pass through to Claude Code.
/// * `new_session` - If true, start a new session instead of resuming.
///
/// # Returns
/// Exit code from Claude Code.
pub async fn run(claude_args: Vec<String>, new_session: bool) -> Result<i32> {
    // Load configuration from environment
    let config = get_api_config();
    info!(api_url = %config.api_url, ws_url = %config.ws_url, "Loaded configuration");

    // Initialize credential store
    let cred_store = CredentialStore::new();

    // Get or generate device ID (persisted across sessions)
    let device_id = get_or_create_device_id(&cred_store)?;
    debug!(device_id = %device_id, "Using device ID");

    // Try to authenticate (handles cancellation gracefully)
    let access_token = match try_authenticate(&config, &cred_store).await {
        AuthAttemptResult::Success(token) => Some(token),
        AuthAttemptResult::Cancelled => {
            // User pressed CTRL+C - exit gracefully
            return Ok(0);
        }
        AuthAttemptResult::Offline => None,
    };

    // Get or create session ID (persisted for reconnection)
    let session_id = get_or_create_session_id(&cred_store, new_session)?;
    if new_session {
        info!(session_id = %session_id, "Starting new session");
    } else {
        info!(session_id = %session_id, "Resuming session");
    }

    // Get current working directory and device name
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    let device_name = hostname::get()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());

    debug!(
        device_name = %device_name,
        cwd = %cwd,
        "Session context"
    );

    // Set up terminal (raw mode)
    let mut terminal = TerminalManager::new()?;
    terminal.enter_raw_mode()?;

    // Spawn Claude Code in PTY
    let pty = match PtyManager::spawn(CLAUDE_COMMAND, &claude_args) {
        Ok(pty) => pty,
        Err(e) => {
            terminal.exit_raw_mode()?;
            return Err(CliError::SpawnError(format!(
                "Could not start Claude Code. Is it installed and in your PATH?\n\
                 Error: {}",
                e
            )));
        }
    };

    // Try to connect to WebSocket (non-blocking, continue if fails)
    // Skip if we don't have authentication
    let ws_client = match &access_token {
        Some(token) => {
            connect_websocket(
                &config,
                token,
                session_id.as_str(),
                device_id.as_str(),
                &device_name,
                &cwd,
            )
            .await
        }
        None => None,
    };

    // Track connection state
    let connection_state = Arc::new(Mutex::new(match &ws_client {
        Some(_) => ConnectionState::Attached,
        None => ConnectionState::Detached,
    }));

    // Wrap WebSocket client in Arc<Mutex> for sharing across tasks
    let ws_client = Arc::new(Mutex::new(ws_client));

    // Create channels for coordinating shutdown
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<i32>(1);

    // Channel for PTY output (displayed to terminal, streamed to WebSocket)
    let (pty_output_tx, mut pty_output_rx) = mpsc::channel::<Vec<u8>>(256);

    // Channel for PTY input (from keyboard and WebSocket prompts)
    let (pty_input_tx, mut pty_input_rx) = mpsc::channel::<Vec<u8>>(256);

    // Channel for WebSocket incoming messages
    let (ws_msg_tx, mut ws_msg_rx) = mpsc::channel::<IncomingMessage>(64);

    // Clone handles for reader task
    let pty_for_reader = pty.clone();
    let shutdown_tx_reader = shutdown_tx.clone();

    // Spawn PTY reader task (reads output from Claude Code)
    // Optional debug logging: set KLAAS_DEBUG_LOG=/path/to/file to capture output
    let debug_log_path = std::env::var("KLAAS_DEBUG_LOG").ok();
    let reader_handle = tokio::task::spawn_blocking(move || {
        use std::fs::OpenOptions;
        use std::io::Write as IoWrite;

        let mut debug_file = debug_log_path
            .as_ref()
            .and_then(|path| OpenOptions::new().create(true).append(true).open(path).ok());

        let mut buf = [0u8; 4096];
        loop {
            match pty_for_reader.read_blocking(&mut buf) {
                Ok(0) => {
                    // EOF - process exited
                    let _ = shutdown_tx_reader.blocking_send(0);
                    break;
                }
                Ok(n) => {
                    // Debug: log raw output to file
                    if let Some(ref mut file) = debug_file {
                        // Log each character individually
                        let text = String::from_utf8_lossy(&buf[..n]);
                        for ch in text.chars() {
                            if ch == '\x1b' {
                                let _ = writeln!(file, "print('ESC')");
                            } else if ch == '\n' {
                                let _ = writeln!(file, "print('\\n')");
                            } else if ch == '\r' {
                                let _ = writeln!(file, "print('\\r')");
                            } else if ch.is_control() {
                                let _ = writeln!(file, "print('0x{:02x}')", ch as u32);
                            } else {
                                let _ = writeln!(file, "print('{}')", ch);
                            }
                        }
                        let _ = file.flush();
                    }

                    if pty_output_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => {
                    let _ = shutdown_tx_reader.blocking_send(0);
                    break;
                }
            }
        }
    });

    // Clone handles for writer task
    let pty_for_writer = pty.clone();

    // Spawn PTY writer task (writes input to Claude Code)
    let writer_handle = tokio::task::spawn_blocking(move || {
        while let Some(data) = pty_input_rx.blocking_recv() {
            if pty_for_writer.write_blocking(&data).is_err() {
                break;
            }
        }
    });

    // Clone handles for WebSocket receiver task
    let ws_client_for_recv = Arc::clone(&ws_client);
    let connection_state_for_recv = Arc::clone(&connection_state);

    // Spawn WebSocket receiver task
    let ws_recv_handle = tokio::spawn(async move {
        loop {
            // Check if we have a connection
            let has_connection = {
                let client = ws_client_for_recv.lock().await;
                client.is_some()
            };

            if !has_connection {
                // Wait before checking again
                tokio::time::sleep(Duration::from_millis(RECONNECT_CHECK_INTERVAL_MS)).await;
                continue;
            }

            // Try to receive a message with timeout
            let recv_result = {
                let client_guard = ws_client_for_recv.lock().await;
                if let Some(ref client) = *client_guard {
                    // Use a timeout to avoid blocking indefinitely
                    tokio::time::timeout(Duration::from_millis(WS_RECV_TIMEOUT_MS), client.recv())
                        .await
                        .ok()
                } else {
                    None
                }
            };

            match recv_result {
                Some(Ok(Some(msg))) => {
                    // Forward message to main loop
                    if ws_msg_tx.send(msg).await.is_err() {
                        break; // Channel closed, exit
                    }
                }
                Some(Ok(None)) => {
                    // Connection closed gracefully
                    info!("WebSocket connection closed");
                    *connection_state_for_recv.lock().await = ConnectionState::Detached;
                }
                Some(Err(e)) => {
                    // Connection error - mark as disconnected
                    warn!(error = %e, "WebSocket receive error");
                    *connection_state_for_recv.lock().await = ConnectionState::Reconnecting;
                }
                None => {
                    // Timeout - continue polling
                }
            }
        }
    });

    // Clone handles for main loop
    let ws_client_for_loop = Arc::clone(&ws_client);
    let connection_state_for_loop = Arc::clone(&connection_state);
    // Note: pty_for_resize currently unused as web resize is disabled
    let _pty_for_resize = pty.clone();

    // Main event loop - full duplex I/O
    let exit_code = 'main: loop {
        tokio::select! {
            // Handle PTY output (display to terminal, stream to WebSocket)
            Some(output) = pty_output_rx.recv() => {
                // Write to local terminal
                terminal.write(&output)?;

                // Stream to WebSocket if connected
                let state = *connection_state_for_loop.lock().await;
                if state == ConnectionState::Attached {
                    let client_guard = ws_client_for_loop.lock().await;
                    if let Some(ref client) = *client_guard {
                        if let Err(e) = client.send_output(&output).await {
                            debug!(error = %e, "Failed to send output to WebSocket");
                            // Message is queued automatically by websocket module
                        }
                    }
                }
            }

            // Handle WebSocket incoming messages
            Some(msg) = ws_msg_rx.recv() => {
                match msg {
                    IncomingMessage::Prompt { text, .. } => {
                        // Inject prompt text into PTY
                        debug!(text = %text, "Received prompt from web client");
                        let _ = pty_input_tx.send(text.into_bytes()).await;
                    }
                    IncomingMessage::EncryptedPrompt { encrypted, .. } => {
                        // Decrypt and inject prompt text into PTY
                        let client_guard = ws_client_for_loop.lock().await;
                        if let Some(ref client) = *client_guard {
                            match client.decrypt_prompt(&encrypted).await {
                                Ok(text) => {
                                    debug!(
                                        text = %text,
                                        "Received encrypted prompt from web client"
                                    );
                                    drop(client_guard);
                                    let _ = pty_input_tx.send(text.into_bytes()).await;
                                }
                                Err(e) => {
                                    error!(
                                        error = %e,
                                        "Failed to decrypt prompt (E2EE may not be enabled)"
                                    );
                                }
                            }
                        } else {
                            warn!("Received encrypted prompt but WebSocket client not available");
                        }
                    }
                    IncomingMessage::Resize { cols, rows, .. } => {
                        // TODO: Resizing from web client breaks local terminal animations
                        // because it changes PTY size mid-session. Need a better approach
                        // where web client adapts to CLI size, not the other way around.
                        debug!(
                            cols, rows,
                            "Ignoring resize from web client (would break local terminal)"
                        );
                    }
                    IncomingMessage::Ping => {
                        // Respond with pong
                        debug!("Received ping, sending pong");
                        let client_guard = ws_client_for_loop.lock().await;
                        if let Some(ref client) = *client_guard {
                            let _ = client.send_pong().await;
                        }
                    }
                    IncomingMessage::Error { code, message } => {
                        // Log error from server
                        error!(code = %code, message = %message, "Server error");
                    }
                }
            }

            // Handle shutdown signal
            Some(code) = shutdown_rx.recv() => {
                break 'main code;
            }

            // Poll for keyboard input and handle reconnection
            _ = tokio::time::sleep(Duration::from_millis(10)) => {
                // Poll for terminal events (non-blocking)
                while let Ok(Some(event)) =
                    terminal.poll_event(Duration::from_millis(0))
                {
                    match event {
                        Event::Key(key_event) => {
                            let bytes = key_event_to_bytes(key_event);
                            if !bytes.is_empty() {
                                // Forward directly to PTY
                                let _ = pty_input_tx.send(bytes).await;
                            }
                        }
                        Event::Paste(text) => {
                            // Send bracketed paste sequence so Claude Code knows a paste
                            // happened. This is critical for image paste - Claude Code
                            // checks the system clipboard directly when it detects a paste
                            // event, even if the text content is empty.
                            let mut bytes = Vec::new();
                            bytes.extend_from_slice(b"\x1b[200~"); // Start bracketed paste
                            bytes.extend_from_slice(text.as_bytes());
                            bytes.extend_from_slice(b"\x1b[201~"); // End bracketed paste
                            let _ = pty_input_tx.send(bytes).await;
                        }
                        Event::Resize(cols, rows) => {
                            let _ = pty.resize(cols, rows).await;
                        }
                        _ => {}
                    }
                }

                // Handle reconnection if needed
                let state = *connection_state_for_loop.lock().await;
                if state == ConnectionState::Reconnecting {
                    handle_reconnection(
                        &ws_client_for_loop,
                        &connection_state_for_loop,
                        &config,
                        &cred_store,
                        session_id.as_str(),
                        device_id.as_str(),
                        &device_name,
                        &cwd,
                    )
                    .await;
                }
            }
        }
    };

    // Cleanup: send session_detach and close WebSocket
    info!(session_id = %session_id, "Session ended");

    {
        let client_guard = ws_client.lock().await;
        if let Some(ref client) = *client_guard {
            if let Err(e) = client.close().await {
                debug!(error = %e, "Error closing WebSocket");
            }
        }
    }

    *connection_state.lock().await = ConnectionState::Detached;

    // Abort WebSocket receiver task
    ws_recv_handle.abort();

    // Clean up PTY tasks
    drop(pty_input_tx);
    let _ = reader_handle.await;
    let _ = writer_handle.await;

    Ok(exit_code)
}

/// Gets or creates a device ID.
///
/// The device ID is persisted in the keychain/credential store and reused
/// across sessions. If no device ID exists, a new ULID is generated.
fn get_or_create_device_id(cred_store: &CredentialStore) -> Result<DeviceId> {
    match cred_store.get_device_id()? {
        Some(id) => {
            debug!("Retrieved existing device ID");
            Ok(DeviceId::from_string(id))
        }
        None => {
            let new_id = DeviceId::new();
            cred_store.store_device_id(new_id.as_str())?;
            info!(device_id = %new_id, "Generated new device ID");
            Ok(new_id)
        }
    }
}

/// Gets or creates a session ID.
///
/// If `new_session` is true, always creates a new session ID.
/// Otherwise, attempts to reuse the stored session ID for reconnection.
/// This allows the CLI to reconnect to the same session across restarts,
/// which means the web dashboard will show the same session.
fn get_or_create_session_id(cred_store: &CredentialStore, new_session: bool) -> Result<SessionId> {
    if new_session {
        // User explicitly requested a new session
        cred_store.clear_session_id()?;
    } else {
        // Try to reuse existing session ID
        if let Some(id) = cred_store.get_session_id()? {
            debug!("Retrieved existing session ID");
            return Ok(SessionId::from_string(id));
        }
    }

    // Create and store new session ID
    let new_id = SessionId::new();
    cred_store.store_session_id(new_id.as_str())?;
    debug!(session_id = %new_id, "Generated new session ID");
    Ok(new_id)
}

/// Ensures the user is authenticated.
///
/// Checks for stored credentials and refreshes if expired.
/// Runs OAuth Device Flow if no valid credentials exist.
///
/// # Returns
/// A valid access token.
async fn ensure_authenticated(config: &ApiConfig, cred_store: &CredentialStore) -> Result<String> {
    // Check for stored tokens
    if let Some((access_token, refresh_token_val)) = cred_store.get_tokens()? {
        debug!("Found stored tokens, attempting to use them");

        // Try to use the access token (API will reject if expired)
        // For now, we assume it is valid; real implementation would
        // verify the JWT expiry before use
        // TODO: Decode JWT and check expiry

        // Try refreshing to get a fresh token
        match refresh_token(&config.api_url, &refresh_token_val).await {
            Ok(tokens) => {
                debug!("Successfully refreshed tokens");
                cred_store.store_tokens(&tokens.access_token, &tokens.refresh_token)?;
                return Ok(tokens.access_token);
            }
            Err(AuthError::InvalidGrant) => {
                // Refresh token expired, need to re-authenticate
                info!("Refresh token expired, starting new authentication");
                cred_store.clear_tokens()?;
            }
            Err(e) => {
                // Network error or other issue - try using existing token
                warn!(error = %e, "Failed to refresh token, using existing");
                return Ok(access_token);
            }
        }
    }

    // No valid tokens, run OAuth Device Flow
    info!("No valid credentials, starting authentication");
    let tokens = authenticate(&config.api_url).await.map_err(|e| match e {
        AuthError::Cancelled | AuthError::Skipped => CliError::AuthError(e.to_string()),
        _ => CliError::AuthError(e.to_string()),
    })?;

    // Store the new tokens
    cred_store.store_tokens(&tokens.access_token, &tokens.refresh_token)?;
    info!("Authentication successful");

    Ok(tokens.access_token)
}

/// Result of authentication attempt.
pub enum AuthAttemptResult {
    /// Successfully authenticated with access token.
    Success(String),
    /// User cancelled (CTRL+C) - should exit.
    Cancelled,
    /// User skipped (ESC) or offline - continue without sync.
    Offline,
}

/// Tries to authenticate, handling cancellation and skip gracefully.
///
/// This is a non-blocking wrapper around `ensure_authenticated` that allows
/// the CLI to start in offline mode when the API server is unavailable.
/// The user can still use Claude Code normally, just without remote sync.
async fn try_authenticate(config: &ApiConfig, cred_store: &CredentialStore) -> AuthAttemptResult {
    match ensure_authenticated(config, cred_store).await {
        Ok(token) => AuthAttemptResult::Success(token),
        Err(e) => {
            let error_str = e.to_string();

            // Check if this was a user-initiated skip (ESC)
            if error_str.contains("skipped") {
                debug!("Auth skipped by user, continuing without sync");
                return AuthAttemptResult::Offline;
            }

            // Check if this was a user cancellation (CTRL+C)
            if error_str.contains("cancelled") {
                return AuthAttemptResult::Cancelled;
            }

            // Other errors - show offline warning
            ui::display_offline_warning(&error_str);
            warn!(error = %e, "Starting in offline mode");
            AuthAttemptResult::Offline
        }
    }
}

/// Connects to the WebSocket server.
///
/// Returns None if connection fails (CLI continues to work locally).
async fn connect_websocket(
    config: &ApiConfig,
    access_token: &str,
    session_id: &str,
    device_id: &str,
    device_name: &str,
    cwd: &str,
) -> Option<WebSocketClient> {
    debug!(ws_url = %config.ws_url, "Connecting to WebSocket");

    match WebSocketClient::connect(
        &config.ws_url,
        access_token,
        session_id,
        device_id,
        device_name,
        cwd,
    )
    .await
    {
        Ok(client) => {
            info!("Connected to remote session");
            Some(client)
        }
        Err(e) => {
            warn!(
                error = %e,
                "Failed to connect to remote session, continuing locally"
            );
            None
        }
    }
}

/// Handles WebSocket reconnection with backoff.
#[allow(clippy::too_many_arguments)]
async fn handle_reconnection(
    ws_client: &Arc<Mutex<Option<WebSocketClient>>>,
    connection_state: &Arc<Mutex<ConnectionState>>,
    config: &ApiConfig,
    cred_store: &CredentialStore,
    session_id: &str,
    device_id: &str,
    device_name: &str,
    cwd: &str,
) {
    debug!("Attempting WebSocket reconnection");

    // First, try to reconnect with the existing client
    {
        let client_guard = ws_client.lock().await;
        if let Some(ref client) = *client_guard {
            match client.reconnect().await {
                Ok(true) => {
                    info!("Reconnected to remote session");
                    *connection_state.lock().await = ConnectionState::Attached;
                    return;
                }
                Ok(false) => {
                    // Max attempts reached, give up
                    warn!("Max reconnection attempts reached");
                }
                Err(e) => {
                    debug!(error = %e, "Reconnection attempt failed");
                    // Continue to try fresh connection
                }
            }
        }
    }

    // Try a fresh connection with potentially refreshed token
    let access_token = match ensure_authenticated(config, cred_store).await {
        Ok(token) => token,
        Err(e) => {
            warn!(error = %e, "Failed to get access token for reconnection");
            *connection_state.lock().await = ConnectionState::Detached;
            return;
        }
    };

    match connect_websocket(
        config,
        &access_token,
        session_id,
        device_id,
        device_name,
        cwd,
    )
    .await
    {
        Some(new_client) => {
            *ws_client.lock().await = Some(new_client);
            *connection_state.lock().await = ConnectionState::Attached;
            info!("Established new connection to remote session");
        }
        None => {
            *connection_state.lock().await = ConnectionState::Detached;
            warn!("Failed to establish new connection, continuing locally");
        }
    }
}

/// Converts a key event to raw bytes.
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
        KeyCode::F(n) => {
            // F1-F12 escape sequences
            match n {
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
            }
        }
        _ => vec![],
    }
}
