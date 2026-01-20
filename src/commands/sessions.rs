//! Sessions command - list and select sessions interactively.
//!
//! Displays all sessions for the authenticated user in an interactive list
//! with arrow key navigation. Returns the selected session ID, a request
//! to start a new session, or None if the user cancels.

use std::io::{self, Write};

use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::terminal;
use tracing::debug;

use crate::api_client::{ApiClient, Session};
use crate::auth;
use crate::config::API_URL;
use crate::credentials;
use crate::error::{CliError, Result};
use crate::ui::colors;

/// Result of the sessions command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionsResult {
    /// User selected a session to connect to.
    Selected(String),
    /// User wants to start a new session.
    StartNew,
    /// User cancelled (Escape or Ctrl+C).
    Cancelled,
}

/// Runs the sessions command.
///
/// Lists all sessions for the authenticated user with interactive selection.
/// If the user is not authenticated, triggers the device flow.
///
/// # Returns
///
/// - `Ok(SessionsResult::Selected(session_id))` when user selects a session
/// - `Ok(SessionsResult::StartNew)` when user wants to start a new session
/// - `Ok(SessionsResult::Cancelled)` when user cancels (Escape or Ctrl+C)
/// - `Err(...)` on authentication or API errors
pub async fn run() -> Result<SessionsResult> {
    // Ensure user is authenticated
    let access_token = ensure_authenticated().await?;

    // Fetch sessions from API
    let sessions = fetch_sessions(&access_token).await?;

    if sessions.is_empty() {
        return prompt_start_new_session();
    }

    // Show interactive session list
    select_session(&sessions)
}

/// Prompts the user to start a new session when no sessions exist.
fn prompt_start_new_session() -> Result<SessionsResult> {
    println!();
    println!(
        "  {}No sessions found.{}",
        fg_color(colors::TEXT_MUTED),
        RESET
    );
    println!();
    print!(
        "  {}Start a new session? [Y/n]:{} ",
        fg_color(colors::TEXT_SECONDARY),
        RESET
    );
    io::stdout().flush().ok();

    // Read single character
    let mut input = String::new();
    io::stdin().read_line(&mut input).ok();
    let input = input.trim().to_lowercase();

    println!();

    // Default is Yes (empty input or 'y')
    if input.is_empty() || input == "y" || input == "yes" {
        Ok(SessionsResult::StartNew)
    } else {
        Ok(SessionsResult::Cancelled)
    }
}

/// Ensures the user is authenticated, triggering device flow if needed.
///
/// Returns the access token on success.
async fn ensure_authenticated() -> Result<String> {
    // Check for existing tokens
    if let Some((access_token, _refresh_token)) = credentials::get_tokens()? {
        // Try to use existing token or refresh it
        // For now, just use the access token directly
        // TODO: Add token validation and refresh logic
        debug!("Using existing access token");
        return Ok(access_token);
    }

    // No tokens - need to authenticate
    debug!("No tokens found, starting device flow");

    // Display startup banner for auth
    crate::ui::display_startup_banner();

    match auth::authenticate(API_URL).await {
        Ok(token_response) => {
            // Store tokens
            credentials::store_tokens(&token_response.access_token, &token_response.refresh_token)?;
            Ok(token_response.access_token)
        }
        Err(auth::AuthError::Cancelled) => Err(CliError::AuthError("Cancelled".to_string())),
        Err(auth::AuthError::Skipped) => Err(CliError::AuthError("Skipped".to_string())),
        Err(e) => Err(CliError::AuthError(e.to_string())),
    }
}

/// Fetches sessions from the API using the ApiClient.
async fn fetch_sessions(access_token: &str) -> Result<Vec<Session>> {
    debug!("Fetching sessions from API");

    let client = ApiClient::new(API_URL, access_token);
    client.get_sessions().await
}

/// Shows interactive session selection and returns the selected session ID.
fn select_session(sessions: &[Session]) -> Result<SessionsResult> {
    if sessions.is_empty() {
        return Ok(SessionsResult::Cancelled);
    }

    // Enter raw mode for keyboard input
    if terminal::enable_raw_mode().is_err() {
        // Fall back to first session if we can't enter raw mode
        return Ok(SessionsResult::Selected(sessions[0].session_id.clone()));
    }

    let mut selected_index: usize = 0;
    let mut stdout = io::stdout();

    // Draw initial menu
    draw_sessions_menu(&mut stdout, sessions, selected_index, false);

    let result = loop {
        // Wait for key event
        if let Ok(Event::Key(key_event)) = event::read() {
            match key_event.code {
                KeyCode::Up => {
                    // Wrap around: if at top, go to bottom
                    if selected_index > 0 {
                        selected_index -= 1;
                    } else {
                        selected_index = sessions.len() - 1;
                    }
                    draw_sessions_menu(&mut stdout, sessions, selected_index, true);
                }
                KeyCode::Down => {
                    // Wrap around: if at bottom, go to top
                    if selected_index < sessions.len() - 1 {
                        selected_index += 1;
                    } else {
                        selected_index = 0;
                    }
                    draw_sessions_menu(&mut stdout, sessions, selected_index, true);
                }
                KeyCode::Enter => {
                    break SessionsResult::Selected(sessions[selected_index].session_id.clone());
                }
                KeyCode::Esc => {
                    break SessionsResult::Cancelled;
                }
                KeyCode::Char(c) => {
                    // Ctrl+C to cancel
                    if c == 'c' && key_event.modifiers.contains(KeyModifiers::CONTROL) {
                        break SessionsResult::Cancelled;
                    }
                }
                _ => {}
            }
        }
    };

    // Exit raw mode and clear menu
    let _ = terminal::disable_raw_mode();
    clear_sessions_menu(&mut stdout, sessions.len());

    Ok(result)
}

