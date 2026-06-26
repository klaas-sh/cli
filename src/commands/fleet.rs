//! Fleet command - list and attach to the Maestro fleet.
//!
//! Maestro runs each of its processes inside a named klaas session. The
//! always-on orchestrator uses the session name `maestro-orchestrator`;
//! each project agent uses `maestro-agent-<visibleId>` (e.g.
//! `maestro-agent-PRO-1233`). klaas discovers the fleet by the shared
//! `maestro-` name prefix.
//!
//! This command authenticates, fetches sessions filtered by that prefix,
//! and renders an interactive list. The orchestrator sorts first; project
//! agents follow, ordered by their ticket visible id. Selecting a row
//! attaches to that session as a guest.

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

use super::connect;

/// Session-name prefix shared by every Maestro process.
const MAESTRO_PREFIX: &str = "maestro-";

/// Session name of the always-on orchestrator process.
const ORCHESTRATOR_NAME: &str = "maestro-orchestrator";

/// Name-prefix of a project-agent session, before the visible id.
const AGENT_PREFIX: &str = "maestro-agent-";

/// Runs the fleet command.
///
/// Authenticates, fetches the Maestro fleet, and shows an interactive
/// list. Selecting a row attaches to that session as a guest. Prints a
/// friendly message and returns when no Maestro sessions exist.
///
/// # Returns
///
/// * `Ok(())` on successful attach, cancellation, or an empty fleet
/// * `Err(...)` on authentication or API errors
pub async fn run() -> Result<()> {
    // Ensure the user is authenticated before hitting the API.
    let access_token = ensure_authenticated().await?;

    // Fetch the fleet, filtered by the maestro- prefix.
    let sessions = fetch_fleet(&access_token).await?;

    if sessions.is_empty() {
        println!();
        println!(
            "  {}No Maestro sessions found.{}",
            fg_color(colors::TEXT_MUTED),
            RESET
        );
        println!();
        return Ok(());
    }

    // Show the interactive fleet list and attach to the selection.
    match select_fleet_session(&sessions)? {
        Some(session_id) => connect::run_direct(&session_id, &access_token).await,
        None => Ok(()),
    }
}

/// Ensures the user is authenticated, triggering device flow if needed.
///
/// Returns the access token on success.
async fn ensure_authenticated() -> Result<String> {
    // Check for existing tokens.
    if let Some((access_token, _refresh_token)) = credentials::get_tokens()? {
        debug!("Using existing access token");
        return Ok(access_token);
    }

    // No tokens - need to authenticate.
    debug!("No tokens found, starting device flow");

    crate::ui::display_startup_banner();

    match auth::authenticate(API_URL).await {
        Ok(token_response) => {
            credentials::store_tokens(&token_response.access_token, &token_response.refresh_token)?;
            Ok(token_response.access_token)
        }
        Err(auth::AuthError::Cancelled) => Err(CliError::AuthError("Cancelled".to_string())),
        Err(auth::AuthError::Skipped) => Err(CliError::AuthError("Skipped".to_string())),
        Err(auth::AuthError::Billing(b)) => Err(CliError::Billing(b)),
        Err(e) => Err(CliError::AuthError(e.to_string())),
    }
}

/// Fetches the Maestro fleet from the API.
///
/// Calls the prefix-aware endpoint for efficiency, then defensively
/// filters client-side by the `maestro-` prefix so the result is correct
/// even against an older API that ignores the query parameter. The result
/// is sorted with the orchestrator first, then project agents by visible
/// id.
async fn fetch_fleet(access_token: &str) -> Result<Vec<Session>> {
    debug!("Fetching Maestro fleet from API");

    let client = ApiClient::new(API_URL, access_token);
    let mut sessions = client.get_sessions_with_prefix(MAESTRO_PREFIX).await?;

    // Defensive client-side filter (older APIs may ignore `prefix`).
    sessions.retain(|s| {
        s.name
            .as_deref()
            .map(|n| n.starts_with(MAESTRO_PREFIX))
            .unwrap_or(false)
    });

    sort_fleet(&mut sessions);

    Ok(sessions)
}

/// Sorts the fleet in display order.
///
/// The orchestrator (`maestro-orchestrator`) sorts first; project agents
/// follow, ordered by their ticket visible id. Sessions are matched by
/// name, so unnamed sessions sort last.
fn sort_fleet(sessions: &mut [Session]) {
    sessions.sort_by(|a, b| {
        let key_a = fleet_sort_key(a);
        let key_b = fleet_sort_key(b);
        key_a.cmp(&key_b)
    });
}

/// Builds the sort key for a fleet session.
///
/// Returns `(rank, label)` where `rank` is 0 for the orchestrator and 1
/// for everything else, and `label` is the visible id (or the raw name)
/// used to order project agents alphabetically.
fn fleet_sort_key(session: &Session) -> (u8, String) {
    let name = session.name.as_deref().unwrap_or("");
    if name == ORCHESTRATOR_NAME {
        (0, String::new())
    } else if let Some(visible_id) = parse_visible_id(name) {
        (1, visible_id)
    } else {
        (2, name.to_string())
    }
}

