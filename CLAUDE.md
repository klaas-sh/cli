# Nexo Project Instructions

## Overview

Nexo is a cross-platform CLI tool that wraps Claude Code sessions, enabling
remote access and control via a web interface. The core CLI is built in Rust,
the API backend runs on Cloudflare Workers.

## Reference Project

**Use `/Users/bjorn/projects/smoking-media/redirme.com` as the reference** for:
- Cloudflare Workers setup and patterns
- Hono API structure and middleware
- D1 database migrations
- GitHub Actions deployment workflows
- Testing patterns with vitest
- ESLint and TypeScript configuration

## Project Structure

```
nexo/
├── packages/
│   ├── cli/              # Rust CLI wrapper
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── lib.rs
│   │       ├── app.rs      # Main event loop
│   │       ├── pty.rs      # PTY management
│   │       ├── terminal.rs # Terminal handling
│   │       ├── types.rs    # Core types
│   │       ├── config.rs   # Configuration
│   │       └── error.rs    # Error types
│   ├── api/              # Cloudflare Workers API
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── migrations/   # D1 database migrations
│   │   └── src/
│   │       ├── index.ts          # Worker entry point
│   │       ├── app.ts            # Hono application
│   │       ├── types.ts          # TypeScript types
│   │       ├── routes/           # API route handlers
│   │       ├── middleware/       # Auth middleware
│   │       ├── services/         # Business logic
│   │       └── durable-objects/  # WebSocket hubs
│   ├── dashboard/        # User web dashboard (future)
│   └── admin/            # Admin panel (future)
├── docs/
│   └── development/
│       ├── 01-teleportation-dev-research.md
│       ├── 02-nexo-mvp-spec.md
│       └── cli/
│           ├── 01-functional-requirements.md
│           └── 02-implementation-guide.md
└── .github/
    └── workflows/        # Deployment workflows (future)
```

## Prerequisites

### Installing Rust (for CLI)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

### Node.js (for API)

Node.js >= 18.0.0 is required for the API package.

## Development

### CLI (Rust)

```bash
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

# Format and lint
cargo fmt
cargo clippy -- -D warnings
```

### API (Cloudflare Workers)

```bash
# From project root
yarn install

# Apply D1 migrations locally
yarn db:migrate

# Start API dev server
yarn dev:api

# Run API tests
yarn test:api

# Type check
yarn typecheck
```

### Full Stack Development

```bash
# Start both API and CLI
yarn dev
```

## Pre-commit Checks

Always run before committing:

```bash
yarn pre-commit
```

This runs: install, lint, typecheck, test, build

For CLI-only changes:
```bash
cd packages/cli
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## API Endpoints

- `GET /` - API info
- `GET /health` - Health check
- `GET /health/db` - Database health check
- `POST /auth/device` - Start OAuth Device Flow
- `POST /auth/token` - Poll for token
- `POST /auth/refresh` - Refresh access token
- `GET /sessions` - List sessions (authenticated)
- `GET /sessions/:id` - Get session details
- `DELETE /sessions/:id` - Terminate session
- WebSocket at `/?session_id=xxx` - Real-time streaming

## ID Format

**CRITICAL:** All IDs MUST use ULID format:
- Session IDs: `01HQXK7V8G3N5M2R4P6T1W9Y0Z`
- Device IDs: `01HQXK7V8G3N5M2R4P6T1W9Y0Z`
- User IDs: `01HQXK7V8G3N5M2R4P6T1W9Y0Z`

NEVER use UUID, auto-increment, or any other ID format.

## Deployment

Production deployments are handled via GitHub Actions (not manual wrangler).
See redirme.com workflows for reference.

## Documentation

- Functional requirements: `docs/development/cli/01-functional-requirements.md`
- Implementation guide: `docs/development/cli/02-implementation-guide.md`
- MVP specification: `docs/development/02-nexo-mvp-spec.md`
