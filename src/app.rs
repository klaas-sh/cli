//! Application orchestration and main I/O loop.
//!
//! Wraps AI coding agents in a PTY and captures all I/O for remote streaming.
//! Handles authentication, WebSocket connection, and full-duplex I/O.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info, warn};

use crate::agents::Agent;
use crate::auth::{authenticate_with_mek, refresh_token, AuthError};
use crate::config::{get_api_config, ApiConfig};
use crate::credentials::CredentialStore;
use crate::crypto::SecretKey;
use crate::error::{CliError, Result};
use crate::hook::{ENV_API_URL, ENV_HOOK_TOKEN, ENV_SESSION_ID};
use crate::pty::PtyManager;
use crate::terminal::TerminalManager;
use crate::types::{ConnectionState, DeviceId, SessionId};
use crate::ui;
use crate::websocket::{IncomingMessage, WebSocketClient};

/// Buffer time (seconds) before token expiry to trigger refresh.
/// We refresh 60 seconds before expiry to avoid race conditions.
const TOKEN_REFRESH_BUFFER_SECS: i64 = 60;

/// Interval for checking WebSocket reconnection (milliseconds).
const RECONNECT_CHECK_INTERVAL_MS: u64 = 100;

/// Timeout for WebSocket receive operations (milliseconds).
const WS_RECV_TIMEOUT_MS: u64 = 10;

