//! Configuration constants and file loading for the CLI.
//!
//! This module provides default configuration values and functions to load
//! configuration from TOML files.
//!
//! Configuration sources (in order of precedence):
//! 1. Project-level config: `./.klaas/config.toml`
//! 2. User-level config: `~/.klaas/config.toml`
//! 3. Built-in defaults
//!
//! API URLs are set at compile time:
//! - Release builds: hardcoded to api.klaas.sh
//! - Debug builds: read from .env file if present, otherwise localhost:8787

use crate::agents::Agent;
use crate::types::InputConfig;
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use tracing::{debug, warn};

/// API base URL (set at compile time by build.rs).
pub const API_URL: &str = env!("KLAAS_API_URL");

/// WebSocket URL (set at compile time by build.rs).
pub const WS_URL: &str = env!("KLAAS_WS_URL");

/// Keychain service name for credential storage.
pub const KEYCHAIN_SERVICE: &str = "sh.klaas.cli";

/// OAuth device flow timeout in seconds (15 minutes).
pub const AUTH_TIMEOUT_SECS: u64 = 900;

/// Base delay for reconnection attempts in milliseconds.
pub const RECONNECT_BASE_DELAY_MS: u64 = 500;

/// Maximum delay between reconnection attempts in milliseconds.
pub const RECONNECT_MAX_DELAY_MS: u64 = 30_000;

/// Maximum number of reconnection attempts before giving up.
pub const RECONNECT_MAX_ATTEMPTS: u32 = 10;

/// Random jitter added to reconnection delays to prevent thundering herd.
pub const RECONNECT_JITTER_MS: u64 = 1000;

/// Maximum number of messages to queue during reconnection.
pub const MESSAGE_QUEUE_MAX_SIZE: usize = 100;

/// Maximum age of queued messages in seconds before they're dropped.
pub const MESSAGE_QUEUE_MAX_AGE_SECS: u64 = 300; // 5 minutes

/// Heartbeat interval in seconds.
pub const HEARTBEAT_INTERVAL_SECS: u64 = 30;

/// Session timeout on server side in seconds.
pub const SESSION_TIMEOUT_SECS: u64 = 30;

/// Default terminal width if detection fails.
pub const DEFAULT_TERMINAL_COLS: u16 = 80;

/// Default terminal height if detection fails.
pub const DEFAULT_TERMINAL_ROWS: u16 = 24;

/// Default agent command name (fallback if no config).
pub const DEFAULT_AGENT: &str = "claude";

/// Project-level config directory name.
pub const PROJECT_CONFIG_DIR: &str = ".klaas";

/// Config file name.
pub const CONFIG_FILE_NAME: &str = "config.toml";

/// TOML configuration file structure.
#[derive(Debug, Deserialize)]
pub struct KlaasConfig {
    /// Default agent to use when multiple are available.
    pub default_agent: Option<String>,

    /// Only show these agents (even if others are installed).
    /// Mutually exclusive with `also`.
    #[serde(default)]
    pub only: Vec<String>,

    /// Add these custom agents alongside built-in ones.
    /// Mutually exclusive with `only`.
    #[serde(default)]
    pub also: Vec<String>,

    /// Custom agent definitions.
    #[serde(default)]
    pub agents: HashMap<String, AgentConfig>,

    /// Notification settings.
    #[serde(default)]
    pub notifications: NotificationConfig,

    /// Session configuration.
    #[serde(default)]
    pub session: SessionConfig,

    /// Whether anonymous analytics are enabled.
    /// Tracks install/upgrade/uninstall events with version and platform info.
    /// No personal information is collected.
    #[serde(default = "default_analytics")]
    pub analytics: bool,
}

/// Default value for analytics (enabled).
fn default_analytics() -> bool {
    true
}

impl Default for KlaasConfig {
    fn default() -> Self {
        Self {
            default_agent: None,
            only: Vec::new(),
            also: Vec::new(),
            agents: HashMap::new(),
            notifications: NotificationConfig::default(),
            session: SessionConfig::default(),
            analytics: true,
        }
    }
}

