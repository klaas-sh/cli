//! Hook handling for agent event notifications.
//!
//! Agents like Claude Code and Gemini CLI can spawn hooks when events occur.
//! This module handles those hook invocations and sends notifications to the
//! klaas API.
//!
//! Environment variables used for session correlation:
//! - `KLAAS_SESSION_ID`: The session this hook belongs to
//! - `KLAAS_API_URL`: API base URL for sending notifications
//! - `KLAAS_HOOK_TOKEN`: Short-lived token for hook authentication

use std::env;
use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use tracing::{debug, error};

/// Environment variable for session ID.
pub const ENV_SESSION_ID: &str = "KLAAS_SESSION_ID";

/// Environment variable for API URL.
pub const ENV_API_URL: &str = "KLAAS_API_URL";

/// Environment variable for hook authentication token.
pub const ENV_HOOK_TOKEN: &str = "KLAAS_HOOK_TOKEN";

/// Hook event input from the agent.
#[derive(Debug, Deserialize)]
pub struct HookInput {
    /// Event type (e.g., "permission_request", "notification").
    #[serde(default)]
    pub event: Option<String>,

    /// Tool name (for tool-related hooks).
    #[serde(default)]
    pub tool: Option<String>,

    /// Message or description.
    #[serde(default)]
    pub message: Option<String>,

    /// Additional data from the agent.
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Hook response to the agent.
#[derive(Debug, Serialize)]
pub struct HookOutput {
    /// Decision for permission hooks: "allow", "deny", or "ask".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
}

impl Default for HookOutput {
    fn default() -> Self {
        Self {
            decision: Some("ask".to_string()),
        }
    }
}

/// Handles a hook event from an agent.
///
/// This is called when an agent spawns `klaas hook <event>`.
/// The hook reads JSON from stdin, processes the event, and outputs JSON
/// to stdout.
pub async fn handle_hook(event: &str) -> Result<(), String> {
    // Check if we're running inside a klaas session
    let session_id = env::var(ENV_SESSION_ID).map_err(|_| {
        "Error: This command must be called by an agent CLI running inside klaas.".to_string()
    })?;

    let api_url = env::var(ENV_API_URL).unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "http://localhost:8787".to_string()
        } else {
            "https://api.klaas.sh".to_string()
        }
    });

    let hook_token = env::var(ENV_HOOK_TOKEN).ok();

    debug!(
        event = %event,
        session_id = %session_id,
        "Handling hook event"
    );

    // Read input from stdin (non-blocking, with timeout)
    let input = read_stdin_json()?;

    debug!(input = ?input, "Received hook input");

    // Process the event
    let output = process_hook_event(event, &input, &session_id, &api_url, hook_token.as_deref())
        .await
        .unwrap_or_default();

    // Write output to stdout
    write_stdout_json(&output)?;

    Ok(())
}

/// Reads JSON input from stdin.
fn read_stdin_json() -> Result<HookInput, String> {
    let mut buffer = String::new();

    // Read all available input
    io::stdin()
        .read_to_string(&mut buffer)
        .map_err(|e| format!("Failed to read stdin: {}", e))?;

    if buffer.trim().is_empty() {
        // No input - return empty input
        return Ok(HookInput {
            event: None,
            tool: None,
            message: None,
            extra: serde_json::Value::Null,
        });
    }

    serde_json::from_str(&buffer).map_err(|e| format!("Failed to parse JSON input: {}", e))
}

/// Writes JSON output to stdout.
fn write_stdout_json(output: &HookOutput) -> Result<(), String> {
    let json = serde_json::to_string(output).map_err(|e| format!("Failed to serialize: {}", e))?;

    io::stdout()
        .write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write stdout: {}", e))?;

    io::stdout()
        .flush()
        .map_err(|e| format!("Failed to flush stdout: {}", e))?;

    Ok(())
}

/// Processes a hook event and sends notification to API.
async fn process_hook_event(
    event: &str,
    input: &HookInput,
    session_id: &str,
    api_url: &str,
    hook_token: Option<&str>,
) -> Result<HookOutput, String> {
    // Build notification payload
    let notification = NotificationPayload {
        session_id: session_id.to_string(),
        event: event.to_string(),
        tool: input.tool.clone(),
        message: input.message.clone(),
    };

    // Send notification to API (fire-and-forget, don't block the hook)
    if let Err(e) = send_notification(api_url, hook_token, &notification).await {
        error!(error = %e, "Failed to send hook notification");
        // Don't fail the hook - just log the error
    }

    // Return default response (ask user for permission)
    Ok(HookOutput::default())
}

/// Notification payload sent to the API.
#[derive(Debug, Serialize)]
struct NotificationPayload {
    session_id: String,
    event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// Sends a notification to the klaas API.
async fn send_notification(
    api_url: &str,
    hook_token: Option<&str>,
    payload: &NotificationPayload,
) -> Result<(), reqwest::Error> {
    let client = reqwest::Client::new();

    let url = format!("{}/v1/hooks/notification", api_url);

    let mut request = client.post(&url).json(payload);

    if let Some(token) = hook_token {
        request = request.bearer_auth(token);
    }

    let response = request.send().await?;

    debug!(
        status = %response.status(),
        "Sent notification to API"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hook_output_default() {
        let output = HookOutput::default();
        assert_eq!(output.decision, Some("ask".to_string()));
    }

    #[test]
    fn test_hook_output_serialize() {
        let output = HookOutput {
            decision: Some("allow".to_string()),
        };

        let json = serde_json::to_string(&output).unwrap();
        assert_eq!(json, r#"{"decision":"allow"}"#);
    }

    #[test]
    fn test_hook_input_parse() {
        let json = r#"{"tool": "Bash", "message": "Running npm test"}"#;
        let input: HookInput = serde_json::from_str(json).unwrap();

        assert_eq!(input.tool, Some("Bash".to_string()));
        assert_eq!(input.message, Some("Running npm test".to_string()));
    }

    #[test]
    fn test_hook_input_empty() {
        let json = r#"{}"#;
        let input: HookInput = serde_json::from_str(json).unwrap();

        assert_eq!(input.tool, None);
        assert_eq!(input.message, None);
    }
}
