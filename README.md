# Klaas

Remote terminal access for agentic coding tools. Stream your terminal sessions
to any device in real-time with end-to-end encryption.

## Features

- **Real-time Streaming**: See terminal output character by character, from any
  device, as it happens
- **Multi-device Access**: Start on desktop, check progress from your phone
  while grabbing coffee
- **End-to-End Encrypted**: Your terminal sessions are encrypted client-side.
  Not even the Klaas team can read your data
- **Multi-Agent Support**: Works with Claude Code, Gemini CLI, Codex CLI,
  GitHub Copilot, Aider, and more
- **Permission Notifications**: Get notified when your agent needs approval
  (Claude Code, Gemini CLI)
- **Remote Input**: Send prompts and approve tool calls from anywhere

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐     WebSocket     ┌─────────────┐
│  Klaas CLI  │◄──────────────────►│ Cloudflare  │◄────────────────►│    Web      │
│  (Rust)     │    (E2EE)          │  Workers    │     (E2EE)        │  Dashboard  │
│             │                    │  + D1 + DO  │                   │  (Next.js)  │
└─────────────┘                    └─────────────┘                   └─────────────┘
      │
      ▼
┌─────────────┐
│ Agent CLI   │
│ (Claude,    │
│  Gemini,    │
│  Codex...)  │
└─────────────┘
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (for the CLI)
- [Node.js](https://nodejs.org/) >= 18 (for API and dashboard)
- One of the supported agents installed

### Supported Agents

| Agent | Command | Hooks |
|-------|---------|-------|
| [Claude Code](https://code.claude.com/) | `klaas --claude` | Full |
| [Gemini CLI](https://geminicli.com/) | `klaas --gemini` | Full |
| [Codex CLI](https://developers.openai.com/codex/cli/) | `klaas --codex` | Partial |
| [Copilot CLI](https://github.com/features/copilot/cli) | `klaas --copilot` | - |
| [Vibe CLI](https://mistral.ai/news/devstral-2-vibe-cli) | `klaas --vibe` | - |

### 1. Install Dependencies

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install Node.js dependencies
yarn install
```

### 2. Set Up Local Development

```bash
# Apply database migrations
yarn db:migrate

# Create a test user
node packages/api/scripts/create-user.mjs

# Start the API and dashboard
yarn dev
```

### 3. Run the CLI

```bash
cd packages/cli
cargo run
```

On first run, you'll be prompted to authenticate via the web dashboard.

### 4. View in Browser

Open [http://localhost:3001](http://localhost:3001), log in, and navigate to
Sessions. You should see your active session and can interact with it remotely.

## Project Structure

```
packages/
├── cli/                 # Rust CLI wrapper
│   └── src/
│       ├── main.rs      # Entry point
│       ├── app.rs       # Main event loop
│       ├── agents.rs    # Agent detection & selection
│       ├── pty.rs       # PTY management
│       ├── websocket.rs # WebSocket client
│       ├── auth.rs      # OAuth device flow
│       ├── credentials.rs # Keychain storage
│       └── ...
├── api/                 # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts     # Worker entry
│   │   ├── routes/      # API endpoints
│   │   └── durable-objects/
│   │       └── session-hub.ts  # WebSocket hub
│   └── migrations/      # D1 database migrations
└── dashboard/           # Next.js web dashboard
    └── src/
        ├── app/         # App router pages
        └── components/
            └── sessions/
                └── terminal.tsx  # xterm.js terminal
```

## Development

```bash
# Run pre-commit checks (required before committing)
yarn pre-commit

# Run individual commands
yarn dev:api        # Start API server
yarn dev:dashboard  # Start dashboard
yarn test           # Run all tests
yarn lint           # Lint all packages
yarn typecheck      # TypeScript type checking
```

### CLI Development

```bash
cd packages/cli

cargo build         # Build
cargo run           # Run (auto-detects agents)
cargo run -- --claude  # Run with specific agent
cargo test          # Run tests
cargo clippy        # Lint
```

## How It Works

1. **CLI starts**: Detects installed agents, spawns selected one in a PTY
2. **WebSocket connects**: CLI connects to SessionHub Durable Object
3. **E2EE streaming**: All terminal I/O is encrypted client-side and streamed
4. **Web viewing**: Dashboard connects to same SessionHub, decrypts locally
5. **Remote input**: Browser input encrypted and sent to CLI, injected into PTY
6. **Hook notifications**: For supported agents, permission requests trigger
   notifications

## Security: End-to-End Encryption

Klaas implements end-to-end encryption (E2EE) ensuring that **only you can read
your terminal sessions** - not even the Klaas team can decrypt your data.

### How It Works

```
┌─────────────┐     encrypted with      ┌─────────────┐
│ User's      │ ───────────────────────►│ Stored on   │
│ Master Key  │     user's password     │ Server      │
└─────────────┘                         └─────────────┘
       │
       │ decrypted locally on each device
       ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ CLI         │  │ Web Browser │  │ Mobile App  │
└─────────────┘  └─────────────┘  └─────────────┘
       │                │                │
       └────────────────┴────────────────┘
                        │
              All decrypt messages with
                 same master key
```

### Key Principles

1. **Zero-Knowledge Architecture**: The server stores only encrypted data and
   your password-protected master key. Without your password, the data is
   unreadable.

2. **Multi-Device Access**: All your authenticated devices (CLI, web browser,
   mobile app) can decrypt and view your session data. Adding a new device
   requires your password to unlock the master key.

3. **Client-Side Encryption**: All encryption and decryption happens on your
   devices. The server never sees plaintext content.

4. **Password-Protected Keys**: Your master encryption key is encrypted with
   your password before being stored. If you forget your password, your data
   cannot be recovered (by design).

### What's Protected

| Data | Encrypted |
|------|-----------|
| Terminal output | AES-256-GCM |
| Terminal input (keystrokes) | AES-256-GCM |
| Session metadata (timestamps) | Plaintext (for functionality) |
| Authentication tokens | Separate (JWT/OAuth) |

For implementation details, see [docs/e2ee/](docs/e2ee/).

## License

MIT