/// Custom agent configuration from TOML.
#[derive(Debug, Clone, Deserialize)]
pub struct AgentConfig {
    /// Command to execute.
    pub command: String,
    /// Human-readable name.
    pub name: String,
    /// Alternative binary names to check for installation.
    #[serde(default)]
    pub detect: Vec<String>,
    /// Whether to run through shell.
    #[serde(default)]
    pub shell: bool,
    /// Default arguments.
    #[serde(default)]
    pub args: Vec<String>,
    /// Hooks type: "claude", "gemini", "codex", "none".
    #[serde(default)]
    pub hooks_type: Option<String>,
    /// Single-letter shortcut for interactive selection.
    #[serde(default)]
    pub shortcut: Option<char>,
}

impl From<AgentConfig> for Agent {
    fn from(config: AgentConfig) -> Self {
        use crate::agents::HooksType;

        let hooks_type = match config.hooks_type.as_deref() {
            Some("claude") => HooksType::Claude,
            Some("gemini") => HooksType::Gemini,
            Some("codex") => HooksType::Codex,
            _ => HooksType::None,
        };

        Agent {
            id: String::new(), // Will be set by registry
            name: config.name,
            command: config.command.clone(),
            detect: if config.detect.is_empty() {
                vec![config.command]
            } else {
                config.detect
            },
            hooks_type,
            shell: config.shell,
            args: config.args,
            description: String::new(),
            shortcut: config.shortcut,
        }
    }
}

/// Notification configuration.
#[derive(Debug, Default, Deserialize)]
pub struct NotificationConfig {
    /// Whether notifications are enabled.
    #[serde(default)]
    pub enabled: bool,

    /// Events to notify on.
    #[serde(default)]
    pub events: Vec<String>,
}

/// Session-related configuration.
#[derive(Debug, Default, Deserialize)]
pub struct SessionConfig {
    /// Input handling configuration for multi-connection.
    #[serde(default)]
    pub input: InputConfig,
}

/// Loads configuration from TOML files.
///
/// Checks project-level config first, then user-level config.
/// Project-level settings override user-level settings.
pub fn load_config() -> KlaasConfig {
    // Try project-level config first
    if let Some(config) = load_config_from_path(project_config_path()) {
        debug!("Loaded project-level config");
        return config;
    }

    // Try user-level config
    if let Some(config) = load_config_from_path(user_config_path()) {
        debug!("Loaded user-level config");
        return config;
    }

    debug!("No config file found, using defaults");
    KlaasConfig::default()
}

/// Loads config from a specific path.
fn load_config_from_path(path: Option<PathBuf>) -> Option<KlaasConfig> {
    let path = path?;

    if !path.exists() {
        return None;
    }

    debug!(path = %path.display(), "Reading config file");

    match fs::read_to_string(&path) {
        Ok(contents) => match toml::from_str(&contents) {
            Ok(config) => Some(config),
            Err(e) => {
                warn!(
                    path = %path.display(),
                    error = %e,
                    "Failed to parse config file"
                );
                None
            }
        },
        Err(e) => {
            warn!(
                path = %path.display(),
                error = %e,
                "Failed to read config file"
            );
            None
        }
    }
}

/// Returns the project-level config path (./.klaas/config.toml).
pub fn project_config_path() -> Option<PathBuf> {
    let cwd = env::current_dir().ok()?;
    let path = cwd.join(PROJECT_CONFIG_DIR).join(CONFIG_FILE_NAME);
    Some(path)
}

/// Returns the user-level config path (~/.klaas/config.toml).
pub fn user_config_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let path = home.join(PROJECT_CONFIG_DIR).join(CONFIG_FILE_NAME);
    Some(path)
}

/// API configuration with compile-time values.
#[derive(Debug, Clone)]
pub struct ApiConfig {
    /// API base URL.
    pub api_url: &'static str,
    /// WebSocket URL.
    pub ws_url: &'static str,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            api_url: API_URL,
            ws_url: WS_URL,
        }
    }
}

/// Get the API configuration.
pub fn get_api_config() -> ApiConfig {
    ApiConfig::default()
}

