# Nexo Project Instructions

## Overview

Nexo is a cross-platform CLI tool that wraps Claude Code sessions, enabling
remote access and control via a web interface. The core CLI is built in Rust.

## Project Structure

```
nexo/
├── packages/
│   ├── cli/              # Rust CLI (primary focus)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── lib.rs
│   │       ├── app.rs
│   │       ├── pty.rs
│   │       ├── terminal.rs
│   │       ├── interceptor.rs
│   │       ├── types.rs
│   │       ├── config.rs
│   │       ├── error.rs
│   │       └── commands/
│   │           ├── mod.rs
│   │           ├── attach.rs
│   │           ├── detach.rs
│   │           ├── status.rs
│   │           └── help.rs
│   ├── worker/           # Cloudflare Worker (future)
│   └── web/              # React web client (future)
└── docs/
    └── development/
        ├── 01-teleportation-dev-research.md
        ├── 02-nexo-mvp-spec.md
        └── cli/
            ├── 01-functional-requirements.md
            └── 02-implementation-guide.md
```

## Prerequisites

### Installing Rust

The CLI requires Rust to be installed. Install via rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

Verify installation:

```bash
cargo --version
rustc --version
```

## CLI Development

### Key Technologies

- **Language:** Rust
- **PTY Handling:** portable-pty
- **Terminal:** crossterm
- **Async Runtime:** tokio
- **CLI Arguments:** clap
- **IDs:** ULID (per global CLAUDE.md requirement - NEVER use UUID!)

### Building & Running

```bash
# Navigate to CLI package
cd packages/cli

# Build
cargo build

# Run (wraps claude command)
cargo run

# Run with arguments passed to Claude
cargo run -- -p "Hello world"

# Run with debug logging
RUST_LOG=nexo=debug cargo run

# Run tests
cargo test

# Format code
cargo fmt

# Lint
cargo clippy -- -D warnings
```

### Pre-commit Checks for CLI

Before committing CLI changes:

```bash
cd packages/cli
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

### CLI Commands (intercepted during session)

- `/attach` - Connect session for remote access
- `/detach` - Disconnect from remote
- `/status` - Show connection status
- `/help` - Show available commands
- `//` - Escape to send literal `/` to Claude

### Connection States

1. **DETACHED** - Default, no network activity
2. **CONNECTING** - Establishing WebSocket connection
3. **ATTACHED** - Connected to Nexo cloud
4. **RECONNECTING** - Attempting to restore connection

## ID Format

**CRITICAL:** All IDs in this project MUST use ULID format:
- Session IDs: `01HQXK7V8G3N5M2R4P6T1W9Y0Z`
- Device IDs: `01HQXK7V8G3N5M2R4P6T1W9Y0Z`

NEVER use UUID, auto-increment, or any other ID format.

## Documentation

- Functional requirements: `docs/development/cli/01-functional-requirements.md`
- Implementation guide: `docs/development/cli/02-implementation-guide.md`
- MVP specification: `docs/development/02-nexo-mvp-spec.md`
