# Klaas Project Instructions

## Overview

Klaas is a cross-platform CLI tool that wraps Claude Code sessions, enabling
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
klaas/
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
│       ├── 02-klaas-mvp-spec.md
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
RUST_LOG=klaas=debug cargo run

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
- MVP specification: `docs/development/02-klaas-mvp-spec.md`

## Dashboard Theme Colors

The dashboard uses **Tailwind CSS violet palette** with semantic CSS variables.
All colors are defined in `packages/dashboard/src/app/globals.css`.

### Color System

Use semantic `app-*` classes instead of hardcoded Tailwind colors:

| Semantic Name | Light (Tailwind) | Light Hex | Dark (Tailwind) | Dark Hex |
|--------------|------------------|-----------|-----------------|----------|
| `app-primary` | violet-600 | `#7c3aed` | violet-400 | `#a78bfa` |
| `app-primary-hover` | violet-700 | `#6d28d9` | violet-500 | `#8b5cf6` |
| `app-primary-light` | violet-100 | `#ede9fe` | violet-900 | `#4c1d95` |
| `app-accent` | violet-800 | `#5b21b6` | violet-600 | `#7c3aed` |
| `app-background` | violet-50 | `#faf5ff` | violet-950 | `#2e1065` |
| `app-surface` | white | `#ffffff` | violet-900 | `#4c1d95` |
| `app-border` | violet-200 | `#ddd6fe` | violet-700 | `#6d28d9` |
| `app-highlight` | violet-50 | `#f5f3ff` | custom | `#3b1a6d` |
| `app-text-primary` | slate-800 | `#1e293b` | violet-100 | `#ede9fe` |
| `app-text-secondary` | violet-700 | `#6d28d9` | violet-300 | `#c4b5fd` |

### Logo Colors

The favicon and AppIcon use hardcoded violet colors:
- Background: violet-900 (`#4c1d95`)
- Title bar: violet-600 (`#7c3aed`)
- Terminal elements: violet-100 (`#ede9fe`)

### Usage

```tsx
// Use semantic classes, NOT hardcoded violet-*
<button className="bg-app-primary hover:bg-app-primary-hover">  // Good
<button className="bg-violet-600 hover:bg-violet-700">          // Bad

// Dark mode variants
<div className="bg-app-surface dark:bg-app-surface-dark">
```

To change the color scheme, update `globals.css` - all components will update.