/// Get the input configuration from loaded config.
pub fn get_input_config() -> InputConfig {
    load_config().session.input
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_config_uses_compile_time_values() {
        let config = ApiConfig::default();
        assert_eq!(config.api_url, API_URL);
        assert_eq!(config.ws_url, WS_URL);
    }

    #[test]
    fn test_api_urls_are_valid() {
        // Verify the compile-time URLs are well-formed
        assert!(API_URL.starts_with("http://") || API_URL.starts_with("https://"));
        assert!(WS_URL.starts_with("ws://") || WS_URL.starts_with("wss://"));
    }

    #[test]
    fn test_parse_klaas_config() {
        let toml_str = r#"
            default_agent = "claude"
            only = ["claude", "gemini"]

            [agents.my-agent]
            command = "/path/to/agent"
            name = "My Agent"
            hooks_type = "claude"

            [notifications]
            enabled = true
            events = ["permission_request", "task_complete"]
        "#;

        let config: KlaasConfig = toml::from_str(toml_str).unwrap();

        assert_eq!(config.default_agent, Some("claude".to_string()));
        assert_eq!(config.only, vec!["claude", "gemini"]);
        assert!(config.agents.contains_key("my-agent"));

        let agent = &config.agents["my-agent"];
        assert_eq!(agent.command, "/path/to/agent");
        assert_eq!(agent.name, "My Agent");
        assert_eq!(agent.hooks_type, Some("claude".to_string()));

        assert!(config.notifications.enabled);
        assert_eq!(config.notifications.events.len(), 2);
    }

    #[test]
    fn test_empty_config() {
        let config: KlaasConfig = toml::from_str("").unwrap();

        assert_eq!(config.default_agent, None);
        assert!(config.only.is_empty());
        assert!(config.also.is_empty());
        assert!(config.agents.is_empty());
    }

    #[test]
    fn test_agent_config_conversion() {
        let agent_config = AgentConfig {
            command: "my-cli".to_string(),
            name: "My CLI".to_string(),
            detect: vec!["my-cli".to_string(), "mycli".to_string()],
            shell: false,
            args: vec!["--verbose".to_string()],
            hooks_type: Some("claude".to_string()),
            shortcut: Some('X'),
        };

        let agent: crate::agents::Agent = agent_config.into();

        assert_eq!(agent.name, "My CLI");
        assert_eq!(agent.command, "my-cli");
        assert_eq!(agent.detect.len(), 2);
        assert_eq!(agent.hooks_type, crate::agents::HooksType::Claude);
        assert_eq!(agent.shortcut, Some('X'));
    }

    #[test]
    fn test_session_config_defaults() {
        let config: KlaasConfig = toml::from_str("").unwrap();

        assert_eq!(config.session.input.mode, crate::types::InputMode::AutoLock);
        assert_eq!(config.session.input.idle_timeout_ms, 1500);
    }

    #[test]
    fn test_parse_session_input_config() {
        let toml_str = r#"
            [session.input]
            mode = "host-only"
            idle_timeout_ms = 2000
        "#;

        let config: KlaasConfig = toml::from_str(toml_str).unwrap();

        assert_eq!(config.session.input.mode, crate::types::InputMode::HostOnly);
        assert_eq!(config.session.input.idle_timeout_ms, 2000);
    }

    #[test]
    fn test_parse_session_input_config_partial() {
        // Only mode specified, idle_timeout_ms should use default
        let toml_str = r#"
            [session.input]
            mode = "free-for-all"
        "#;

        let config: KlaasConfig = toml::from_str(toml_str).unwrap();

        assert_eq!(
            config.session.input.mode,
            crate::types::InputMode::FreeForAll
        );
        assert_eq!(config.session.input.idle_timeout_ms, 1500);
    }

    #[test]
    fn test_parse_session_input_config_only_timeout() {
        // Only timeout specified, mode should use default
        let toml_str = r#"
            [session.input]
            idle_timeout_ms = 3000
        "#;

        let config: KlaasConfig = toml::from_str(toml_str).unwrap();

        assert_eq!(config.session.input.mode, crate::types::InputMode::AutoLock);
        assert_eq!(config.session.input.idle_timeout_ms, 3000);
    }
}
