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
    use crossterm::{cursor, ExecutableCommand};

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

    // Hide cursor during selection
    let _ = stdout.execute(cursor::Hide);

    // Save cursor position before drawing
    let _ = stdout.execute(cursor::SavePosition);

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

    // Show cursor again
    let _ = stdout.execute(cursor::Show);

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

    // If redrawing, restore cursor to saved position
    if is_redraw {
        let _ = stdout.queue(cursor::RestorePosition);
        // Clear from cursor to end of screen
        let _ = stdout.queue(ct::Clear(ct::ClearType::FromCursorDown));
    }

    let _ = stdout.queue(cursor::MoveToColumn(0));

    // Header
    print!(
        "  {}{}Your klaas sessions{}\r\n\r\n",
        BOLD,
        fg_color(colors::AMBER),
        RESET
    );

    // Box width: 72 chars inside, 76 total with borders and indent
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

/// Draws a single session row (3 lines).
///
/// Box width: 72 chars. Layout (left-aligned + fill + right-aligned + space):
/// Line 1: ` ● name` (3+20) + fill + `datetime` (16) + ` ` = 72
/// Line 2: `   session_id` (3+26) + fill + `device_name` (truncated) + ` ` = 72
/// Line 3: `   cwd` (3+truncated) + fill + `status` (8) + ` ` = 72
fn draw_session_row(_stdout: &mut io::Stdout, session: &Session, is_selected: bool) {
    let is_attached = session.status == "attached";

    // Border color: amber when selected, dim otherwise
    let border_color = if is_selected {
        colors::AMBER
    } else {
        colors::TEXT_DIM
    };

    // Background for selected rows
    let bg = if is_selected {
        bg_color(BG_SELECTED)
    } else {
        String::new()
    };

    // Status indicator
    let status_indicator = if is_attached {
        format!("{}{}●{}", BOLD, fg_color(colors::GREEN), RESET)
    } else {
        " ".to_string()
    };

    // Format cwd (shorten home directory)
    let cwd = shorten_path(&session.cwd);

    // Format datetime as "YYYY-MM-DD HH:MM" (16 chars)
    let datetime = format_datetime(&session.started_at);

    // Get the plain name for display
    let name_plain = session.name.as_deref().unwrap_or("(unnamed)");

    // Status text
    let status_text = if is_attached { "attached" } else { "detached" };

    // === Line 1: indicator + name ... datetime ===
    // Layout: ` ● ` (3) + name (20) + fill + datetime (16) + ` ` (1) = 72
    // Fill = 72 - 3 - 20 - 16 - 1 = 32
    print!("  {}│{}{}", fg_color(border_color), RESET, bg);
    print!(" {} ", status_indicator); // 3 chars

    // Name with color (20 chars, left-aligned)
    let name_display = truncate_str(name_plain, 20);
    if session.name.is_some() {
        if is_selected {
            print!(
                "{}{:<20}{}{}",
                fg_color(colors::AMBER),
                name_display,
                RESET,
                bg
            );
        } else {
            print!(
                "{}{:<20}{}{}",
                fg_color(colors::TEXT_PRIMARY),
                name_display,
                RESET,
                bg
            );
        }
    } else if is_selected {
        print!(
            "{}{:<20}{}{}",
            fg_color(colors::TEXT_MUTED),
            "(unnamed)",
            RESET,
            bg
        );
    } else {
        print!("{}{:<20}{}", fg_color(colors::TEXT_DIM), "(unnamed)", RESET);
    }

    // Fill (32 chars) + datetime (16 chars) + space (1 char) + border
    print!(
        "{}{:>32}{} {}{}│{}\r\n",
        fg_color(colors::TEXT_MUTED),
        "",
        datetime,
        RESET,
        fg_color(border_color),
        RESET
    );

    // === Line 2: session_id ... device_name ===
    // Layout: `   ` (3) + session_id (26) + fill + device (max 30) + ` ` (1) = 72
    // Fill = 72 - 3 - 26 - device_len - 1 = 42 - device_len
    let device_display = truncate_str(&session.device_name, 30);
    let device_len = device_display.chars().count();
    let fill_2 = 42 - device_len;

    print!("  {}│{}{}", fg_color(border_color), RESET, bg);
    print!("   "); // 3 chars padding

    // Session ID (26 chars - ULID length)
    print!(
        "{}{:<26}{}{}",
        fg_color(colors::TEXT_DIM),
        &session.session_id,
        RESET,
        bg
    );

    // Fill + device_name + space + border
    print!(
        "{:>width$}{}{} {}{}│{}\r\n",
        "",
        fg_color(colors::TEXT_MUTED),
        device_display,
        RESET,
        fg_color(border_color),
        RESET,
        width = fill_2
    );

    // === Line 3: cwd ... status ===
    // Layout: `   ` (3) + cwd (max 50) + fill + status (8) + ` ` (1) = 72
    // Fill = 72 - 3 - cwd_len - 8 - 1 = 60 - cwd_len
    let cwd_display = truncate_str(&cwd, 50);
    let cwd_len = cwd_display.chars().count();
    let fill_3 = 60 - cwd_len;

    print!("  {}│{}{}", fg_color(border_color), RESET, bg);
    print!("   "); // 3 chars padding

    // CWD (left-aligned)
    print!(
        "{}{:<width$}{}{}",
        fg_color(colors::TEXT_SECONDARY),
        cwd_display,
        RESET,
        bg,
        width = cwd_len
    );

    // Fill + status + space + border
    let status_color = if is_attached {
        colors::GREEN
    } else {
        colors::TEXT_DIM
    };
    print!(
        "{:>width$}{}{} {}{}│{}\r\n",
        "",
        fg_color(status_color),
        status_text,
        RESET,
        fg_color(border_color),
        RESET,
        width = fill_3
    );
}

