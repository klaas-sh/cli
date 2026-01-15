# Klaas

Remote access wrapper for Claude Code sessions. Run Claude Code locally and
view/interact with it from anywhere via a web browser.

## Features

- **Remote Approval**: Approve tool calls from your phone when Claude needs
  permission - never miss a prompt while away from your desk
- **Remote Instructions**: Send new prompts and instructions to Claude from
  anywhere - keep your coding session moving forward
- **Remote Viewing**: Stream terminal output in real-time to a web dashboard
- **Transparent Wrapper**: Wraps Claude Code in a PTY without modifying its
  behavior - all Claude Code commands work unchanged
- **OAuth Authentication**: Secure device-based authentication flow
- **Auto-reconnect**: Handles connection drops gracefully

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐     WebSocket     ┌─────────────┐
│  Klaas CLI   │◄──────────────────►│ Cloudflare  │◄────────────────►│    Web      │
│  (Rust)     │                    │  Workers    │                   │  Dashboard  │
│             │                    │  + D1 + DO  │                   │  (Next.js)  │
└─────────────┘                    └─────────────┘                   └─────────────┘
      │
      ▼
┌─────────────┐
│ Claude Code │
│   (PTY)     │
└─────────────┘
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (for the CLI)
- [Node.js](https://nodejs.org/) >= 18 (for API and dashboard)
- [Claude Code](https://claude.ai/claude-code) installed and in PATH

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
Sessions. You should see your active Claude Code session and can interact with
it remotely.

## Project Structure

```
packages/
├── cli/                 # Rust CLI wrapper
│   └── src/
│       ├── main.rs      # Entry point
│       ├── app.rs       # Main event loop
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
cargo run           # Run (wraps claude command)
cargo test          # Run tests
cargo clippy        # Lint
```

## How It Works

1. **CLI starts**: Spawns Claude Code in a PTY, authenticates via OAuth
2. **WebSocket connects**: CLI connects to SessionHub Durable Object
3. **I/O streaming**: All PTY output is base64-encoded and sent to the server
4. **Web viewing**: Dashboard connects to same SessionHub, receives output
5. **Remote input**: Browser keystrokes sent via WebSocket to CLI, injected
   into PTY

## License

MIT
