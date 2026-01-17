# Hooks Reference

Hooks enable Klaas to receive notifications from AI coding agents when
events occur, such as permission requests or task completion.

## Overview

A "hook" is a shell command that the agent runs when an event happens.
The flow is:

```
Agent event (e.g., permission needed)
    │
    ▼
Agent spawns: klaas hook permission
    │
    ▼
Agent sends JSON to hook's stdin
    │
    ▼
Hook processes event, sends notification
    │
    ▼
Hook outputs JSON response to stdout
    │
    ▼
Agent reads response and continues
```

## Supported Agents

| Agent | Hooks Support | Configuration File |
|-------|--------------|-------------------|
| [Claude Code](https://code.claude.com/) | Full native | `~/.claude/settings.json` |
| [Gemini CLI](https://geminicli.com/) | Experimental | `~/.gemini/settings.json` |
| [Codex CLI](https://developers.openai.com/codex/cli/) | Via SDK | Programmatic only |
| [Copilot CLI](https://github.com/features/copilot/cli) | Not supported | - |
| [Vibe CLI](https://mistral.ai/news/devstral-2-vibe-cli) | Not supported | - |

## Hook Events

### Permission Request

Fired when the agent needs permission to perform an action.

**Event name**: `permission` (Claude Code: `PermissionRequest`)

**Input JSON**:
```json
{
  "tool": "Bash",
  "command": "npm install",
  "reason": "Install dependencies"
}
```

**Output JSON**:
```json
{
  "decision": "ask"
}
```

Decisions:
- `"allow"` - Auto-approve the action
- `"deny"` - Auto-reject the action
- `"ask"` - Show the normal permission prompt (default)

### Notification

General notification from the agent.

**Event name**: `notification` (Claude Code: `Notification`)

**Input JSON**:
```json
{
  "type": "permission_prompt",
  "message": "Claude needs permission to edit file.js"
}
```

### Stop

Fired when the agent finishes a task.

**Event name**: `stop` (Claude Code: `Stop`)

**Input JSON**:
```json
{
  "reason": "task_complete"
}
```

## Claude Code Configuration

Full hooks configuration for Claude Code in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "Bash|Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook permission"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook tool-complete"
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
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook session-start"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook session-end"
          }
        ]
      }
    ]
  }
}
```

### Claude Code Hook Events

| Event | Description | Has Matcher |
|-------|-------------|-------------|
| `PreToolUse` | Before a tool executes | Yes |
| `PostToolUse` | After a tool completes | Yes |
| `PermissionRequest` | Permission dialog shown | Yes |
| `Notification` | Agent sends notification | Yes |
| `UserPromptSubmit` | User submits prompt | No |
| `Stop` | Agent finishes responding | No |
| `SubagentStop` | Subagent (Task) finishes | No |
| `SessionStart` | Session starts/resumes | No |
| `SessionEnd` | Session ends | No |
| `PreCompact` | Before memory compaction | No |

### Matcher Patterns

Matchers filter which events trigger hooks:

```json
{
  "matcher": "Bash|Edit|Write",
  "hooks": [...]
}
```

Use `|` to match multiple patterns. Patterns are matched against:
- Tool names for tool events (e.g., `Bash`, `Edit`, `Write`)
- Notification types for notifications (e.g., `permission_prompt`)

## Gemini CLI Configuration

Gemini CLI hooks mirror the Claude Code format. Enable in
`~/.gemini/settings.json`:

```json
{
  "experimental": {
    "hooks": true
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook session-start"
          }
        ]
      }
    ],
    "BeforeModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "klaas hook before-model"
          }
        ]
      }
    ],
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

### Gemini CLI Hook Events

| Event | Description |
|-------|-------------|
| `SessionStart` | Initialize session |
| `SessionEnd` | Cleanup on session end |
| `BeforeModel` | Modify prompts before sending |
| `AfterModel` | Process model outputs |
| `BeforeToolSelection` | Filter/prioritize tools |
| `Notification` | Handle notifications |

## Session Correlation

