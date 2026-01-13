# Nexo

## What Was Implemented

A Rust CLI that wraps Claude Code sessions with command interception 
capabilities. This is Phase 1-2 of the MVP spec (local-only CLI).

### Core Features
- PTY Wrapper: Spawns Claude Code in a pseudo-terminal, forwarding all I/O
- Command Interception: Detects /commands typed at the start of a line
- Session IDs: Each session gets a unique ULID identifier

## Available Commands (during a session)

| Command         | Description                                        |
|-----------------|----------------------------------------------------|
| `/nexo help`    | Shows available wrapper commands                   |
| `/nexo status`  | Shows session ID, connection state, working dir    |
| `/nexo attach`  | Connect session for remote access (not yet implemented) |
| `/nexo detach`  | Disconnect from remote (not yet implemented)       |
| `/nexo`         | Same as `/nexo help`                               |

All Claude Code commands (`/help`, `/status`, `/compact`, etc.) pass through unchanged.

## Not Implemented (future phases):
- Remote connectivity (WebSocket, OAuth)
- Cloud backend integration
- Web dashboard


## How to Build & Run

## 1. Install Rust
```shell
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Follow the prompts (just press Enter for defaults). Then reload your shell:
```shell
source ~/.cargo/env
```

Verify it worked:
```shell
cargo --version
# Should show something like: cargo 1.75.0
```

## 2. Build the CLI

```shell
cd packages/cli
cargo build
```

First build downloads dependencies and compiles (~1-2 minutes). Subsequent builds are faster.

## 3. Run the CLI

```shell
# Run directly (wraps the `claude` command)
cargo run

# Pass arguments to Claude Code
cargo run -- -p "Hello world"
cargo run -- --help
```

> The -- separates cargo arguments from arguments passed to your CLI.

## 4. Run Tests

```shell
cargo test
```
  
#### What You Can Test

1. Basic wrapping: Run `cargo run` - it should start Claude Code normally
2. Wrapper commands: Type `/nexo help` - should show the wrapper help menu
3. Status command: Type `/nexo status` - shows session ID and working directory
4. Claude Code commands: Type `/help` or `/status` - should pass through to Claude Code
5. Passthrough: Normal typing and all Claude Code features should work unchanged

Note: You need claude (Claude Code CLI) installed and in your PATH for this 
to work. If it's not installed, you'll see an error message.

  
Project Structure

```text
packages/cli/
  ├── Cargo.toml          # Dependencies & config
  └── src/
    ├── main.rs         # Entry point
    ├── lib.rs          # Library exports
    ├── app.rs          # Main I/O loop
    ├── pty.rs          # PTY management
    ├── terminal.rs     # Raw mode handling
    ├── interceptor.rs  # Command detection state machine
    ├── types.rs        # SessionId, DeviceId, etc.
    ├── config.rs       # Configuration constants
    ├── error.rs        # Error types (CliError)
    └── commands/
        ├── mod.rs
        ├── help.rs     # /help
        ├── status.rs   # /status
        ├── attach.rs   # /attach (stub)
        └── detach.rs   # /detach (stub)
```
