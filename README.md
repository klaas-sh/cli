<p align="center">
  <a href="https://klaas.sh">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="logo-banner-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="logo-banner-light.svg">
      <img src="logo-banner-dark.svg" alt="klaas - Remote Terminal Access" height="80">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/klaas-sh/cli/releases"><img src="https://img.shields.io/github/v/release/klaas-sh/cli" alt="Release"></a>
  <a href="https://github.com/klaas-sh/cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://klaas.sh"><img src="https://img.shields.io/badge/website-klaas.sh-orange" alt="Website"></a>
</p>

<p align="center">
  <picture>
    <source srcset="terminal-animation.avif" type="image/avif">
    <img src="terminal-animation.webp" alt="klaas demo" width="700">
  </picture>
</p>

---

## What is klaas?

**klaas** wraps your AI coding agent sessions and streams them to the cloud,
enabling remote access from any device via a web interface. Perfect for:

- **Real-time streaming** - See terminal output character by character, as it
  happens
- **Multi-device access** - Start on desktop, check progress from your phone
- **Remote approval** - Approve tool calls from anywhere when your agent needs
  permission
- **Remote instructions** - Send prompts and guide your agent from any device
- **End-to-end encrypted** - Your sessions are encrypted. We can't read them.

## Supported Agents

| Agent | Flag | Shortcut | Hooks |
|-------|------|----------|-------|
| [Claude Code](https://code.claude.com/) | `--claude` | `[A]` | Full |
| [Gemini CLI](https://geminicli.com/) | `--gemini` | `[G]` | Full |
| [Codex CLI](https://developers.openai.com/codex/cli/) | `--codex` | `[O]` | Partial |
| [Copilot CLI](https://github.com/features/copilot/cli) | `--copilot` | `[C]` | - |
| [Vibe CLI](https://mistral.ai/news/devstral-2-vibe-cli) | `--vibe` | `[M]` | - |

You can also configure your own agent.

## Installation

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

## Usage

```bash
# Auto-detect installed agent (interactive if multiple)
klaas

# Use a specific agent
klaas --claude
klaas --gemini
klaas --codex

# Start a new session (instead of resuming)
klaas --new-session

# Pass arguments to the agent
klaas --claude -- --model sonnet --allowedTools "Bash(git*)"

# List available agents
klaas --list-agents
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
5. For agents with hooks support, permission requests trigger notifications

## Commands

| Command | Description |
|---------|-------------|
| `klaas` | Start with auto-detected agent |
| `klaas --claude` | Start with Claude Code |
| `klaas --gemini` | Start with Gemini CLI |
| `klaas --list-agents` | List available agents |
| `klaas update` | Update to latest version |
| `klaas --version` | Show version |
| `klaas --help` | Show help |

## Configuration

klaas stores credentials securely in your system keychain (macOS Keychain,
Windows Credential Manager, or Linux Secret Service).

### Configuration File

Create `.klaas/config.toml` in your project or `~/.klaas/config.toml` globally:

```toml
# Default agent when multiple are available
default_agent = "claude"

# Only show these agents (even if others are installed)
only = ["claude", "gemini"]
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KLAAS_API_URL` | API server URL | `https://api.klaas.sh` |
| `KLAAS_INSTALL_DIR` | Installation directory | Platform default |

## Building from Source

```bash
# Clone the repository
git clone https://github.com/klaas-sh/cli.git
cd cli

# Build
cargo build --release

# Run
./target/release/klaas
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Website](https://klaas.sh)
- [Documentation](https://klaas.sh/docs)
- [Dashboard](https://klaas.sh/sessions)
- [Report Issues](https://github.com/klaas-sh/cli/issues)
