<p align="center">
  <img src="logo.svg" alt="klaas logo" width="80" height="80">
</p>

<h1 align="center">klaas</h1>

<p align="center">
  <strong>Remote access CLI for Claude Code</strong><br>
  Control your Claude Code sessions from anywhere
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

**klaas** wraps your Claude Code sessions and streams them to the cloud, enabling remote access from any device via a web interface. Perfect for:

- **Remote approval** - Approve tool calls from your phone when Claude needs permission
- **Remote instructions** - Send new prompts and instructions to Claude from anywhere
- **Monitor sessions** - Watch long-running coding sessions from any device
- **Share with teammates** - Give others access to view your Claude Code session
- **Stay in control** - Keep an eye on autonomous coding tasks wherever you are

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

Simply replace `claude` with `klaas`:

```bash
# Start Claude Code with remote access
klaas

# Start with a prompt
klaas -p "Review this codebase"

# Start a new session (instead of resuming)
klaas --new-session

# Pass any Claude Code arguments
klaas --model sonnet --allowedTools Read,Write
```

On first run, you'll be prompted to authenticate via your browser. Once authenticated, your session is automatically streamed to the klaas dashboard.

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   klaas     │────▶│  Claude     │────▶│  Terminal   │
│   CLI       │◀────│  Code       │◀────│  Output     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │         ┌─────────────┐               │
       └────────▶│   klaas     │◀──────────────┘
                 │   Cloud     │
                 └─────────────┘
                       │
                 ┌─────────────┐
                 │    Web      │
                 │  Dashboard  │
                 └─────────────┘
```

1. **klaas** spawns Claude Code in a pseudo-terminal (PTY)
2. All input/output is captured and forwarded
3. Output is streamed to the klaas cloud in real-time
4. Access your session from the web dashboard at [klaas.sh](https://klaas.sh)

## Commands

| Command | Description |
|---------|-------------|
| `klaas` | Start Claude Code with remote access |
| `klaas update` | Update klaas to the latest version |
| `klaas --version` | Show version |
| `klaas --help` | Show help |

## Configuration

klaas stores credentials securely in your system keychain (macOS Keychain, Windows Credential Manager, or Linux Secret Service).

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