/// Draws the session selection menu.
fn draw_sessions_menu(
    stdout: &mut io::Stdout,
    sessions: &[Session],
    selected_index: usize,
    is_redraw: bool,
) {
    use crossterm::{cursor, terminal as ct, QueueableCommand};

    // Calculate total lines: header + blank + sessions (2 lines each) + dividers
    // + blank + footer
    let session_lines = sessions.len() * 2 + sessions.len().saturating_sub(1); // 2 per session + dividers
    let total_lines = 1 + 1 + 2 + session_lines + 2 + 1 + 1; // header, blank, box top, sessions, box bottom, blank, footer

    // If redrawing, move cursor up to overwrite previous menu
    if is_redraw {
        for _ in 0..total_lines {
            let _ = stdout.queue(cursor::MoveUp(1));
            let _ = stdout.queue(ct::Clear(ct::ClearType::CurrentLine));
        }
    }

    let _ = stdout.queue(cursor::MoveToColumn(0));

    // Header
    print!(
        "  {}{}Your klaas sessions{}\r\n\r\n",
        BOLD,
        fg_color(colors::AMBER),
        RESET
    );

    // Box width (72 chars inside)
    let box_width = 72;

    // Top border
    print!(
        "  {}{}{}",
        fg_color(colors::TEXT_DIM),
        top_border(box_width),
        RESET
    );
    print!("\r\n");

    // Sessions
    for (idx, session) in sessions.iter().enumerate() {
        let is_selected = idx == selected_index;

        // Format session line
        draw_session_row(stdout, session, is_selected);

        // Divider between sessions (not after last one)
        if idx < sessions.len() - 1 {
            print!(
                "  {}{}{}",
                fg_color(colors::TEXT_DIM),
                middle_border(box_width),
                RESET
            );
            print!("\r\n");
        }
    }

    // Bottom border
    print!(
        "  {}{}{}",
        fg_color(colors::TEXT_DIM),
        bottom_border(box_width),
        RESET
    );
    print!("\r\n\r\n");

    // Footer
    print!(
        "  {}Use \u{2191}\u{2193} arrows and Enter. Esc to cancel.{}\r\n",
        fg_color(colors::TEXT_MUTED),
        RESET
    );

    let _ = stdout.flush();
}

/// Draws a single session row (2 lines).
fn draw_session_row(_stdout: &mut io::Stdout, session: &Session, is_selected: bool) {
    let is_attached = session.status == "attached";

    // Status indicator
    let status_indicator = if is_attached {
        format!("{}{}●{}", BOLD, fg_color(colors::GREEN), RESET)
    } else {
        " ".to_string()
    };

    // Format cwd (shorten home directory)
    let cwd = shorten_path(&session.cwd);

    // Format relative time
    let time_ago = format_relative_time(&session.started_at);

    // Get the plain name for display
    let name_plain = session.name.as_deref().unwrap_or("(unnamed)");

    // Print first line
    print!("  {}│{}", fg_color(colors::TEXT_DIM), RESET);
    print!(" {} ", status_indicator);

    // Name with color
    if session.name.is_some() {
        if is_selected {
            print!(
                "{}{:<20}{}",
                fg_color(colors::AMBER),
                truncate_str(name_plain, 20),
                RESET
            );
        } else {
            print!(
                "{}{:<20}{}",
                fg_color(colors::TEXT_PRIMARY),
                truncate_str(name_plain, 20),
                RESET
            );
        }
    } else {
        print!("{}{:<20}{}", fg_color(colors::TEXT_DIM), "(unnamed)", RESET);
    }

    print!(" ");

    // CWD
    print!(
        "{}{:<28}{}",
        fg_color(colors::TEXT_SECONDARY),
        truncate_str(&cwd, 28),
        RESET
    );

    print!(" ");

    // Time
    print!("{}{:>14}{}", fg_color(colors::TEXT_MUTED), time_ago, RESET);

    print!(" ");
    print!("{}│{}", fg_color(colors::TEXT_DIM), RESET);
    print!("\r\n");

    // Print second line
    print!("  {}│{}", fg_color(colors::TEXT_DIM), RESET);
    print!("   ");

    // Session ID
    print!(
        "{}{:<44}{}",
        fg_color(colors::TEXT_DIM),
        &session.session_id,
        RESET
    );

    print!(" ");

    // Status
    if is_attached {
        print!("{}{:>22}{}", fg_color(colors::GREEN), "attached", RESET);
    } else {
        print!("{}{:>22}{}", fg_color(colors::TEXT_DIM), "detached", RESET);
    }

    print!(" ");
    print!("{}│{}", fg_color(colors::TEXT_DIM), RESET);
    print!("\r\n");
}