/// Extracts the ticket visible id from a Maestro agent session name.
///
/// Returns `Some("PRO-1233")` for `maestro-agent-PRO-1233`. Returns
/// `None` for the orchestrator (`maestro-orchestrator`) and for any name
/// that is not a `maestro-agent-` session. Parsing is lenient: the
/// remainder after the `maestro-agent-` prefix is returned as-is, as long
/// as it is non-empty.
pub fn parse_visible_id(session_name: &str) -> Option<String> {
    let rest = session_name.strip_prefix(AGENT_PREFIX)?;
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

/// Renders the fleet list interactively and returns the chosen session id.
///
/// Returns `Ok(Some(session_id))` when the user selects a row, or
/// `Ok(None)` when the user cancels (Escape or Ctrl+C).
fn select_fleet_session(sessions: &[Session]) -> Result<Option<String>> {
    use crossterm::{cursor, ExecutableCommand};

    if sessions.is_empty() {
        return Ok(None);
    }

    // Enter raw mode for keyboard input.
    if terminal::enable_raw_mode().is_err() {
        // Fall back to the first session if raw mode is unavailable.
        return Ok(Some(sessions[0].session_id.clone()));
    }

    let mut selected_index: usize = 0;
    let mut stdout = io::stdout();

    let _ = stdout.execute(cursor::Hide);
    let _ = stdout.execute(cursor::SavePosition);

    draw_fleet_menu(&mut stdout, sessions, selected_index, false);

    let result = loop {
        if let Ok(Event::Key(key_event)) = event::read() {
            match key_event.code {
                KeyCode::Up => {
                    if selected_index > 0 {
                        selected_index -= 1;
                    } else {
                        selected_index = sessions.len() - 1;
                    }
                    draw_fleet_menu(&mut stdout, sessions, selected_index, true);
                }
                KeyCode::Down => {
                    if selected_index < sessions.len() - 1 {
                        selected_index += 1;
                    } else {
                        selected_index = 0;
                    }
                    draw_fleet_menu(&mut stdout, sessions, selected_index, true);
                }
                KeyCode::Enter => {
                    break Some(sessions[selected_index].session_id.clone());
                }
                KeyCode::Esc => break None,
                KeyCode::Char(c)
                    if c == 'c' && key_event.modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    break None;
                }
                _ => {}
            }
        }
    };

    let _ = stdout.execute(cursor::Show);
    let _ = terminal::disable_raw_mode();
    clear_fleet_menu(&mut stdout);

    Ok(result)
}

/// Draws the interactive fleet menu.
fn draw_fleet_menu(
    stdout: &mut io::Stdout,
    sessions: &[Session],
    selected_index: usize,
    is_redraw: bool,
) {
    use crossterm::{cursor, terminal as ct, QueueableCommand};

    if is_redraw {
        let _ = stdout.queue(cursor::RestorePosition);
        let _ = stdout.queue(ct::Clear(ct::ClearType::FromCursorDown));
    }

    let _ = stdout.queue(cursor::MoveToColumn(0));

    // Header.
    print!(
        "  {}{}Maestro fleet{}\r\n\r\n",
        BOLD,
        fg_color(colors::AMBER),
        RESET
    );

    let box_width = 72;

    let top_border_color = if selected_index == 0 {
        colors::AMBER
    } else {
        colors::TEXT_DIM
    };
    print!(
        "  {}{}{}\r\n",
        fg_color(top_border_color),
        top_border(box_width),
        RESET
    );

    for (idx, session) in sessions.iter().enumerate() {
        let is_selected = idx == selected_index;
        draw_fleet_row(session, is_selected);

        if idx < sessions.len() - 1 {
            let divider_color = if idx == selected_index || idx + 1 == selected_index {
                colors::AMBER
            } else {
                colors::TEXT_DIM
            };
            print!(
                "  {}{}{}\r\n",
                fg_color(divider_color),
                middle_border(box_width),
                RESET
            );
        }
    }

    let bottom_border_color = if selected_index == sessions.len() - 1 {
        colors::AMBER
    } else {
        colors::TEXT_DIM
    };
    print!(
        "  {}{}{}\r\n\r\n",
        fg_color(bottom_border_color),
        bottom_border(box_width),
        RESET
    );

    print!(
        "  {}Use \u{2191}\u{2193} arrows and Enter. Esc to cancel.{}\r\n",
        fg_color(colors::TEXT_MUTED),
        RESET
    );

    let _ = stdout.flush();
}

