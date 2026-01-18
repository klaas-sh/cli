//! Anonymous analytics tracking via Umami.
//!
//! Tracks install, upgrade, and uninstall events. No personal information
//! is collected - only the event type, klaas version, and platform (os/arch).
//! All tracking is fire-and-forget to avoid blocking the CLI.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tracing::debug;

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

/// Tracks an event to Umami analytics.
///
/// This is a fire-and-forget operation that spawns a background task.
/// It will not block or fail the main operation if tracking fails.
pub fn track(event: Event) {
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
/// such as during uninstall.
pub async fn track_and_wait(event: Event) {
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
        .timeout(Duration::from_secs(5))
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

/// Gets the path to the install marker file.
fn get_install_marker_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("klaas")
        .join(".installed")
}

/// Tracks install event if this is the first run.
///
/// Uses a marker file to detect first run. If the marker doesn't exist,
/// this is considered a new install and the event is tracked.
pub fn track_install_if_first_run() {
    let marker_path = get_install_marker_path();

    if marker_path.exists() {
        return;
    }

    // Create marker directory and file
    if let Some(parent) = marker_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&marker_path, VERSION);

    // Track install event
    track(Event::Install);
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