/// Clears the session selection menu from the terminal.
fn clear_sessions_menu(stdout: &mut io::Stdout, session_count: usize) {
    use crossterm::{cursor, terminal as ct, QueueableCommand};

    // Calculate lines to clear
    let session_lines = session_count * 2 + session_count.saturating_sub(1);
    let total_lines = 1 + 1 + 2 + session_lines + 2 + 1 + 1;

    for _ in 0..total_lines {
        let _ = stdout.queue(cursor::MoveUp(1));
        let _ = stdout.queue(ct::Clear(ct::ClearType::CurrentLine));
    }

    let _ = stdout.flush();
}

/// Generates top border: ┌────...────┐
fn top_border(width: usize) -> String {
    format!("┌{}┐", "─".repeat(width))
}

/// Generates middle border: ├────...────┤
fn middle_border(width: usize) -> String {
    format!("├{}┤", "─".repeat(width))
}

/// Generates bottom border: └────...────┘
fn bottom_border(width: usize) -> String {
    format!("└{}┘", "─".repeat(width))
}

/// Truncates a string to max length, adding "..." if truncated.
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else if max_len <= 3 {
        s.chars().take(max_len).collect()
    } else {
        let truncated: String = s.chars().take(max_len - 3).collect();
        format!("{}...", truncated)
    }
}

/// Shortens a path by replacing home directory with ~.
fn shorten_path(path: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        if path.starts_with(home_str.as_ref()) {
            return format!("~{}", &path[home_str.len()..]);
        }
    }
    path.to_string()
}

/// Formats an ISO 8601 timestamp as a relative time string.
fn format_relative_time(timestamp: &str) -> String {
    use chrono::{DateTime, Utc};

    let parsed: DateTime<Utc> = match timestamp.parse() {
        Ok(dt) => dt,
        Err(_) => return timestamp.to_string(),
    };

    let now = Utc::now();
    let duration = now.signed_duration_since(parsed);

    let seconds = duration.num_seconds();
    if seconds < 0 {
        return "just now".to_string();
    }

    if seconds < 60 {
        return "just now".to_string();
    }

    let minutes = seconds / 60;
    if minutes < 60 {
        return if minutes == 1 {
            "1 minute ago".to_string()
        } else {
            format!("{} minutes ago", minutes)
        };
    }

    let hours = minutes / 60;
    if hours < 24 {
        return if hours == 1 {
            "1 hour ago".to_string()
        } else {
            format!("{} hours ago", hours)
        };
    }

    let days = hours / 24;
    if days < 30 {
        return if days == 1 {
            "1 day ago".to_string()
        } else {
            format!("{} days ago", days)
        };
    }

    let months = days / 30;
    if months == 1 {
        "1 month ago".to_string()
    } else {
        format!("{} months ago", months)
    }
}

/// Generates ANSI escape code for 24-bit true color foreground.
fn fg_color(color: (u8, u8, u8)) -> String {
    format!("\x1b[38;2;{};{};{}m", color.0, color.1, color.2)
}

/// ANSI reset code.
const RESET: &str = "\x1b[0m";

/// Bold ANSI code.
const BOLD: &str = "\x1b[1m";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_str() {
        assert_eq!(truncate_str("hello", 10), "hello");
        assert_eq!(truncate_str("hello", 5), "hello");
        assert_eq!(truncate_str("hello world", 8), "hello...");
        assert_eq!(truncate_str("hello", 3), "hel");
    }

    #[test]
    fn test_shorten_path() {
        // Path that doesn't contain home should be unchanged
        let path = "/usr/local/bin";
        assert_eq!(shorten_path(path), path);
    }

    #[test]
    fn test_format_relative_time() {
        // Test with a timestamp that's definitely in the past
        let result = format_relative_time("2020-01-01T00:00:00Z");
        assert!(result.contains("ago") || result.contains("months"));
    }

    #[test]
    fn test_borders() {
        assert_eq!(top_border(5), "┌─────┐");
        assert_eq!(middle_border(5), "├─────┤");
        assert_eq!(bottom_border(5), "└─────┘");
    }
}