/// Draws a single fleet row (2 lines).
///
/// Box width: 72 chars.
/// Line 1: ` ● label` (3+30) + fill + `runtime` + ` ` = 72
/// Line 2: `   name` (3+...) + fill + `status` (10) + ` ` = 72
fn draw_fleet_row(session: &Session, is_selected: bool) {
    let is_attached = session.status == "attached";

    let border_color = if is_selected {
        colors::AMBER
    } else {
        colors::TEXT_DIM
    };

    let bg = if is_selected {
        bg_color(BG_SELECTED)
    } else {
        String::new()
    };

    let status_indicator = if is_attached {
        format!("{}{}●{}", BOLD, fg_color(colors::GREEN), RESET)
    } else {
        " ".to_string()
    };

    let name = session.name.as_deref().unwrap_or("");

    // Row label: "orchestrator" or the ticket visible id.
    let label = if name == ORCHESTRATOR_NAME {
        "orchestrator".to_string()
    } else {
        parse_visible_id(name).unwrap_or_else(|| name.to_string())
    };

    // Runtime: relative time since the session started.
    let runtime = format_relative_time(&session.started_at);

    // === Line 1: indicator + label ... runtime ===
    // Layout: ` ● ` (3) + label (30) + fill + runtime + ` ` (1) = 72
    let label_display = truncate_str(&label, 30);
    let runtime_display = truncate_str(&runtime, 24);
    let runtime_len = runtime_display.chars().count();
    let fill_1 = 72 - 3 - 30 - runtime_len - 1;

    print!("  {}│{}{}", fg_color(border_color), RESET, bg);
    print!(" {} ", status_indicator); // 3 chars

    let label_color = if is_selected {
        colors::AMBER
    } else {
        colors::TEXT_PRIMARY
    };
    print!(
        "{}{:<30}{}{}",
        fg_color(label_color),
        label_display,
        RESET,
        bg
    );

    print!(
        "{:>width$}{}{} {}{}│{}\r\n",
        "",
        fg_color(colors::TEXT_MUTED),
        runtime_display,
        RESET,
        fg_color(border_color),
        RESET,
        width = fill_1
    );

    // === Line 2: session name ... status ===
    // Layout: `   ` (3) + name (max 50) + fill + status (10) + ` ` (1) = 72
    let name_display = truncate_str(name, 50);
    let name_len = name_display.chars().count();
    let status_text = if is_attached { "attached" } else { "detached" };
    let status_len = status_text.chars().count();
    let fill_2 = 72 - 3 - name_len - status_len - 1;

    print!("  {}│{}{}", fg_color(border_color), RESET, bg);
    print!("   "); // 3 chars padding

    print!(
        "{}{:<width$}{}{}",
        fg_color(colors::TEXT_DIM),
        name_display,
        RESET,
        bg,
        width = name_len
    );

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
        width = fill_2
    );
}

/// Clears the fleet menu from the terminal.
fn clear_fleet_menu(stdout: &mut io::Stdout) {
    use crossterm::{cursor, terminal as ct, QueueableCommand};

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

    /// Builds a minimal `Session` with the given name for tests.
    fn session_named(name: &str) -> Session {
        let json = format!(
            r#"{{
                "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
                "device_id": "01HQXK8V8G3N5M2R4P6T1W9Y0A",
                "device_name": "Mac mini",
                "name": "{}",
                "status": "attached",
                "started_at": "2024-01-15T10:30:00Z",
                "attached_at": null,
                "cwd": "/Users/bjorn/projects"
            }}"#,
            name
        );
        serde_json::from_str(&json).unwrap()
    }

    #[test]
    fn test_parse_visible_id_agent() {
        assert_eq!(
            parse_visible_id("maestro-agent-PRO-1233"),
            Some("PRO-1233".to_string())
        );
        assert_eq!(
            parse_visible_id("maestro-agent-ABC-7"),
            Some("ABC-7".to_string())
        );
    }

    #[test]
    fn test_parse_visible_id_orchestrator_is_none() {
        assert_eq!(parse_visible_id("maestro-orchestrator"), None);
    }

    #[test]
    fn test_parse_visible_id_non_maestro_is_none() {
        assert_eq!(parse_visible_id("my-session"), None);
        assert_eq!(parse_visible_id("maestro-"), None);
        // Bare agent prefix with no visible id is not a valid agent name.
        assert_eq!(parse_visible_id("maestro-agent-"), None);
    }

    #[test]
    fn test_sort_fleet_orchestrator_first() {
        let mut sessions = vec![
            session_named("maestro-agent-PRO-1233"),
            session_named("maestro-orchestrator"),
            session_named("maestro-agent-ABC-7"),
        ];
        sort_fleet(&mut sessions);

        let names: Vec<&str> = sessions
            .iter()
            .map(|s| s.name.as_deref().unwrap_or(""))
            .collect();
        assert_eq!(
            names,
            vec![
                "maestro-orchestrator",
                "maestro-agent-ABC-7",
                "maestro-agent-PRO-1233",
            ]
        );
    }
}