/// Clears the session selection menu from the terminal.
fn clear_sessions_menu(stdout: &mut io::Stdout, _session_count: usize) {
    use crossterm::{cursor, terminal as ct, QueueableCommand};

    // Restore to saved position and clear from there
    let _ = stdout.queue(cursor::RestorePosition);
    let _ = stdout.queue(ct::Clear(ct::ClearType::FromCursorDown));
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

/// Truncates a string to max length, adding "…" if truncated.
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else if max_len <= 1 {
        s.chars().take(max_len).collect()
    } else {
        let truncated: String = s.chars().take(max_len - 1).collect();
        format!("{}…", truncated)
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

/// Formats an ISO 8601 timestamp as "YYYY-MM-DD HH:MM" (16 chars).
fn format_datetime(timestamp: &str) -> String {
    use chrono::{DateTime, Local, Utc};

    let parsed: DateTime<Utc> = match timestamp.parse() {
        Ok(dt) => dt,
        Err(_) => return truncate_str(timestamp, 16),
    };

    // Convert to local time for display
    let local: DateTime<Local> = parsed.into();
    local.format("%Y-%m-%d %H:%M").to_string()
}

/// Generates ANSI escape code for 24-bit true color foreground.
fn fg_color(color: (u8, u8, u8)) -> String {
    format!("\x1b[38;2;{};{};{}m", color.0, color.1, color.2)
}

/// Generates ANSI escape code for 24-bit true color background.
fn bg_color(color: (u8, u8, u8)) -> String {
    format!("\x1b[48;2;{};{};{}m", color.0, color.1, color.2)
}

/// ANSI reset code.
const RESET: &str = "\x1b[0m";

/// Bold ANSI code.
const BOLD: &str = "\x1b[1m";

/// Subtle dark background for selected items (very dark amber tint).
const BG_SELECTED: (u8, u8, u8) = (35, 28, 18);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_str() {
        assert_eq!(truncate_str("hello", 10), "hello");
        assert_eq!(truncate_str("hello", 5), "hello");
        assert_eq!(truncate_str("hello world", 8), "hello w…");
        assert_eq!(truncate_str("hello", 3), "he…");
        assert_eq!(truncate_str("abcdef", 4), "abc…");
        assert_eq!(truncate_str("a", 1), "a"); // single char, no truncation needed
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
