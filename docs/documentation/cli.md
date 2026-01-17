# Klaas CLI

Klaas is a remote access wrapper for AI coding agents. It wraps your terminal
session with any supported AI agent and streams it securely to the Klaas
Dashboard for remote viewing and interaction.

## Installation

```bash
# macOS (Apple Silicon)
curl -fsSL https://klaas.sh/install.sh | sh

# Or download directly
curl -LO https://github.com/klaas-sh/cli/releases/latest/download/klaas-darwin-arm64
chmod +x klaas-darwin-arm64
mv klaas-darwin-arm64 /usr/local/bin/klaas
```

## Supported Agents

Klaas supports multiple AI coding agents:

| Agent | Command | Shortcut | Hooks |
|-------|---------|----------|-------|
| [Claude Code](https://code.claude.com/) | `klaas --claude` | `[A]` | Yes |
| [Gemini CLI](https://geminicli.com/) | `klaas --gemini` | `[G]` | Yes |
| [Codex CLI](https://developers.openai.com/codex/cli/) | `klaas --codex` | `[O]` | SDK |
| [Copilot CLI](https://github.com/features/copilot/cli) | `klaas --copilot` | `[C]` | No |
| [Vibe CLI](https://mistral.ai/news/devstral-2-vibe-cli) | `klaas --vibe` | `[M]` | No |

**Hooks** enable permission notifications. When an agent requests permission
to run a command or edit a file, Klaas can send you a notification via the
Dashboard, Telegram, or other channels.

## Quick Start

```bash
# Auto-detect installed agent (interactive if multiple)
klaas

# Run with specific agent
klaas --claude
klaas --gemini
klaas -a codex

# Pass arguments to the agent
klaas --claude -- --model sonnet --allowedTools "Bash(git*)"

# List available agents
klaas --list-agents
```

## Command-Line Options

```
klaas [OPTIONS] [-- AGENT_ARGS...]

Options:
  -a, --agent <AGENT>   Select which agent to run
      --claude          Use Claude Code agent
      --gemini          Use Gemini CLI agent
      --codex           Use OpenAI Codex CLI agent
      --aider           Use Aider agent
      --list-agents     List available agents and exit
      --new-session     Start a new session (don't resume previous)
  -h, --help            Print help
  -V, --version         Print version

Subcommands:
  update                Update klaas to the latest version
  hook <EVENT>          Handle hook events (internal use)
```

## Agent Selection

When you run `klaas` without specifying an agent:

1. **One agent installed**: Klaas runs it automatically
2. **Multiple agents installed**: Interactive selection menu appears:

```
  Select an agent:

  > [A] Claude Code (hooks)
    [G] Gemini CLI (hooks)
    [O] Codex CLI

  Use arrows, press shortcut, or Enter. Esc to cancel.
```

Press the letter shortcut to select instantly, or use arrow keys and Enter.

## Configuration

Klaas looks for configuration files in:

1. `.klaas/config.toml` (project-level, highest priority)
2. `~/.klaas/config.toml` (user-level)

### Configuration Options

```toml
# Default agent when multiple are available
default_agent = "claude"

# Only show these agents (even if others are installed)
only = ["claude", "gemini"]

# Or: Add custom agents alongside built-in ones
# also = ["my-custom-agent"]

# Custom agent definitions
[agents.my-custom-agent]
command = "/path/to/my-agent"
name = "My Custom Agent"
detect = ["my-agent", "myagent"]  # Binary names to check
hooks_type = "claude"              # "claude", "gemini", "codex", or "none"
shortcut = "X"                     # Single letter for selection menu

# Notification settings (future)
[notifications]
enabled = true
events = ["permission_request", "task_complete"]
```

### Example: Project-Specific Agent

```toml
# .klaas/config.toml in your project
default_agent = "claude"
only = ["claude"]
```

This ensures everyone on the project uses Claude Code.

## Setting Up Hooks

Hooks enable permission notifications. When Claude Code or Gemini CLI needs
permission to run a command, Klaas can notify you remotely.

### Claude Code Hooks

Add to `~/.claude/settings.json`:

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
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook notification"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook stop"
          }
        ]
      }
    ]
  }
}
```

### Gemini CLI Hooks

First, enable experimental hooks in `~/.gemini/settings.json`:

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

### How Hooks Work

When an agent fires a hook:

1. The agent spawns `klaas hook <event>`
2. Klaas reads the event data from stdin (JSON)
3. Klaas sends a notification to the Klaas API
4. The Dashboard receives the notification via WebSocket
5. You get notified (in-app, Telegram, etc.)

The hook process inherits environment variables from the parent Klaas process,
which contain the session ID for proper routing.

## Sessions

Each Klaas session has a unique ID (ULID format). By default, Klaas resumes
your previous session when you restart. Use `--new-session` to start fresh:

```bash
# Resume previous session
klaas --claude

# Start new session
klaas --claude --new-session
```

Sessions are encrypted end-to-end (E2EE). Only you can read the terminal
content - Klaas servers never see your data in plaintext.

## Environment Variables

Klaas sets these environment variables for hook processes:

| Variable | Description |
|----------|-------------|
| `KLAAS_SESSION_ID` | Current session ULID |
| `KLAAS_API_URL` | API base URL |
| `KLAAS_HOOK_TOKEN` | Authentication token for hooks |

These are inherited by the agent and any hooks it spawns.

## Offline Mode

If Klaas can't connect to the server, it runs in offline mode:

- The agent works normally
- No remote streaming or notifications
- Session resumes when connectivity returns

## Updating

```bash
# Update to latest version
klaas update
```

## Troubleshooting

### Agent not found

```
Error: Agent 'claude' (Claude Code) is not installed.
```

Install the agent or check your PATH:

```bash
which claude
# Should output: /usr/local/bin/claude or similar
```

### No agents installed

```
Error: No supported AI coding agents found.

Install one of the following:
  - Claude Code: https://claude.ai/download
  - Gemini CLI: https://ai.google.dev/gemini-cli
  - Codex CLI: https://openai.com/codex
  - Aider: pip install aider-chat
```

### Debug logging

Enable debug logs to troubleshoot issues:

```bash
RUST_LOG=klaas=debug klaas --claude
```

### Hook not firing

1. Verify hook configuration in agent settings
2. Check the agent's log/debug output
3. Ensure `klaas` is in PATH for the agent process
4. Run `klaas hook notification` manually to test

## Security

- **E2EE**: All terminal content is encrypted client-side
- **No screen scraping**: Klaas uses native agent hooks, not output parsing
- **Local keychain**: Credentials stored in system keychain
- **Short-lived tokens**: Hook tokens expire quickly

## Next Steps

- [Dashboard Guide](./dashboard.md) - View and control sessions remotely
- [Hooks Reference](./hooks.md) - Detailed hooks documentation
- [API Reference](./api.md) - REST API for integrations
