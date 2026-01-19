//! Anonymous analytics tracking via Umami.
//!
//! Tracks install, upgrade, and uninstall events. No personal information
//! is collected - only the event type, klaas version, and platform (os/arch).
//! All tracking is fire-and-forget to avoid blocking the CLI.
//!
//! Analytics can be disabled via config.toml: `analytics = false`

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tracing::debug;

use crate::config::load_config;

/// Umami tracking endpoint.
const UMAMI_ENDPOINT: &str = "https://track.exquex.com/api/send";

/// Umami website ID for klaas.
const WEBSITE_ID: &str = "2bbb8bf5-b758-4eaa-8fba-98768788e03d";

/// Current version from Cargo.toml.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Event types that can be tracked.
#[derive(Debug, Clone, Copy)]
pub enum Event {
    /// First installation of klaas.
    Install,
    /// Upgrade to a new version.
    Upgrade,
    /// Uninstallation of klaas.
    Uninstall,
}

impl Event {
    /// Returns the event name for Umami.
    fn name(&self) -> &'static str {
        match self {
            Event::Install => "install",
            Event::Upgrade => "upgrade",
            Event::Uninstall => "uninstall",
        }
    }

    /// Returns the URL path for this event.
    fn url(&self) -> &'static str {
        match self {
            Event::Install => "/cli/install",
            Event::Upgrade => "/cli/upgrade",
            Event::Uninstall => "/cli/uninstall",
        }
    }
}

/// Umami event payload.
///
/// Only non-personal data is sent:
/// - hostname: always "klaas.sh" (product identifier)
/// - url: event path like "/cli/install"
/// - name: event name like "install"
/// - data: version and platform info
#[derive(Debug, Serialize)]
struct UmamiPayload {
    hostname: &'static str,
    language: &'static str,
    referrer: &'static str,
    screen: &'static str,
    title: &'static str,
    url: &'static str,
    website: &'static str,
    name: &'static str,
    data: EventData,
}

/// Additional event data (non-personal).
#[derive(Debug, Serialize)]
struct EventData {
    /// klaas version (e.g., "0.2.2").
    version: &'static str,
    /// Operating system (e.g., "macos", "linux", "windows").
    os: &'static str,
    /// CPU architecture (e.g., "x86_64", "aarch64").
    arch: &'static str,
}

/// Full Umami request body.
#[derive(Debug, Serialize)]
struct UmamiRequest {
    #[serde(rename = "type")]
    event_type: &'static str,
    payload: UmamiPayload,
}

/// Checks if analytics is enabled in the config.
fn is_enabled() -> bool {
    load_config().analytics
}

/// Tracks an event to Umami analytics.
///
/// This is a fire-and-forget operation that spawns a background task.
/// It will not block or fail the main operation if tracking fails.
/// Respects the `analytics` config setting.
pub fn track(event: Event) {
    if !is_enabled() {
        debug!("Analytics disabled, skipping event: {}", event.name());
        return;
    }

    // Spawn a background task so we don't block
    tokio::spawn(async move {
        if let Err(e) = send_event(event).await {
            debug!("Analytics tracking failed: {}", e);
        }
    });
}

/// Tracks an event and waits for completion.
///
/// Use this when you need to ensure the event is sent before exiting,
/// such as during uninstall. Respects the `analytics` config setting.
pub async fn track_and_wait(event: Event) {
    if !is_enabled() {
        debug!("Analytics disabled, skipping event: {}", event.name());
        return;
    }

    if let Err(e) = send_event(event).await {
        debug!("Analytics tracking failed: {}", e);
    }
}

/// Sends an event to Umami.
async fn send_event(event: Event) -> Result<(), String> {
    let request = UmamiRequest {
        event_type: "event",
        payload: UmamiPayload {
            hostname: "klaas.sh",
            language: "",
            referrer: "",
            screen: "0x0",
            title: "klaas CLI",
            url: event.url(),
            website: WEBSITE_ID,
            name: event.name(),
            data: EventData {
                version: VERSION,
                os: std::env::consts::OS,
                arch: std::env::consts::ARCH,
            },
        },
    };

    let client = reqwest::Client::builder()
        .user_agent(format!("klaas/{}", VERSION))
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .post(UMAMI_ENDPOINT)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to send event: {}", e))?;

    if response.status().is_success() {
        debug!("Tracked event: {}", event.name());
        Ok(())
    } else {
        Err(format!("Umami returned status: {}", response.status()))
    }
}

/// Gets the klaas data directory path, matching the install scripts.
///
/// The install scripts use these paths:
/// - Linux/macOS: `$XDG_DATA_HOME` or `~/.local/share`
/// - Windows: `%LOCALAPPDATA%`
///
/// This differs from `dirs::data_dir()` which returns platform-specific paths
/// like `~/Library/Application Support` on macOS.
fn get_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        // Windows: use LOCALAPPDATA (matches install.ps1 and install.cmd)
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")))
            .join("klaas")
    }

    #[cfg(not(windows))]
    {
        // Linux/macOS: use XDG_DATA_HOME or ~/.local/share (matches install.sh)
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".local")
                    .join("share")
            })
            .join("klaas")
    }
}

/// Gets the path to the install marker file.
/// This file is created by the install script and deleted after tracking.
fn get_install_marker_path() -> PathBuf {
    get_data_dir().join(".installed")
}

/// Spawns install tracking if the install marker exists.
///
/// The install script creates a marker file to signal a fresh install.
/// If the marker exists and analytics is enabled, spawns a background task
/// to send the install event. The marker is only deleted on successful (2xx)
/// response, so failed attempts will retry on the next run.
///
/// Returns a JoinHandle that can be awaited before process exit to ensure
/// the tracking completes. Returns None if no marker exists or analytics
/// is disabled.
///
/// # Example
///
/// ```ignore
/// // At startup, spawn the tracking task
/// let install_handle = analytics::spawn_install_tracking();
///
/// // Do other work (parse args, display version, etc.)
/// // ...
///
/// // Before exiting, wait for tracking to complete
/// if let Some(handle) = install_handle {
///     let _ = handle.await;
/// }
/// ```
pub fn spawn_install_tracking() -> Option<tokio::task::JoinHandle<()>> {
    let marker_path = get_install_marker_path();

    if !marker_path.exists() {
        return None;
    }

    if !is_enabled() {
        debug!("Analytics disabled, skipping install event");
        // Delete marker even if disabled, to avoid repeated checks
        let _ = std::fs::remove_file(&marker_path);
        return None;
    }

    // Spawn task that sends event and deletes marker only on success
    Some(tokio::spawn(async move {
        match send_event(Event::Install).await {
            Ok(()) => {
                // Only delete marker on successful tracking
                if let Err(e) = std::fs::remove_file(&marker_path) {
                    debug!("Failed to remove install marker: {}", e);
                }
            }
            Err(e) => {
                // Keep marker for retry on next run
                debug!("Install tracking failed, will retry: {}", e);
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_names() {
        assert_eq!(Event::Install.name(), "install");
        assert_eq!(Event::Upgrade.name(), "upgrade");
        assert_eq!(Event::Uninstall.name(), "uninstall");
    }

    #[test]
    fn test_event_urls() {
        assert_eq!(Event::Install.url(), "/cli/install");
        assert_eq!(Event::Upgrade.url(), "/cli/upgrade");
        assert_eq!(Event::Uninstall.url(), "/cli/uninstall");
    }
}
