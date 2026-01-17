# CLI Startup and Multi-Agent Support

This document covers Klaas CLI startup behavior, multi-agent support, and the
hooks/notification system for various AI coding agents.

## Table of Contents

1. [Overview](#overview)
2. [Agent CLI Landscape](#agent-cli-landscape)
3. [Supported Agents](#supported-agents)
4. [Agent Detection](#agent-detection)
5. [Command-Line Interface](#command-line-interface)
6. [Configuration](#configuration)
7. [Hooks Systems Comparison](#hooks-systems-comparison)
8. [Session Correlation](#session-correlation)
9. [Notification Architecture](#notification-architecture)
10. [Implementation Plan](#implementation-plan)

---

## Overview

Klaas is a "remote control" for agentic CLI tools. Rather than being tied to a
single agent (Claude Code), Klaas supports multiple AI coding assistants.

The core Klaas functionality (PTY wrapping, WebSocket streaming, E2EE) is
agent-agnostic. Supporting multiple agents requires:

1. Detecting which agents are installed
2. Allowing users to select an agent
3. Optionally integrating with agent-specific hooks for notifications

---

## Agent CLI Landscape

The AI coding assistant CLI ecosystem is growing rapidly. Here's a
comprehensive overview:

### Official AI Lab CLIs

| Agent | Command | Provider | Description |
|-------|---------|----------|-------------|
| Claude Code | `claude` | Anthropic | Full-featured coding agent |
| Gemini CLI | `gemini` | Google | Google's AI coding assistant |
| OpenAI Codex CLI | `codex` | OpenAI | OpenAI's coding agent |
| GitHub Copilot CLI | `gh copilot` | GitHub/Microsoft | Copilot in terminal |
| Mistral Vibe CLI | `vibe` | Mistral AI | Mistral's coding assistant |

### Mature Open-Source

| Agent | Command | Description |
|-------|---------|-------------|
| Aider | `aider` | AI pair programming, supports multiple models |
| OpenHands | `openhands` | Autonomous AI software engineer |
| Cline | `cline` | VS Code extension with CLI mode |
| Continue | `continue` | Open-source coding assistant |

### Emerging/Specialized

| Agent | Command | Description |
|-------|---------|-------------|
| Goose | `goose` | Block's autonomous coding agent |
| Open Interpreter | `interpreter` | Natural language to code |
| Plandex | `plandex` | AI coding engine for complex tasks |
| gptme | `gptme` | Personal AI assistant in terminal |
| Refact AI | `refact` | Self-hosted AI coding assistant |
| Tabby | `tabby` | Self-hosted AI coding assistant |

### Community/Utility

| Agent | Command | Description |
|-------|---------|-------------|
| Shell-GPT | `sgpt` | ChatGPT in the terminal |
| Fabric | `fabric` | AI-augmented automation |
| LLM CLI | `llm` | Simon Willison's CLI for LLMs |
| Microsoft AI Shell | `aish` | AI-powered shell |
| LocalAI / LocalAGI | `local-ai` | Local AI inference |

---

## Supported Agents

### Built-in Agent Definitions

Klaas ships with built-in support for popular agents:

| Agent | ID | Command | Hooks Support |
|-------|-----|---------|---------------|
| Claude Code | `claude` | `claude` | Full (native) |
| Gemini CLI | `gemini` | `gemini` | Experimental |
| Codex CLI | `codex` | `codex` | Via SDK |
| GitHub Copilot | `copilot` | `gh copilot` | None |
| Aider | `aider` | `aider` | None |
| Goose | `goose` | `goose` | None |
| Open Interpreter | `interpreter` | `interpreter` | None |

Users can add more via configuration (see [Configuration](#configuration)).

### Agent Detection Commands

```bash
# Check if agent is installed
which claude       # Claude Code
which gemini       # Gemini CLI
which codex        # OpenAI Codex
which aider        # Aider
which goose        # Goose
which interpreter  # Open Interpreter
```

---

## Agent Detection

### Detection Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         KLAAS STARTUP                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Load configuration files:                                        │
│     - ./.klaas/config.toml (project)                                │
│     - ~/.klaas/config.toml (user)                                   │
│                                                                      │
│  2. Check for --agent flag:                                          │
│     └─ If specified → use that agent                                │
│                                                                      │
│  3. Detect installed agents:                                         │
│     └─ Check PATH for known binaries                                │
│     └─ Check custom agents from config                              │
│                                                                      │
│  4. Filter by config (if "only" or "also" specified)                │
│                                                                      │
│  5. Select agent:                                                    │
│     └─ If 0 found  → error with installation instructions           │
│     └─ If 1 found  → use it automatically                           │
│     └─ If N found  → show interactive selection                     │
│                                                                      │
│  6. Spawn PTY with selected agent (with environment variables)       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Interactive Selection UI

When multiple agents are detected and no `--agent` flag provided:

```
  Select an agent to run:

  > [C] Claude Code
    [G] Gemini CLI
    [A] Aider

  Use arrow keys or press letter to select, Enter to confirm
```

- Arrow keys (↑/↓) navigate the list
- Letter shortcuts select directly (first letter of agent name)
- Enter confirms selection
- Esc cancels

---

## Command-Line Interface

### Agent Selection

```bash
# Explicit agent selection (long form)
klaas --agent claude
klaas --agent gemini
klaas --agent codex

# Short form
klaas -a claude
klaas -a gemini

# Convenience shortcuts
klaas --claude
klaas --gemini
klaas --codex
klaas --aider

# Auto-detect (interactive if multiple)
klaas
```

### Listing Available Agents

```bash
# List detected agents
klaas --list-agents

# Output:
#   Available agents:
#     claude  - Claude Code (installed)
#     gemini  - Gemini CLI (installed)
#     codex   - Codex CLI (not found)
#     aider   - Aider (installed)
```

### Passing Arguments to Agent

Arguments after `--` are passed directly to the selected agent:

```bash
# Pass arguments to Claude Code
klaas --claude -- --allowedTools "Bash(git*)"

# Pass arguments to Aider
klaas --aider -- --model sonnet --no-auto-commits
```

### Hook Subcommand

The same `klaas` binary handles hooks via subcommand:

```bash
# Called by agents as hooks (not by users directly)
klaas hook permission    # Handle permission request
klaas hook notification  # Handle notification
klaas hook stop          # Handle task completion
```

If run outside a Klaas session:

```
$ klaas hook permission
Error: This command must be called by an agent CLI running inside Klaas.
```

---

## Configuration

### Configuration File Locations

Klaas looks for configuration in these locations (in order of precedence):

1. `./.klaas/config.toml` (project-level)
2. `~/.klaas/config.toml` (user-level)

Project-level settings override user-level settings.

### Configuration Format

```toml
# ~/.klaas/config.toml

# Default agent when multiple are available
default_agent = "claude"

# Agent visibility: "only" shows ONLY these agents
# (even if others are installed)
only = ["claude", "gemini"]

# OR use "also" to ADD custom agents to the built-in list
# also = ["my-custom-agent"]

# Custom agent definitions
[agents.my-custom-agent]
command = "/path/to/my-agent"
name = "My Custom Agent"
detect = ["my-agent", "myagent"]  # Alternative binary names to check

[agents.local-llm]
command = "ollama run codellama"
name = "Local CodeLlama"
shell = true  # Run through shell (for complex commands)

# Notification settings
[notifications]
enabled = true
events = ["permission_request", "task_complete", "idle"]
```

### Agent Definition Schema

```toml
[agents.<id>]
command = "string"        # Required: command to execute
name = "string"           # Required: display name
detect = ["string"]       # Optional: binary names to check for installation
shell = false             # Optional: run through shell
args = ["string"]         # Optional: default arguments
hooks_type = "string"     # Optional: "claude", "gemini", "codex", "none"
```

### Example: Only Show Specific Agents

```toml
# .klaas/config.toml (in project root)

# Only show Claude and Gemini, even if Aider is installed
only = ["claude", "gemini"]
```

### Example: Add Custom Agent

```toml
# ~/.klaas/config.toml

# Add a custom agent alongside built-in ones
also = ["my-wrapper"]

[agents.my-wrapper]
command = "my-claude-wrapper"
name = "Claude (with custom prompts)"
hooks_type = "claude"  # Uses Claude Code hooks system
```

---

## Hooks Systems Comparison

Different AI coding agents have different approaches to extensibility.

### What Are Hooks?

A "hook" is a **shell command that the agent runs** when something happens.
It's not a separate daemon - it's spawned on-demand by the agent.

```
Agent detects event (e.g., permission needed)
    ↓
Agent spawns hook command: klaas hook permission
    ↓
Agent sends JSON to hook's stdin
    ↓
Hook processes event (e.g., sends notification)
    ↓
Hook writes JSON response to stdout
    ↓
Hook exits, agent reads response
```

### Claude Code Hooks

**Status**: Full native support
**Docs**: [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)

Claude Code has a comprehensive hooks system with the following events:

| Event | Description | Matchers |
|-------|-------------|----------|
| `PreToolUse` | Before a tool executes | Yes |
| `PostToolUse` | After a tool completes successfully | Yes |
| `PermissionRequest` | When permission dialog shown (v2.0.45+) | Yes |
| `Notification` | When Claude sends notifications | Yes |
| `UserPromptSubmit` | When user submits a prompt | No |
| `Stop` | When agent finishes responding | No |
| `SubagentStop` | When a subagent (Task) finishes | No |
| `SessionStart` | When session starts/resumes | No |
| `SessionEnd` | When session ends | No |
| `PreCompact` | Before memory compaction | No |

**Configuration** (in `~/.claude/settings.json` or `.claude/settings.json`):

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook permission"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt|idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook notification"
          }
        ]
      }
    ]
  }
}
```

**Input format**: Hooks receive JSON via stdin with event details.

**Output format**: Hooks can return JSON to control behavior:
- `{"decision": "allow"}` - Auto-approve permission
- `{"decision": "deny"}` - Auto-deny permission
- `{"decision": "ask"}` - Show normal prompt (default)

**No login required**: Hooks are local shell commands, no authentication needed.

---

### Gemini CLI Hooks

**Status**: Experimental (must be enabled)
**Docs**: [geminicli.com/docs/hooks](https://geminicli.com/docs/hooks)

Gemini CLI hooks mirror Claude Code's system (intentionally compatible):

| Event | Description |
|-------|-------------|
| `SessionStart` | Initialize session resources |
| `SessionEnd` | Cleanup on session end |
| `BeforeModel` | Modify prompts before sending |
| `AfterModel` | Process model outputs |
| `BeforeToolSelection` | Filter/prioritize tools |
| `Notification` | Handle notification events |

**Configuration** (in `~/.gemini/settings.json`):

```json
{
  "experimental": {
    "hooks": true
  },
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook notification"
          }
        ]
      }
    ]
  }
}
```

**Security**: Project-level hooks trigger a warning on first use. Extension
hooks require explicit user consent.

**No login required**: Local shell commands only.

---

### OpenAI Codex CLI

**Status**: Via SDK and execpolicy (no traditional hooks)
**Docs**: [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli/)

Codex doesn't have a traditional hooks system. Instead it uses:

1. **Approval Policy** (`--ask-for-approval`): Controls when to pause for
   human approval
2. **Sandbox Mode** (`--sandbox`): OS-level permission restrictions
3. **Execpolicy**: Rule files that allow/prompt/block commands
4. **SDK**: Programmatic control for CI/CD and custom tooling

**Approval modes**:
- `always` - Ask before every action
- `never` - Full autonomy (with sandbox)
- `unless-allow-listed` - Ask unless command matches allowlist

**SDK** ([developers.openai.com/codex/sdk](https://developers.openai.com/codex/sdk/)):

```python
from codex import Codex

agent = Codex()
agent.run("Fix the failing tests")
```

**For Klaas notifications**: Codex doesn't have hooks we can use. Basic PTY
support only (no permission notifications).

---

### Other Agents

Most other agents (Aider, Goose, Open Interpreter, etc.) don't have native
hooks systems. They work with Klaas via basic PTY wrapping:

- Terminal I/O is captured and streamed (with E2EE)
- No permission notifications (user must watch terminal)
- Full functionality for remote viewing and interaction

---

## Session Correlation

When hooks fire, the hook process needs to know which Klaas session it belongs
to. This is solved via **environment variables**.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│  Terminal                                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  $ klaas --claude                                                    │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  klaas (main process)                                          │  │
│  │                                                                │  │
│  │  session_id = "01ABC..."                                       │  │
│  │                                                                │  │
│  │  Spawns claude WITH environment variables:                     │  │
│  │    KLAAS_SESSION_ID=01ABC...                                   │  │
│  │    KLAAS_API_URL=https://api.klaas.sh                          │  │
│  │    KLAAS_HOOK_TOKEN=<session-scoped-token>                     │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │  claude (inherits environment)                           │  │  │
│  │  │                                                          │  │  │
│  │  │  Needs permission → spawns hook                          │  │  │
│  │  │                                                          │  │  │
│  │  │  ┌────────────────────────────────────────────────────┐  │  │  │
│  │  │  │  klaas hook permission (also inherits env!)        │  │  │  │
│  │  │  │                                                    │  │  │  │
│  │  │  │  Reads: KLAAS_SESSION_ID=01ABC...                  │  │  │  │
│  │  │  │  Knows exactly which session!                      │  │  │  │
│  │  │  │                                                    │  │  │  │
│  │  │  │  POST /api/notifications                           │  │  │  │
│  │  │  │  { session_id: "01ABC...", event: "permission" }   │  │  │  │
│  │  │  └────────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Process Tree & Environment Inheritance

```
klaas (PID 1000)
  ENV: KLAAS_SESSION_ID=01ABC...
  │
  └─► claude (PID 1001)
        ENV: KLAAS_SESSION_ID=01ABC...  ← inherited!
        │
        └─► klaas hook permission (PID 1002)
              ENV: KLAAS_SESSION_ID=01ABC...  ← still inherited!
```

Child processes automatically inherit environment variables from their parent.
This is standard Unix behavior.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `KLAAS_SESSION_ID` | ULID of the current session |
| `KLAAS_API_URL` | API base URL for notifications |
| `KLAAS_HOOK_TOKEN` | Short-lived token for hook auth |

### Multiple Sessions

Each terminal/klaas process has its own session ID in its environment:

```
Terminal 1: KLAAS_SESSION_ID=01ABC...
Terminal 2: KLAAS_SESSION_ID=01DEF...
Terminal 3: KLAAS_SESSION_ID=01GHI...
```

When a hook fires, it reads its own environment and knows exactly which
session triggered it.

---

## Notification Architecture

### Design Principles

1. **No screen scraping**: We do NOT parse terminal output (breaks E2EE)
2. **Hooks-based**: Use native agent hooks where available
3. **Single binary**: `klaas hook` subcommand, not a separate binary
4. **API-first**: CLI sends events to Klaas API, Dashboard receives via WebSocket
5. **User-configurable**: Users choose notification channels in Dashboard

### E2EE Preservation

The hook system preserves E2EE because:

- **Session content** (terminal I/O) flows through encrypted WebSocket
- **Notification metadata** (event type, tool name) goes through separate
  API endpoint
- The hook process doesn't see terminal content - only event metadata from
  the agent

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  klaas (main process)                                          │  │
│  │                                                                │  │
│  │  Terminal I/O (E2EE encrypted) ──────────────────────┐         │  │
│  │                                                      │         │  │
│  │  ┌──────────────────────────────────────────────┐    │         │  │
│  │  │  claude                                      │    │         │  │
│  │  │       │                                      │    │         │  │
│  │  │       │ Hook fires                           │    │         │  │
│  │  │       ▼                                      │    │         │  │
│  │  │  ┌────────────────────────────────────────┐  │    │         │  │
│  │  │  │  klaas hook permission                 │  │    │         │  │
│  │  │  │  (metadata only, not terminal content) │  │    │         │  │
│  │  │  └────────────────────────────────────────┘  │    │         │  │
│  │  └──────────────────────────────────────────────┘    │         │  │
│  └────────────────────────────────────────────────────────┘         │
│           │                                             │           │
│           │ POST (metadata)                             │ WebSocket │
│           │ { event: "permission", tool: "Bash" }       │ (E2EE)    │
│           ▼                                             ▼           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      KLAAS API                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│           │                                             │           │
│           ▼                                             ▼           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  DASHBOARD                                                   │   │
│  │                                                              │   │
│  │  [!] Permission requested: Bash     Terminal (decrypted)    │   │
│  │                                     ┌────────────────────┐   │   │
│  │                                     │ $ npm test         │   │   │
│  │                                     │ ...                │   │   │
│  │                                     └────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Notification Events

| Event | Source | Description |
|-------|--------|-------------|
| `permission_request` | PermissionRequest hook | Agent needs approval |
| `task_complete` | Stop hook | Agent finished task |
| `idle` | Notification hook | Agent waiting for input |
| `error` | Notification hook | Agent encountered error |
| `session_start` | SessionStart hook | New session started |

### User Settings (Dashboard)

```typescript
interface NotificationSettings {
  enabled: boolean;
  channels: {
    inApp: boolean;           // Always available
    browserPush: boolean;     // Requires permission
    telegram: {
      enabled: boolean;
      chatId: string;
    };
    webhook: {
      enabled: boolean;
      url: string;
      secret: string;         // For signature verification
    };
  };
  events: {
    permissionRequest: boolean;
    taskComplete: boolean;
    idle: boolean;
    error: boolean;
  };
}
```

---

## Implementation Plan

### Phase 1: Multi-Agent Support

1. Add agent detection logic to CLI
2. Implement `--agent` flag and shortcuts
3. Create interactive selection UI
4. Add configuration file support (`.klaas/config.toml`)
5. Support custom agent definitions

### Phase 2: Hooks Integration (Claude Code)

1. Add `klaas hook` subcommand
2. Implement environment variable injection when spawning agents
3. Add notification endpoint to API
4. Implement WebSocket notification broadcast
5. Add Dashboard notification UI
6. Document hook setup for users

### Phase 3: Extended Agent Support

1. Add Gemini CLI hooks support (same hook format)
2. Document limitations for agents without hooks

### Phase 4: Notification Channels

1. Browser push notifications
2. Telegram bot integration
3. Webhook support
4. User notification preferences in Dashboard

---

## Decisions Made

1. **Single binary**: Use `klaas hook <event>` subcommand, not separate binary
2. **Session correlation**: Via environment variables inherited by child processes
3. **Agent selection**: Auto-select if one installed, interactive menu if multiple
4. **No screen scraping**: Preserves E2EE, only use native hooks
5. **Graceful degradation**: Agents without hooks work (PTY only, no notifications)

---

## References

### Claude Code
- [Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Power User Guide](https://claude.com/blog/how-to-configure-hooks)
- [GitHub Issues](https://github.com/anthropics/claude-code/issues)

### Gemini CLI
- [Hooks Documentation](https://geminicli.com/docs/hooks/)
- [Configuration](https://geminicli.com/docs/get-started/configuration/)
- [GitHub Repository](https://github.com/google-gemini/gemini-cli)

### OpenAI Codex
- [CLI Features](https://developers.openai.com/codex/cli/features/)
- [Security Model](https://developers.openai.com/codex/security/)
- [SDK Documentation](https://developers.openai.com/codex/sdk/)

### Aider
- [Documentation](https://aider.chat/docs/)
- [GitHub Repository](https://github.com/Aider-AI/aider)

### AgentAPI (Third-Party)
- [GitHub Repository](https://github.com/coder/agentapi)
- [Agent Support Matrix](https://github.com/coder/agentapi/blob/main/AGENTS.md)

Note: AgentAPI is a third-party project that wraps multiple agent CLIs with
an HTTP API. Klaas uses a simpler PTY-based approach and doesn't depend on
AgentAPI.
