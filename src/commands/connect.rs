//! Connect command - connect to a session as a guest.
//!
//! Connects to an existing session by ID or name. If no argument is provided,
//! shows the interactive session list for selection.

use tracing::debug;

use crate::api_client::ApiClient;
use crate::config::API_URL;
use crate::error::{CliError, Result};
use crate::guest;
use crate::ui::colors;

use super::sessions;

/// Runs the connect command.
///
/// Connects to an existing session as a guest.
///
/// # Arguments
///
/// * `target` - Optional session ID or name. If None, shows interactive list.
///
/// # Returns
///
/// * `Ok(())` on successful connection (or cancellation)
/// * `Err(...)` on authentication, network, or lookup errors
pub async fn run(target: Option<String>) -> Result<()> {
    let session_id = match target {
        Some(identifier) => {
            // User provided a target - look it up
            lookup_session(&identifier).await?
        }
        None => {
            // No target - show interactive session list
            match sessions::run().await? {
                sessions::SessionsResult::Selected(id) => id,
                sessions::SessionsResult::StartNew | sessions::SessionsResult::Cancelled => {
                    // User cancelled or wants to start new (not applicable here)
                    return Ok(());
                }
            }
        }
    };

    // Connect to the session
    connect_to_session(&session_id).await
}

/// Connects directly to a session without lookup or authentication.
///
/// Use this when the session_id is already validated (e.g., from interactive
/// session list) and authentication is already complete.
///
/// # Arguments
///
/// * `session_id` - Valid session ID (ULID)
///
/// # Returns
///
/// * `Ok(())` on successful connection
/// * `Err(...)` on connection errors
pub async fn run_direct(session_id: &str) -> Result<()> {
    connect_to_session(session_id).await
}

/// Internal function to connect to a session as guest.
///
/// Displays connecting message and handles connection result.
async fn connect_to_session(session_id: &str) -> Result<()> {
    debug!("Connecting to session: {}", session_id);

    // Display connecting message
    println!();
    println!(
        "  {}Connecting to session {}{}{}...{}",
        fg_color(colors::TEXT_SECONDARY),
        fg_color(colors::AMBER),
        session_id,
        fg_color(colors::TEXT_SECONDARY),
        reset()
    );

    // Connect as guest using the guest module
    match guest::run(session_id).await {
        Ok(()) => {
            println!();
            println!(
                "  {}Disconnected from session.{}",
                fg_color(colors::TEXT_MUTED),
                reset()
            );
            println!();
            Ok(())
        }
        Err(e) => {
            println!();
            println!(
                "  {}{}!{} Failed to connect: {}{}",
                BOLD,
                fg_color(colors::AMBER),
                reset(),
                e,
                reset()
            );
            println!();
            Err(e)
        }
    }
}

/// Looks up a session by ID or name.
///
/// If the identifier matches ULID format (26 uppercase alphanumeric chars),
/// looks up by ID directly. Otherwise, looks up by name.
async fn lookup_session(identifier: &str) -> Result<String> {
    // Ensure authenticated
    let access_token = ensure_authenticated().await?;

    // Create API client
    let client = ApiClient::new(API_URL, &access_token);

    // Check if it's a valid ULID (both ULID and name use the same endpoint)
    if is_valid_ulid(identifier) {
        debug!("Looking up session by ID: {}", identifier);
    } else {
        debug!("Looking up session by name: {}", identifier);
    }

    // Use the get_session method which handles both ID and name
    match client.get_session(identifier).await? {
        Some(session) => Ok(session.session_id),
        None => {
            display_not_found_error(identifier);
            Err(CliError::Other("Session not found".to_string()))
        }
    }
}

/// Checks if a string is a valid ULID (26 uppercase alphanumeric characters).
fn is_valid_ulid(s: &str) -> bool {
    s.len() == 26
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// Displays a "session not found" error with helpful suggestions.
fn display_not_found_error(identifier: &str) {
    println!();
    println!(
        "  {}{}!{} Session not found: {}{}{}",
        BOLD,
        fg_color(colors::AMBER),
        reset(),
        fg_color(colors::TEXT_PRIMARY),
        identifier,
        reset()
    );
    println!();
    println!(
        "  {}Run {}klaas sessions{} to see available sessions.{}",
        fg_color(colors::TEXT_SECONDARY),
        fg_color(colors::AMBER),
        fg_color(colors::TEXT_SECONDARY),
        reset()
    );
    println!();
}

/// Ensures the user is authenticated, triggering device flow if needed.
async fn ensure_authenticated() -> Result<String> {
    use crate::auth;
    use crate::credentials;

    // Check for existing tokens
    if let Some((access_token, _refresh_token)) = credentials::get_tokens()? {
        debug!("Using existing access token");
        return Ok(access_token);
    }

    // No tokens - need to authenticate
    debug!("No tokens found, starting device flow");

    // Display startup banner for auth
    crate::ui::display_startup_banner();

    match auth::authenticate(API_URL).await {
        Ok(token_response) => {
            credentials::store_tokens(&token_response.access_token, &token_response.refresh_token)?;
            Ok(token_response.access_token)
        }
        Err(auth::AuthError::Cancelled) => Err(CliError::AuthError("Cancelled".to_string())),
        Err(auth::AuthError::Skipped) => Err(CliError::AuthError("Skipped".to_string())),
        Err(e) => Err(CliError::AuthError(e.to_string())),
    }
}

/// Generates ANSI escape code for 24-bit true color foreground.
fn fg_color(color: (u8, u8, u8)) -> String {
    format!("\x1b[38;2;{};{};{}m", color.0, color.1, color.2)
}

/// ANSI reset code.
fn reset() -> &'static str {
    "\x1b[0m"
}

/// Bold ANSI code.
const BOLD: &str = "\x1b[1m";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_ulid() {
        // Valid ULIDs
        assert!(is_valid_ulid("01HQXK7V8G3N5M2R4P6T1W9Y0Z"));
        assert!(is_valid_ulid("01ARZ3NDEKTSV4RRFFQ69G5FAV"));

        // Invalid: lowercase
        assert!(!is_valid_ulid("01hqxk7v8g3n5m2r4p6t1w9y0z"));

        // Invalid: too short
        assert!(!is_valid_ulid("01HQXK7V8G3N5M2R4P6T1W9Y0"));

        // Invalid: too long
        assert!(!is_valid_ulid("01HQXK7V8G3N5M2R4P6T1W9Y0ZZ"));

        // Invalid: contains invalid characters
        assert!(!is_valid_ulid("01HQXK7V8G3N5M2R4P6T1W9Y-Z"));

        // Invalid: session name
        assert!(!is_valid_ulid("refactor-tests"));
        assert!(!is_valid_ulid("api_v2"));
    }
}
