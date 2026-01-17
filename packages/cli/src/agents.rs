//! Agent definitions and detection for multi-agent support.
//!
//! Klaas supports multiple AI coding agents. This module provides:
//! - Built-in agent definitions (Claude Code, Gemini CLI, Codex, etc.)
//! - Agent detection (checking PATH for installed agents)
//! - Custom agent definitions from configuration files
//! - Hooks system type information

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use tracing::debug;

/// Type of hooks system the agent supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HooksType {
    /// Claude Code native hooks system.
    Claude,
    /// Gemini CLI hooks (mirrors Claude Code format).
    Gemini,
    /// OpenAI Codex SDK-based hooks.
    Codex,
    /// No hooks support.
    #[default]
    None,
}

/// Agent definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    /// Unique identifier for the agent (e.g., "claude", "gemini").
    pub id: String,
    /// Human-readable name (e.g., "Claude Code").
    pub name: String,
    /// Command to execute (e.g., "claude", "gh copilot").
    pub command: String,
    /// Alternative binary names to check for detection.
    #[serde(default)]
    pub detect: Vec<String>,
    /// Type of hooks system supported.
    #[serde(default)]
    pub hooks_type: HooksType,
    /// Whether to run through shell (for complex commands).
    #[serde(default)]
    pub shell: bool,
    /// Default arguments to pass to the agent.
    #[serde(default)]
    pub args: Vec<String>,
    /// Description of the agent.
    #[serde(default)]
    pub description: String,
    /// Single-letter shortcut for interactive selection.
    #[serde(default)]
    pub shortcut: Option<char>,
}

impl Agent {
    /// Creates a new agent definition.
    pub fn new(id: &str, name: &str, command: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            command: command.to_string(),
            detect: vec![command.to_string()],
            hooks_type: HooksType::None,
            shell: false,
            args: Vec::new(),
            description: String::new(),
            shortcut: None,
        }
    }

    /// Sets the hooks type for this agent.
    #[must_use]
    pub fn with_hooks(mut self, hooks_type: HooksType) -> Self {
        self.hooks_type = hooks_type;
        self
    }

    /// Sets alternative detection binaries.
    #[must_use]
    pub fn with_detect(mut self, detect: Vec<&str>) -> Self {
        self.detect = detect.iter().map(|s| s.to_string()).collect();
        self
    }

    /// Sets the description.
    #[must_use]
    pub fn with_description(mut self, description: &str) -> Self {
        self.description = description.to_string();
        self
    }

    /// Sets shell execution mode.
    #[must_use]
    pub fn with_shell(mut self) -> Self {
        self.shell = true;
        self
    }

    /// Sets the single-letter shortcut.
    #[must_use]
    pub fn with_shortcut(mut self, shortcut: char) -> Self {
        self.shortcut = Some(shortcut);
        self
    }

    /// Checks if this agent is installed by looking for its binary in PATH.
    pub fn is_installed(&self) -> bool {
        // Check the main command first
        if is_binary_in_path(&self.command) {
            return true;
        }
        // Check alternative binary names
        self.detect.iter().any(|bin| is_binary_in_path(bin))
    }

    /// Returns the shortcut key for this agent.
    /// Uses the explicit shortcut if set, otherwise defaults to first letter.
    pub fn shortcut_key(&self) -> char {
        self.shortcut
            .unwrap_or_else(|| self.id.chars().next().unwrap_or('?'))
            .to_ascii_uppercase()
    }

    /// Returns true if this agent supports hooks for notifications.
    pub fn supports_hooks(&self) -> bool {
        !matches!(self.hooks_type, HooksType::None)
    }
}

/// Checks if a binary exists in PATH.
fn is_binary_in_path(binary: &str) -> bool {
    // Handle commands with spaces (like "gh copilot")
    let primary = binary.split_whitespace().next().unwrap_or(binary);

    let result = Command::new("which").arg(primary).output();

    match result {
        Ok(output) => {
            let found = output.status.success();
            debug!(binary = %primary, found = found, "Checking for binary in PATH");
            found
        }
        Err(_) => false,
    }
}

/// Returns the built-in agent definitions.
///
/// Primary agents (with shortcuts for interactive selection):
/// - [A] Claude Code (Anthropic)
/// - [G] Gemini CLI (Google)
/// - [O] Codex CLI (OpenAI)
/// - [C] GitHub Copilot CLI
/// - [M] Mistral Vibe CLI
pub fn builtin_agents() -> Vec<Agent> {
    vec![
        // Primary agents (Official AI Lab CLIs)
        Agent::new("claude", "Claude Code", "claude")
            .with_hooks(HooksType::Claude)
            .with_shortcut('A')
            .with_description("Anthropic's full-featured coding agent"),
        Agent::new("gemini", "Gemini CLI", "gemini")
            .with_hooks(HooksType::Gemini)
            .with_shortcut('G')
            .with_description("Google's AI coding assistant"),
        Agent::new("codex", "Codex CLI", "codex")
            .with_hooks(HooksType::Codex)
            .with_shortcut('O')
            .with_description("OpenAI's coding agent"),
        Agent::new("copilot", "GitHub Copilot", "gh")
            .with_detect(vec!["gh"])
            .with_shortcut('C')
            .with_description("GitHub Copilot in terminal (gh copilot)"),
        Agent::new("vibe", "Mistral Vibe", "vibe")
            .with_shortcut('M')
            .with_description("Mistral AI's coding assistant"),
        // Additional supported agents (no shortcuts, lower priority)
        Agent::new("aider", "Aider", "aider")
            .with_description("AI pair programming, supports multiple models"),
        Agent::new("goose", "Goose", "goose").with_description("Block's autonomous coding agent"),
        Agent::new("interpreter", "Open Interpreter", "interpreter")
            .with_description("Natural language to code"),
    ]
}