When Klaas spawns an agent, it sets environment variables that hooks inherit:

```
KLAAS_SESSION_ID=01ABC123...
KLAAS_API_URL=https://api.klaas.sh
KLAAS_HOOK_TOKEN=eyJ...
```

This allows hooks to know which Klaas session they belong to, even when
multiple sessions are running simultaneously.

```
Terminal 1                    Terminal 2
    │                             │
    ▼                             ▼
klaas --claude               klaas --gemini
SESSION_ID=01ABC...          SESSION_ID=01DEF...
    │                             │
    ▼                             ▼
claude (inherits env)        gemini (inherits env)
    │                             │
    ▼                             ▼
klaas hook permission        klaas hook notification
Reads: 01ABC...              Reads: 01DEF...
```

## Testing Hooks

Test your hook configuration manually:

```bash
# Test permission hook
echo '{"tool":"Bash","command":"ls"}' | klaas hook permission

# Should output (if running outside klaas):
# Error: This command must be called by an agent CLI running inside Klaas.

# Test inside a klaas session:
# The hook will send a notification and return:
# {"decision":"ask"}
```

## Security Considerations

1. **No terminal content**: Hooks only receive event metadata, not the full
   terminal output. This preserves E2EE.

2. **Short-lived tokens**: `KLAAS_HOOK_TOKEN` expires quickly and is scoped
   to the session.

3. **Local execution**: Hooks run locally on your machine, not on Klaas
   servers.

4. **First-use consent**: Gemini CLI prompts for consent when project-level
   hooks are first encountered.

## Troubleshooting

### Hook not firing

1. Check agent settings file exists and is valid JSON
2. Verify `klaas` is in your PATH
3. Check matcher pattern matches the event
4. Enable agent debug mode to see hook execution

### Hook fails silently

Run the hook manually to see errors:

```bash
export KLAAS_SESSION_ID=test
export KLAAS_API_URL=https://api.klaas.sh
echo '{}' | klaas hook notification
```

### Permission always asked

If your hook returns `{"decision":"ask"}` (the default), the agent will
always show the permission prompt. To auto-approve specific tools:

```json
{
  "matcher": "Read",
  "hooks": [
    {
      "type": "command",
      "command": "echo '{\"decision\":\"allow\"}'"
    }
  ]
}
```

## Agent Limitations

Not all AI coding agents support hooks. Here's what works with each agent:

### Full Hooks Support

**Claude Code** and **Gemini CLI** have full hooks support:
- Permission request notifications
- Task completion notifications
- Session start/end events
- All notification channels (Dashboard, Telegram, etc.)

### Partial Support

**OpenAI Codex CLI** has SDK-based extensibility:
- No traditional shell hooks
- Approval policy controls (`--ask-for-approval`)
- SDK available for programmatic control
- Basic PTY streaming works (no permission notifications)

### No Hooks Support

The following agents work with Klaas but don't support notifications:

| Agent | What Works | What Doesn't |
|-------|-----------|--------------|
| [Copilot CLI](https://github.com/features/copilot/cli) | PTY streaming, remote viewing | Permission notifications |
| [Vibe CLI](https://mistral.ai/news/devstral-2-vibe-cli) | PTY streaming, remote viewing | Permission notifications |

For agents without hooks:
- Terminal content is still encrypted and streamed (E2EE preserved)
- You can view and interact with the session remotely
- You won't receive push notifications for permission requests
- You need to watch the Dashboard to see when input is needed

### Why Some Agents Lack Hooks

AI coding agents implement hooks differently (or not at all):

1. **Native hooks** (Claude Code, Gemini): Agent spawns a shell command on events
2. **SDK-only** (Codex): Must use programmatic API, not CLI hooks
3. **No extensibility** (Copilot, Aider): Agent doesn't expose events externally

Klaas uses native hooks where available. For agents without hooks, Klaas still
provides value through secure remote terminal streaming - you just won't get
proactive notifications.

## References

- [Claude Code Hooks Documentation](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Gemini CLI Hooks](https://ai.google.dev/gemini-cli/docs/hooks)