/// Runs the CLI application.
///
/// Spawns the selected agent in a PTY, captures all I/O, and connects to the
/// remote session for streaming. Handles authentication, reconnection, and
/// graceful shutdown.
///
/// # Arguments
/// * `agent` - The selected agent to run.
/// * `agent_args` - Arguments to pass through to the agent.
/// * `resume` - If true, resume the previous session instead of starting new.
/// * `session_name` - Optional human-readable name for the session.
///
/// # Returns
/// Exit code from the agent.
pub async fn run(
    agent: Agent,
    agent_args: Vec<String>,
    resume: bool,
    session_name: Option<String>,
) -> Result<i32> {
    // Load configuration from environment
    let config = get_api_config();
    info!(api_url = %config.api_url, ws_url = %config.ws_url, "Loaded configuration");

    // Initialize credential store
    let cred_store = CredentialStore::new();

    // Get or generate device ID (persisted across sessions)
    let device_id = get_or_create_device_id(&cred_store)?;
    debug!(device_id = %device_id, "Using device ID");

    // Get device name (needed for authentication and session context)
    let device_name = hostname::get()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());

    // Try to authenticate with unified device flow (handles E2EE key exchange)
    let (access_token, mek) =
        match try_authenticate_with_mek(&config, &cred_store, &device_name).await {
        AuthAttemptResultWithMek::Success(token, mek) => {
            debug!("E2EE enabled with MEK from unified device flow");
            (Some(token), mek)
        }
        AuthAttemptResultWithMek::Cancelled => {
            // User pressed CTRL+C - exit gracefully
            return Ok(0);
        }
        AuthAttemptResultWithMek::Offline(mek_opt) => {
            // Offline mode: use existing MEK or generate new one
            let mek = mek_opt.unwrap_or_else(|| {
                let new_mek = SecretKey::random();
                if let Err(e) = cred_store.store_mek(new_mek.as_bytes()) {
                    warn!(error = %e, "Failed to store auto-generated MEK");
                }
                info!("Generated new MEK for local E2EE (offline mode)");
                new_mek
            });
            (None, mek)
        }
    };

    // Get or create session ID (persisted for reconnection)
    let session_id = get_or_create_session_id(&cred_store, resume)?;
    if resume {
        info!(session_id = %session_id, "Resuming session");
    } else {
        info!(session_id = %session_id, "Starting new session");
    }

    // Get current working directory
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    debug!(
        device_name = %device_name,
        cwd = %cwd,
        "Session context"
    );

    // Set up terminal (raw mode)
    let mut terminal = TerminalManager::new()?;
    terminal.enter_raw_mode()?;

    // Log agent info
    info!(
        agent = %agent.name,
        command = %agent.command,
        hooks = agent.supports_hooks(),
        "Starting agent"
    );

    // Show notification if agent supports hooks but user hasn't configured them
    if agent.supports_hooks() && !hooks_configured(&agent) {
        terminal.exit_raw_mode()?;
        ui::display_hooks_available_notice(&agent);
        terminal.enter_raw_mode()?;
    }

    // Build environment variables for session correlation
    let mut env_vars: HashMap<String, String> = HashMap::new();
    env_vars.insert(ENV_SESSION_ID.to_string(), session_id.to_string());
    env_vars.insert(ENV_API_URL.to_string(), config.api_url.to_string());
    // TODO: Generate a short-lived hook token for authentication
    // For now, we use the access token if available
    if let Some(ref token) = access_token {
        env_vars.insert(ENV_HOOK_TOKEN.to_string(), token.clone());
    }

    // Build full argument list (agent defaults + user args)
    let mut full_args = agent.args.clone();
    full_args.extend(agent_args);

    // Set custom prompt for shell agent using ZDOTDIR (zsh) or --rcfile (bash)
    // This sources user's config first, then overrides the prompt
    let _temp_dir = if agent.id == "shell" {
        setup_shell_prompt(&agent.command, &mut env_vars, &mut full_args)
    } else {
        None
    };

    // Spawn agent in PTY
    let pty = match PtyManager::spawn_with_env(&agent.command, &full_args, env_vars) {
        Ok(pty) => pty,
        Err(e) => {
            terminal.exit_raw_mode()?;
            return Err(CliError::SpawnError(format!(
                "Could not start {}. Is it installed and in your PATH?\n\
                 Error: {}",
                agent.name, e
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
                &mek,
                session_name.as_deref(),
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

    // Status line update counter (draw every ~1 second)
    let mut status_tick: u32 = 0;
    let mut last_status_state = ConnectionState::Detached;

    // Reconnection backoff state
    let mut last_reconnect_attempt = std::time::Instant::now();
    let mut reconnect_backoff_secs: u64 = 1;
    const MAX_RECONNECT_BACKOFF_SECS: u64 = 60;

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

                // Handle reconnection if needed (with exponential backoff)
                let state = *connection_state_for_loop.lock().await;
                if state == ConnectionState::Reconnecting {
                    let elapsed = last_reconnect_attempt.elapsed();
                    if elapsed.as_secs() >= reconnect_backoff_secs {
                        last_reconnect_attempt = std::time::Instant::now();

                        let success = handle_reconnection_silent(
                            &ws_client_for_loop,
                            &connection_state_for_loop,
                            &config,
                            &cred_store,
                            session_id.as_str(),
                            device_id.as_str(),
                            &device_name,
                            &cwd,
                            &mek,
                            session_name.as_deref(),
                        )
                        .await;

                        if success {
                            // Reset backoff on success
                            reconnect_backoff_secs = 1;
                        } else {
                            // Exponential backoff, capped
                            reconnect_backoff_secs = (reconnect_backoff_secs * 2)
                                .min(MAX_RECONNECT_BACKOFF_SECS);
                            debug!(
                                "Reconnection failed, next attempt in {}s",
                                reconnect_backoff_secs
                            );
                        }
                    }
                }

                // Draw status line periodically (~1 second) or on state change
                status_tick += 1;
                let state_changed = state != last_status_state;
                if state_changed || status_tick >= 100 {
                    status_tick = 0;
                    last_status_state = state;

                    // Use dim/faint colors (ANSI 2 = dim, 90 = bright black/grey)
                    let status = match state {
                        ConnectionState::Attached => {
                            "\x1b[2;32m● klaas\x1b[0m"  // dim green
                        }
                        ConnectionState::Connecting | ConnectionState::Reconnecting => {
                            "\x1b[2;33m● klaas reconnecting\x1b[0m"  // dim yellow
                        }
                        ConnectionState::Detached => {
                            "\x1b[2;90m● klaas offline\x1b[0m"  // dim grey
                        }
                    };
                    let _ = terminal.draw_status_line(status);
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
/// If `resume` is true, attempts to reuse the stored session ID.
/// Otherwise, creates a new session ID (default behavior).
/// This allows the CLI to optionally reconnect to the same session,
/// which means the web dashboard will show the same session.
fn get_or_create_session_id(cred_store: &CredentialStore, resume: bool) -> Result<SessionId> {
    if resume {
        // Try to reuse existing session ID
        if let Some(id) = cred_store.get_session_id()? {
            debug!("Retrieved existing session ID");
            return Ok(SessionId::from_string(id));
        }
        // No existing session to resume, fall through to create new
        debug!("No existing session to resume, creating new");
    }

    // Create and store new session ID
    let new_id = SessionId::new();
    cred_store.store_session_id(new_id.as_str())?;
    debug!(session_id = %new_id, "Generated new session ID");
    Ok(new_id)
}

/// Ensures the user is authenticated with E2EE key exchange.
///
/// Checks for stored credentials and MEK. Refreshes tokens if expired.
/// Runs unified OAuth Device Flow with ECDH if no valid credentials or MEK exist.
///
/// # Arguments
/// * `config` - API configuration.
/// * `cred_store` - Credential store for persisting tokens.
/// * `device_name` - Human-readable device name (used if device flow is needed).
///
/// # Returns
/// A tuple of (access_token, MEK).
async fn ensure_authenticated_with_mek(
    config: &ApiConfig,
    cred_store: &CredentialStore,
    device_name: &str,
) -> Result<(String, SecretKey)> {
    // Check if we have MEK in keychain
    let mek_from_keychain = cred_store.get_mek()?.map(|mek_bytes| {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&mek_bytes);
        SecretKey::from_bytes(arr)
    });

    // Check for stored tokens
    if let Some((access_token, refresh_token_val)) = cred_store.get_tokens()? {
        debug!("Found stored tokens");

        // If we have both tokens and MEK, try to use them
        if let Some(mek) = mek_from_keychain.clone() {
            match is_token_valid(&access_token) {
                Some(true) => {
                    debug!("Access token is still valid, using it directly");
                    return Ok((access_token, mek));
                }
                Some(false) => {
                    // Token is definitely expired, try to refresh
                    debug!("Access token is expired, attempting refresh");
                }
                None => {
                    // Couldn't validate token (parsing error), use it anyway
                    // The API/WebSocket will reject if truly invalid
                    debug!("Could not validate token format, using it anyway");
                    return Ok((access_token, mek));
                }
            }

            // Try to refresh the expired token
            match refresh_token(config.api_url, &refresh_token_val).await {
                Ok(tokens) => {
                    debug!("Successfully refreshed tokens");
                    cred_store.store_tokens(&tokens.access_token, &tokens.refresh_token)?;
                    return Ok((tokens.access_token, mek));
                }
                Err(AuthError::InvalidGrant) => {
                    // Refresh token expired, need to re-authenticate
                    info!("Refresh token expired, starting new authentication");
                    cred_store.clear_tokens()?;
                }
                Err(e) => {
                    // Network error or other issue - use existing token anyway
                    // The API will reject if truly expired, and WebSocket will fail gracefully
                    warn!(error = %e, "Failed to refresh token, using existing");
                    return Ok((access_token, mek));
                }
            }
        } else {
            // Have tokens but no MEK - need to re-authenticate with unified flow
            info!("No MEK found, starting authentication with E2EE key exchange");
            cred_store.clear_tokens()?;
        }
    }

    // No valid tokens or no MEK, run unified OAuth Device Flow with ECDH
    info!("Starting authentication with E2EE key exchange");
    let (tokens, mek) = authenticate_with_mek(config.api_url, device_name)
        .await
        .map_err(|e| match e {
            AuthError::Cancelled | AuthError::Skipped => CliError::AuthError(e.to_string()),
            _ => CliError::AuthError(e.to_string()),
        })?;

    // Store the new tokens and MEK
    cred_store.store_tokens(&tokens.access_token, &tokens.refresh_token)?;
    cred_store.store_mek(mek.as_bytes())?;
    info!("Authentication successful with E2EE established");

    Ok((tokens.access_token, mek))
}

/// Checks if a JWT access token is still valid (not expired).
///
/// Decodes the JWT payload (without verifying signature) and checks the `exp` claim.
///
/// # Arguments
/// * `token` - The JWT access token to check.
///
/// # Returns
/// * `Some(true)` if the token is valid and has more than `TOKEN_REFRESH_BUFFER_SECS` until expiry.
/// * `Some(false)` if the token is definitely expired.
/// * `None` if the token format couldn't be parsed (caller should use token anyway).
fn is_token_valid(token: &str) -> Option<bool> {
    use base64::{
        engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
        Engine,
    };

    // JWT format: header.payload.signature
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        debug!("Invalid JWT format (expected 3 parts, got {})", parts.len());
        return None;
    }

    // Decode the payload (second part)
    // Try without padding first, then with padding (JWTs can vary)
    let payload = URL_SAFE_NO_PAD
        .decode(parts[1])
        .or_else(|_| URL_SAFE.decode(parts[1]))
        .or_else(|_| {
            // Try adding padding manually
            let mut padded = parts[1].to_string();
            while !padded.len().is_multiple_of(4) {
                padded.push('=');
            }
            URL_SAFE.decode(&padded)
        });

    let payload = match payload {
        Ok(bytes) => bytes,
        Err(e) => {
            debug!("Failed to decode JWT payload: {}", e);
            return None;
        }
    };

    // Parse as JSON
    let payload_str = match std::str::from_utf8(&payload) {
        Ok(s) => s,
        Err(e) => {
            debug!("JWT payload is not valid UTF-8: {}", e);
            return None;
        }
    };

    // Extract the `exp` claim using simple JSON parsing
    let json_value = match serde_json::from_str::<serde_json::Value>(payload_str) {
        Ok(v) => v,
        Err(e) => {
            debug!("Failed to parse JWT payload as JSON: {}", e);
            return None;
        }
    };

    let exp = match json_value.get("exp").and_then(|e| e.as_i64()) {
        Some(e) => e,
        None => {
            debug!("JWT payload does not contain 'exp' claim");
            return None;
        }
    };

    // Check if token is expired (with buffer)
    let now = chrono::Utc::now().timestamp();
    let valid = exp > now + TOKEN_REFRESH_BUFFER_SECS;

    if valid {
        debug!("Token valid for {} more seconds", exp - now);
    } else {
        debug!("Token expired (exp: {}, now: {})", exp, now);
    }

    Some(valid)
}

/// Result of authentication attempt with E2EE key exchange.
pub enum AuthAttemptResultWithMek {
    /// Successfully authenticated with access token and MEK from unified device flow.
    Success(String, SecretKey),
    /// User cancelled (CTRL+C) - should exit.
    Cancelled,
    /// User skipped (ESC) or offline - continue without sync.
    /// Contains existing MEK from keychain if available.
    Offline(Option<SecretKey>),
}

/// Tries to authenticate with unified device flow, handling cancellation gracefully.
///
/// This is a non-blocking wrapper around `ensure_authenticated_with_mek` that allows
/// the CLI to start in offline mode when the API server is unavailable.
/// The user can still use Claude Code normally, just without remote sync.
async fn try_authenticate_with_mek(
    config: &ApiConfig,
    cred_store: &CredentialStore,
    device_name: &str,
) -> AuthAttemptResultWithMek {
    match ensure_authenticated_with_mek(config, cred_store, device_name).await {
        Ok((token, mek)) => AuthAttemptResultWithMek::Success(token, mek),
        Err(e) => {
            let error_str = e.to_string();

            // Get existing MEK from keychain for offline use
            let mek_from_keychain = cred_store
                .get_mek()
                .ok()
                .flatten()
                .map(|mek_bytes| {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&mek_bytes);
                    SecretKey::from_bytes(arr)
                });

            // Check if this was a user-initiated skip (ESC)
            if error_str.contains("skipped") {
                debug!("Auth skipped by user, continuing without sync");
                return AuthAttemptResultWithMek::Offline(mek_from_keychain);
            }

            // Check if this was a user cancellation (CTRL+C)
            if error_str.contains("cancelled") {
                return AuthAttemptResultWithMek::Cancelled;
            }

            // Other errors - show offline warning
            ui::display_offline_warning();
            debug!(error = %e, "Starting in offline mode");
            AuthAttemptResultWithMek::Offline(mek_from_keychain)
        }
    }
}

/// Connects to the WebSocket server.
///
/// Returns None if connection fails (CLI continues to work locally).
/// Sets up the MEK for transparent E2EE on the connection.
#[allow(clippy::too_many_arguments)]
async fn connect_websocket(
    config: &ApiConfig,
    access_token: &str,
    session_id: &str,
    device_id: &str,
    device_name: &str,
    cwd: &str,
    mek: &SecretKey,
    session_name: Option<&str>,
) -> Option<WebSocketClient> {
    debug!(ws_url = %config.ws_url, "Connecting to WebSocket");

    match WebSocketClient::connect(
        config.ws_url,
        access_token,
        session_id,
        device_id,
        device_name,
        cwd,
        session_name,
    )
    .await
    {
        Ok(client) => {
            // Set MEK for transparent E2EE
            client.set_mek(mek.clone()).await;
            info!("Connected to remote session with E2EE enabled");
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

/// Handles WebSocket reconnection silently (no giving up).
///
/// Returns true if reconnection succeeded, false otherwise.
/// On failure, keeps state as Reconnecting so we keep trying.
#[allow(clippy::too_many_arguments)]
async fn handle_reconnection_silent(
    ws_client: &Arc<Mutex<Option<WebSocketClient>>>,
    connection_state: &Arc<Mutex<ConnectionState>>,
    config: &ApiConfig,
    cred_store: &CredentialStore,
    session_id: &str,
    device_id: &str,
    device_name: &str,
    cwd: &str,
    mek: &SecretKey,
    session_name: Option<&str>,
) -> bool {
    debug!("Attempting WebSocket reconnection");

    // First, try to reconnect with the existing client
    {
        let client_guard = ws_client.lock().await;
        if let Some(ref client) = *client_guard {
            match client.reconnect().await {
                Ok(true) => {
                    info!("Reconnected to remote session");
                    *connection_state.lock().await = ConnectionState::Attached;
                    return true;
                }
                Ok(false) | Err(_) => {
                    // Failed, will try fresh connection below
                }
            }
        }
    }

    // Try a fresh connection with potentially refreshed token
    let access_token = match ensure_authenticated_with_mek(config, cred_store, device_name).await {
        Ok((token, _)) => token,
        Err(_) => {
            // Stay in Reconnecting state, will retry later
            return false;
        }
    };

    match connect_websocket(
        config,
        &access_token,
        session_id,
        device_id,
        device_name,
        cwd,
        mek,
        session_name,
    )
    .await
    {
        Some(new_client) => {
            *ws_client.lock().await = Some(new_client);
            *connection_state.lock().await = ConnectionState::Attached;
            info!("Established new connection to remote session");
            true
        }
        None => {
            // Stay in Reconnecting state, will retry later
            false
        }
    }
}

/// Checks if hooks are configured for the given agent.
///
/// For Claude Code, checks ~/.claude/settings.json for hooks configuration.
/// For Gemini CLI, checks ~/.gemini/settings.json.
fn hooks_configured(agent: &Agent) -> bool {
    use crate::agents::HooksType;
    use std::path::PathBuf;

    let settings_path: Option<PathBuf> = match agent.hooks_type {
        HooksType::Claude => dirs::home_dir().map(|h| h.join(".claude").join("settings.json")),
        HooksType::Gemini => dirs::home_dir().map(|h| h.join(".gemini").join("settings.json")),
        _ => return false,
    };

    let Some(path) = settings_path else {
        return false;
    };

    if !path.exists() {
        return false;
    }

    // Read and check if hooks are configured
    if let Ok(contents) = std::fs::read_to_string(&path) {
        // Simple check: look for "klaas" in the hooks configuration
        // A proper implementation would parse JSON and check the hooks section
        contents.contains("klaas")
    } else {
        false
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

/// Sets up custom shell prompt by creating a temp config that sources user's
/// config then sets our prompt.
///
/// Returns a TempDir that must be kept alive for the duration of the shell.
fn setup_shell_prompt(
    command: &str,
    env_vars: &mut HashMap<String, String>,
    args: &mut Vec<String>,
) -> Option<tempfile::TempDir> {
    use std::io::Write;

    let shell_name = std::path::Path::new(command)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(command);

    // Amber color prompt: "klaas › "
    let zsh_prompt = "%{\x1b[38;2;245;158;11m%}klaas ›%{\x1b[0m%} ";
    let bash_prompt = "\\[\\033[38;2;245;158;11m\\]klaas ›\\[\\033[0m\\] ";

    // Welcome message in dimmed grey
    let version = env!("CARGO_PKG_VERSION");
    let welcome_msg = format!(
        r#"echo -e "\033[38;2;113;113;122mklaas v{}. Ctrl+D to exit.\033[0m""#,
        version
    );

    match shell_name {
        "zsh" => {
            // Create temp dir with custom .zshrc
            if let Ok(temp_dir) = tempfile::tempdir() {
                let zshrc_path = temp_dir.path().join(".zshrc");
                if let Ok(mut file) = std::fs::File::create(&zshrc_path) {
                    // Source user's config then set our prompt
                    let content = format!(
                        r#"# klaas shell wrapper
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
PROMPT='{}'
{}
"#,
                        zsh_prompt, welcome_msg
                    );
                    if file.write_all(content.as_bytes()).is_ok() {
                        env_vars.insert(
                            "ZDOTDIR".to_string(),
                            temp_dir.path().to_string_lossy().to_string(),
                        );
                        return Some(temp_dir);
                    }
                }
            }
            None
        }
        "bash" => {
            // Create temp rcfile that sources user's config then sets prompt
            if let Ok(mut temp_file) = tempfile::NamedTempFile::new() {
                let content = format!(
                    r#"# klaas shell wrapper
[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"
PS1='{}'
{}
"#,
                    bash_prompt, welcome_msg
                );
                if temp_file.write_all(content.as_bytes()).is_ok() {
                    // Keep the file around (don't delete on drop)
                    let (_, path) = temp_file.keep().ok()?;
                    args.push("--rcfile".to_string());
                    args.push(path.to_string_lossy().to_string());
                }
            }
            None
        }
        _ => {
            // For other shells, just set PS1 and hope for the best
            env_vars.insert("PS1".to_string(), bash_prompt.to_string());
            None
        }
    }
}
