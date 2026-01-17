<p align="center">
  <img src="https://raw.githubusercontent.com/klaas-sh/cli/main/logo.svg" alt="klaas logo" width="80" height="80">
</p>

<h1 align="center">klaas</h1>

<p align="center">
  <strong>Remote terminal access for agentic coding tools</strong><br>
  Stream your sessions to any device with E2EE
</p>

<p align="center">
  <a href="https://github.com/klaas-sh/cli/releases"><img src="https://img.shields.io/github/v/release/klaas-sh/cli" alt="Release"></a>
  <a href="https://github.com/klaas-sh/cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://klaas.sh"><img src="https://img.shields.io/badge/website-klaas.sh-orange" alt="Website"></a>
</p>

<p align="center">
  <picture>
    <source srcset="https://raw.githubusercontent.com/klaas-sh/cli/main/terminal-animation.avif" type="image/avif">
    <img src="https://raw.githubusercontent.com/klaas-sh/cli/main/terminal-animation.webp" alt="klaas demo" width="700">
  </picture>
</p>

---

> **Warning**
> This npm package is deprecated. Please use the native installer instead.

## Installation

klaas is a native Rust binary. For the best experience, install using one of
these methods:

### macOS / Linux / WSL

```bash
curl -fsSL https://klaas.sh/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://klaas.sh/install.ps1 | iex
```

### Homebrew (macOS/Linux)

```bash
brew install klaas-sh/tap/klaas
```

### Scoop (Windows)

```powershell
scoop bucket add klaas https://github.com/klaas-sh/scoop-bucket
scoop install klaas
```

## Why not npm?

klaas is a native Rust binary. Native installation provides:

- **Better performance** - No Node.js overhead
- **Proper system integration** - Uses system keychain for credentials
- **Automatic updates** - Built-in update mechanism
- **Smaller footprint** - Single binary, no dependencies

## What is klaas?

**klaas** wraps your AI coding agent sessions and streams them to the cloud,
enabling remote access from any device via a web interface. Perfect for:

- **Real-time streaming** - See terminal output character by character
- **Multi-device access** - Start on desktop, check progress from your phone
- **Remote approval** - Approve tool calls when your agent needs permission
- **Remote instructions** - Send prompts and guide your agent from anywhere
- **End-to-end encrypted** - Your sessions are encrypted. We can't read them.

## Supported Agents

| Agent | Flag | Hooks |
|-------|------|-------|
| [Claude Code](https://code.claude.com/) | `--claude` | Full |
| [Gemini CLI](https://geminicli.com/) | `--gemini` | Full |
| [Codex CLI](https://developers.openai.com/codex/cli/) | `--codex` | Partial |
| [Copilot CLI](https://github.com/features/copilot/cli) | `--copilot` | - |
| [Vibe CLI](https://mistral.ai/news/devstral-2-vibe-cli) | `--vibe` | - |

## Usage

```bash
# Auto-detect installed agent
klaas

# Use a specific agent
klaas --claude
klaas --gemini

# Start a new session (instead of resuming)
klaas --new-session

# Pass arguments to the agent
klaas --claude -- --model sonnet --allowedTools Read,Write
```

On first run, you'll be prompted to authenticate via your browser. Once
authenticated, your session is automatically streamed to the klaas dashboard.

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   klaas     │────▶│   Agent     │────▶│  Terminal   │
│   CLI       │◀────│   CLI       │◀────│  Output     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │         ┌─────────────┐               │
       └────────▶│   klaas     │◀──────────────┘
        (E2EE)   │   Cloud     │
                 └─────────────┘
                       │
                 ┌─────────────┐
                 │    Web      │
                 │  Dashboard  │
                 └─────────────┘
```

1. **klaas** detects installed agents and spawns your choice in a PTY
2. All input/output is captured and encrypted client-side
3. Encrypted output is streamed to the klaas cloud in real-time
4. Access your session from the web dashboard at [klaas.sh](https://klaas.sh)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Website](https://klaas.sh)
- [Documentation](https://klaas.sh/docs)
- [Dashboard](https://app.klaas.sh/)
- [GitHub](https://github.com/klaas-sh)
- [Report Issues](https://github.com/klaas-sh/cli/issues)
