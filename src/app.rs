//! Application orchestration and main I/O loop.
//!
//! Wraps Claude Code in a PTY and captures all I/O for remote streaming.
//! Auto-attaches to the remote session on startup.

use crate::config::CLAUDE_COMMAND;
use crate::error::{CliError, Result};
use crate::pty::PtyManager;
use crate::terminal::TerminalManager;
use crate::types::{ConnectionState, SessionId};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};

/// Runs the CLI application.
///
/// Spawns Claude Code in a PTY, captures all I/O, and auto-attaches
/// to the remote session for streaming.
///
/// # Arguments
/// * `claude_args` - Arguments to pass through to Claude Code.
///
/// # Returns
/// Exit code from Claude Code.
pub async fn run(claude_args: Vec<String>) -> Result<i32> {
    // Generate session ID
    let session_id = SessionId::new();
    tracing::info!("Starting session: {}", session_id);

    // Get current working directory
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // Get device name from hostname
    let device_name = hostname::get()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());

    tracing::info!(
        "Device: {}, CWD: {}, Session: {}",
        device_name,
        cwd,
        session_id
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

    // Auto-attach: set connection state to Attached
    // In full implementation, this would establish WebSocket connection
    let connection_state = Arc::new(Mutex::new(ConnectionState::Attached));
    tracing::info!("Auto-attached to session");

    // Create channels for coordinating shutdown
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<i32>(1);

    // Channel for PTY output (displayed to terminal, and later streamed to WebSocket)
    let (pty_output_tx, mut pty_output_rx) = mpsc::channel::<Vec<u8>>(256);

    // Channel for PTY input (from keyboard, and later from WebSocket)
    let (pty_input_tx, mut pty_input_rx) = mpsc::channel::<Vec<u8>>(256);

    // Clone PTY for the reader task
    let pty_for_reader = pty.clone();
    let shutdown_tx_reader = shutdown_tx.clone();

    // Spawn PTY reader task (reads output from Claude Code)
    let reader_handle = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match pty_for_reader.read_blocking(&mut buf) {
                Ok(0) => {
                    // EOF - process exited
                    let _ = shutdown_tx_reader.blocking_send(0);
                    break;
                }
                Ok(n) => {
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

    // Clone PTY for the writer task
    let pty_for_writer = pty.clone();

    // Spawn PTY writer task (writes input to Claude Code)
    let writer_handle = tokio::task::spawn_blocking(move || {
        while let Some(data) = pty_input_rx.blocking_recv() {
            if pty_for_writer.write_blocking(&data).is_err() {
                break;
            }
        }
    });

    // Main event loop - simple pass-through
    let exit_code = 'main: loop {
        tokio::select! {
            // Handle PTY output (display to terminal)
            Some(output) = pty_output_rx.recv() => {
                // Write to local terminal
                terminal.write(&output)?;

                // TODO: Stream to WebSocket when connected
                // if *connection_state.lock().await == ConnectionState::Attached {
                //     websocket.send(output).await;
                // }
            }

            // Handle shutdown signal
            Some(code) = shutdown_rx.recv() => {
                break 'main code;
            }

            // Poll for keyboard input
            _ = tokio::time::sleep(Duration::from_millis(10)) => {
                // Poll for terminal events (non-blocking)
                while let Ok(Some(event)) = terminal.poll_event(Duration::from_millis(0)) {
                    match event {
                        Event::Key(key_event) => {
                            let bytes = key_event_to_bytes(key_event);
                            if !bytes.is_empty() {
                                // Forward directly to PTY (no interception)
                                let _ = pty_input_tx.send(bytes).await;
                            }
                        }
                        Event::Resize(cols, rows) => {
                            let _ = pty.resize(cols, rows).await;
                        }
                        _ => {}
                    }
                }
            }
        }
    };

    // Cleanup
    tracing::info!("Session ended: {}", session_id);
    *connection_state.lock().await = ConnectionState::Detached;

    drop(pty_input_tx);
    let _ = reader_handle.await;
    let _ = writer_handle.await;

    Ok(exit_code)
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