/// Agent registry for detection and lookup.
pub struct AgentRegistry {
    /// All known agents (built-in + custom).
    agents: HashMap<String, Agent>,
    /// Order of agents for display.
    order: Vec<String>,
}

impl AgentRegistry {
    /// Creates a new registry with built-in agents.
    pub fn new() -> Self {
        let builtin = builtin_agents();
        let order: Vec<String> = builtin.iter().map(|a| a.id.clone()).collect();
        let agents: HashMap<String, Agent> =
            builtin.into_iter().map(|a| (a.id.clone(), a)).collect();

        Self { agents, order }
    }

    /// Adds custom agents from configuration.
    pub fn add_custom(&mut self, custom: HashMap<String, Agent>) {
        for (id, mut agent) in custom {
            agent.id = id.clone();
            if !self.order.contains(&id) {
                self.order.push(id.clone());
            }
            self.agents.insert(id, agent);
        }
    }

    /// Gets an agent by ID.
    pub fn get(&self, id: &str) -> Option<&Agent> {
        self.agents.get(id)
    }

    /// Returns all agents in display order.
    pub fn all(&self) -> Vec<&Agent> {
        self.order
            .iter()
            .filter_map(|id| self.agents.get(id))
            .collect()
    }

    /// Returns agents filtered by "only" list.
    /// If only is empty, returns all agents.
    pub fn filter_only(&self, only: &[String]) -> Vec<&Agent> {
        if only.is_empty() {
            return self.all();
        }
        only.iter().filter_map(|id| self.agents.get(id)).collect()
    }

    /// Returns agents with additional agents added.
    pub fn filter_also(&self, also: &[String]) -> Vec<&Agent> {
        let mut result = self.all();
        for id in also {
            if let Some(agent) = self.agents.get(id) {
                if !result.iter().any(|a| a.id == *id) {
                    result.push(agent);
                }
            }
        }
        result
    }

    /// Detects which agents are installed.
    pub fn detect_installed(&self) -> Vec<&Agent> {
        self.all()
            .into_iter()
            .filter(|a| a.is_installed())
            .collect()
    }

    /// Detects installed agents from a filtered list.
    pub fn detect_installed_from<'a>(&self, agents: &[&'a Agent]) -> Vec<&'a Agent> {
        agents
            .iter()
            .filter(|a| a.is_installed())
            .copied()
            .collect()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Agent selection result.
#[derive(Debug, Clone)]
pub enum AgentSelection {
    /// Agent was selected (either auto or by user).
    Selected(Agent),
    /// User cancelled selection.
    Cancelled,
    /// No agents installed.
    NoneInstalled,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_agents() {
        let agents = builtin_agents();
        assert!(!agents.is_empty());

        // Claude should be first
        assert_eq!(agents[0].id, "claude");
        assert_eq!(agents[0].hooks_type, HooksType::Claude);
        assert_eq!(agents[0].shortcut, Some('A'));
    }

    #[test]
    fn test_primary_agents() {
        let agents = builtin_agents();

        // Check all primary agents have shortcuts
        let claude = agents.iter().find(|a| a.id == "claude").unwrap();
        assert_eq!(claude.shortcut_key(), 'A');

        let gemini = agents.iter().find(|a| a.id == "gemini").unwrap();
        assert_eq!(gemini.shortcut_key(), 'G');

        let codex = agents.iter().find(|a| a.id == "codex").unwrap();
        assert_eq!(codex.shortcut_key(), 'O');

        let copilot = agents.iter().find(|a| a.id == "copilot").unwrap();
        assert_eq!(copilot.shortcut_key(), 'C');

        let vibe = agents.iter().find(|a| a.id == "vibe").unwrap();
        assert_eq!(vibe.shortcut_key(), 'M');
    }

    #[test]
    fn test_agent_registry() {
        let registry = AgentRegistry::new();

        // Should have built-in agents
        assert!(registry.get("claude").is_some());
        assert!(registry.get("gemini").is_some());

        // Should return all in order
        let all = registry.all();
        assert!(!all.is_empty());
        assert_eq!(all[0].id, "claude");
    }

    #[test]
    fn test_filter_only() {
        let registry = AgentRegistry::new();

        let only = vec!["claude".to_string(), "gemini".to_string()];
        let filtered = registry.filter_only(&only);

        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().any(|a| a.id == "claude"));
        assert!(filtered.iter().any(|a| a.id == "gemini"));
    }

    #[test]
    fn test_shortcut_key_with_explicit() {
        let agent = Agent::new("claude", "Claude Code", "claude").with_shortcut('A');
        assert_eq!(agent.shortcut_key(), 'A');
    }

    #[test]
    fn test_shortcut_key_default() {
        let agent = Agent::new("aider", "Aider", "aider");
        assert_eq!(agent.shortcut_key(), 'A'); // First letter of "aider"
    }

    #[test]
    fn test_supports_hooks() {
        let claude = Agent::new("claude", "Claude Code", "claude").with_hooks(HooksType::Claude);
        assert!(claude.supports_hooks());

        let aider = Agent::new("aider", "Aider", "aider");
        assert!(!aider.supports_hooks());
    }

    #[test]
    fn test_is_binary_in_path() {
        // 'echo' should be present on all Unix systems
        assert!(is_binary_in_path("echo"));
        // Random garbage should not exist
        assert!(!is_binary_in_path("xyznonexistent123"));
    }
}
