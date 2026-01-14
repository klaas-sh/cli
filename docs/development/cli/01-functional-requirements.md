# Klaas CLI Functional Requirements

**Version:** 0.1.0
**Status:** Draft
**Last Updated:** January 2025

---

## 1. Overview

The Klaas CLI is a cross-platform terminal application that wraps Claude Code
sessions, providing seamless local usage with optional remote access
capabilities. The CLI intercepts special commands while transparently proxying
all other input/output to Claude Code.

### 1.1 Core Principles

- **Transparent Proxy:** All Claude Code functionality works identically
  through Klaas
- **Offline-First:** Zero network activity unless user explicitly attaches
- **Minimal Footprint:** Single binary, no runtime dependencies
- **Cross-Platform:** Windows, macOS, and Linux support

### 1.2 Target Platforms

| Platform | Architecture | Priority |
|----------|--------------|----------|
| macOS    | arm64, x86_64 | P0 |
| Linux    | x86_64, arm64 | P0 |
| Windows  | x86_64        | P1 |

---

## 2. Functional Requirements

### 2.1 Basic Operation

#### FR-2.1.1: Launch Claude Code

**Description:** The CLI spawns Claude Code as a child process within a
pseudo-terminal (PTY).

**Acceptance Criteria:**
- [ ] CLI executes `claude` command in a PTY
- [ ] All command-line arguments pass through to Claude Code
- [ ] PTY dimensions match the user's terminal
- [ ] PTY resize events propagate to Claude Code

**Examples:**
```bash
# Basic usage (no arguments)
klaas

# With prompt
klaas -p "Review this codebase"

# With Claude Code flags
klaas --model sonnet --allowedTools Read,Write

# All flags pass through
klaas --dangerously-skip-permissions
```

#### FR-2.1.2: I/O Forwarding

**Description:** All input and output flows between the user's terminal and
Claude Code without modification (except for intercepted commands).

**Acceptance Criteria:**
- [ ] User keystrokes forward to Claude Code in real-time
- [ ] Claude Code output displays in user's terminal immediately
- [ ] ANSI escape sequences pass through unmodified
- [ ] Special keys (arrow keys, function keys, Ctrl sequences) work correctly
- [ ] Terminal resize events propagate correctly

#### FR-2.1.3: Terminal Raw Mode

**Description:** The CLI puts the terminal into raw mode to capture individual
keystrokes for command interception.

**Acceptance Criteria:**
- [ ] Terminal enters raw mode on startup
- [ ] Original terminal settings restore on exit (normal or abnormal)
- [ ] Echo handled by Claude Code, not duplicated by CLI
- [ ] Works with all common terminal emulators

#### FR-2.1.4: Graceful Shutdown

**Description:** The CLI handles termination signals and cleans up properly.

**Acceptance Criteria:**
- [ ] SIGINT (Ctrl+C) passes to Claude Code, not intercepted by CLI
- [ ] SIGTERM triggers graceful shutdown
- [ ] Terminal mode restores on any exit path (including crashes)
- [ ] Exit code matches Claude Code's exit code
- [ ] If attached, sends detach message before closing WebSocket

---

### 2.2 Command Interception

#### FR-2.2.1: Command Detection

**Description:** The CLI detects and intercepts special commands that begin
with `/` at the start of a line.

**Acceptance Criteria:**
- [ ] Commands detected only at line start
- [ ] Detection uses case-insensitive matching
- [ ] Commands recognized: `/attach`, `/detach`, `/status`, `/help`
- [ ] Unrecognized `/` commands pass through to Claude Code
- [ ] Double-slash (`//`) escapes to send single `/` to Claude Code

#### FR-2.2.2: Command Timeout

**Description:** If a potential command is not completed within a timeout
period, the partial input forwards to Claude Code.

**Acceptance Criteria:**
- [ ] Timeout of 100ms from first `/` character
- [ ] On timeout, `/` plus any buffered characters forward to Claude Code
- [ ] User experiences no noticeable delay for normal input

#### FR-2.2.3: Line Start Detection

**Description:** The CLI tracks when input is at the start of a new line.

**Acceptance Criteria:**
- [ ] Line start is true at session start
- [ ] Line start is true after newline or carriage return
- [ ] Line start is false after any other character
- [ ] Works correctly with cursor movement and editing

---

### 2.3 Commands

#### FR-2.3.1: `/help` Command

**Description:** Displays available Klaas commands.

**Acceptance Criteria:**
- [ ] Lists all available commands with descriptions
- [ ] Explains double-slash escape sequence
- [ ] Output formatted for terminal readability

**Output Format:**
```
Klaas Commands:
  /attach  - Connect this session for remote access
  /detach  - Disconnect from remote (continue locally)
  /status  - Show connection status
  /help    - Show this help

All other input is sent to Claude Code.
Type // to send a literal /
```

#### FR-2.3.2: `/status` Command

**Description:** Shows current session and connection status.

**Acceptance Criteria:**
- [ ] Displays session ID (ULID format)
- [ ] Shows attachment status (attached/detached)
- [ ] If attached, shows server connection info
- [ ] Displays current working directory
- [ ] Shows device name when known

**Output Format (Detached):**
```
Session ID: 01HQXK7V8G3N5M2R4P6T1W9Y0Z
Status: Detached
Working directory: /Users/example/project
```

**Output Format (Attached):**
```
Session ID: 01HQXK7V8G3N5M2R4P6T1W9Y0Z
Status: Attached
Connected to: api.klaas.dev
Device: MacBook Pro
Working directory: /Users/example/project
```

#### FR-2.3.3: `/attach` Command

**Description:** Initiates connection to Klaas cloud for remote access.

**Acceptance Criteria:**
- [ ] If already attached, displays message and session ID
- [ ] Checks for valid stored credentials before prompting auth
- [ ] Uses OAuth Device Flow for initial authentication
- [ ] Displays verification URL and user code
- [ ] Polls for authentication completion
- [ ] Stores credentials securely on success
- [ ] Establishes WebSocket connection
- [ ] Sends session attach message
- [ ] Displays success message with session ID
- [ ] On failure, displays error and remains detached

**Authentication Flow:**
```
To attach this session, visit: https://klaas.dev/activate
Enter code: ABCD-1234

Waiting for authorization...

✓ Attached. Session ID: 01HQXK7V8G3N5M2R4P6T1W9Y0Z
```

#### FR-2.3.4: `/detach` Command

**Description:** Disconnects from Klaas cloud while continuing local session.

**Acceptance Criteria:**
- [ ] If not attached, displays "Not attached." message
- [ ] Sends session detach message over WebSocket
- [ ] Closes WebSocket connection gracefully
- [ ] Updates state to detached
- [ ] Displays confirmation message
- [ ] Session continues locally uninterrupted

**Output:**
```
Detached. Continuing locally.
```

---

### 2.4 Remote Connectivity

#### FR-2.4.1: WebSocket Connection

**Description:** Maintains persistent WebSocket connection when attached.

**Acceptance Criteria:**
- [ ] Connects to `wss://api.klaas.dev/ws`
- [ ] Includes authentication token in connection headers
- [ ] Includes device ID and session ID in headers
- [ ] Handles connection success and failure states
- [ ] Responds to server ping with pong

#### FR-2.4.2: Output Streaming

**Description:** Forwards terminal output to the server when attached.

**Acceptance Criteria:**
- [ ] All PTY output sent via WebSocket (base64 encoded)
- [ ] Messages include session ID and timestamp
- [ ] Output still displays locally (not blocked by remote send)
- [ ] Large outputs chunked appropriately
- [ ] Minimal latency impact on local display

#### FR-2.4.3: Remote Prompt Injection

**Description:** Receives prompts from web clients and injects them into
Claude Code.

**Acceptance Criteria:**
- [ ] Prompt messages from server written to PTY stdin
- [ ] Newline appended to simulate Enter key
- [ ] Prompts appear in local terminal (echoed by Claude Code)
- [ ] Works while Claude Code is waiting for input

#### FR-2.4.4: Reconnection

**Description:** Automatically attempts to reconnect on connection loss.

**Acceptance Criteria:**
- [ ] Detects unexpected disconnection
- [ ] Uses exponential backoff (500ms base, 30s max, 10 attempts)
- [ ] Adds random jitter (0-1000ms) to prevent thundering herd
- [ ] On reconnect success, re-sends session attach message
- [ ] On reconnect failure (exhausted attempts), transitions to detached
- [ ] Displays status during reconnection attempts
- [ ] User can continue using CLI locally during reconnection

#### FR-2.4.5: Message Queuing

**Description:** Buffers outgoing messages during reconnection attempts.

**Acceptance Criteria:**
- [ ] Queue holds up to 100 messages
- [ ] Messages older than 5 minutes are dropped
- [ ] Queue drains on successful reconnection
- [ ] Oldest messages dropped first when queue is full

---

### 2.5 Authentication & Security

#### FR-2.5.1: OAuth Device Flow

**Description:** Uses RFC 8628 Device Authorization Grant for authentication.

**Acceptance Criteria:**
- [ ] Requests device code from `/auth/device`
- [ ] Displays user code and verification URL
- [ ] Polls `/auth/token` at specified interval
- [ ] Handles pending, slow_down, and expired states
- [ ] Stores access and refresh tokens on success

#### FR-2.5.2: Token Management

**Description:** Manages authentication tokens securely.

**Acceptance Criteria:**
- [ ] Access tokens stored in OS keychain
- [ ] Refresh tokens stored in OS keychain
- [ ] Token refresh attempted before expiration
- [ ] Invalid tokens cleared, triggers re-authentication
- [ ] Tokens scoped to single user account

#### FR-2.5.3: Credential Storage

**Description:** Securely stores credentials using OS-native facilities.

**Acceptance Criteria:**
- [ ] macOS: Uses Keychain Services
- [ ] Linux: Uses Secret Service API (libsecret)
- [ ] Windows: Uses Credential Manager
- [ ] Fallback: File-based storage in `~/.config/klaas/` (mode 600)
- [ ] Service name: `dev.klaas.cli`
- [ ] Stored items: access_token, refresh_token, device_id, device_key

#### FR-2.5.4: Device Identity

**Description:** Generates and maintains a unique device identity.

**Acceptance Criteria:**
- [ ] Generates Ed25519 keypair on first run
- [ ] Private key stored in keychain
- [ ] Device ID is ULID format (per global CLAUDE.md requirement)
- [ ] Device name derived from hostname
- [ ] Device registered with server on first attach

---

### 2.6 Session Management

#### FR-2.6.1: Session ID Generation

**Description:** Each CLI invocation creates a unique session.

**Acceptance Criteria:**
- [ ] Session ID generated at startup (ULID format)
- [ ] Session ID remains constant for lifetime of process
- [ ] Session ID included in all server messages

#### FR-2.6.2: Session Metadata

**Description:** CLI tracks and reports session metadata.

**Acceptance Criteria:**
- [ ] Records session start time
- [ ] Tracks current working directory
- [ ] Associates with device ID
- [ ] Reports attach/detach timestamps

---

## 3. Non-Functional Requirements

### 3.1 Performance

| Metric | Requirement |
|--------|-------------|
| Input latency | < 5ms added to native terminal |
| Output latency | < 5ms added to native terminal |
| Memory usage | < 50MB resident |
| Binary size | < 20MB |
| Startup time | < 500ms |

### 3.2 Reliability

- CLI continues functioning if network unavailable
- No data loss during brief disconnections (< 5 minutes)
- Graceful degradation on all error paths
- Terminal always restored on exit

### 3.3 Compatibility

- Works with all Claude Code versions 2.x+
- Compatible with common terminal emulators:
  - macOS: Terminal.app, iTerm2, Alacritty, Kitty
  - Linux: GNOME Terminal, Konsole, xterm, Alacritty, Kitty
  - Windows: Windows Terminal, PowerShell, cmd.exe

---

## 4. Error Handling

### 4.1 Error Categories

| Category | Behavior |
|----------|----------|
| Network errors | Log warning, continue locally, attempt reconnect |
| PTY errors | Fatal: print error, restore terminal, exit |
| Auth errors | Print message, clear tokens, prompt re-auth on next `/attach` |
| Keychain errors | Fall back to file-based storage |
| Claude Code exit | Clean up, exit with same code |

### 4.2 User-Facing Error Messages

All error messages should be:
- Clear and actionable
- Non-technical where possible
- Include recovery steps when applicable

**Examples:**
```
Error: Could not start Claude Code. Is it installed and in your PATH?

Error: Connection lost. Attempting to reconnect...

Error: Authentication expired. Use /attach to reconnect.

Error: Could not save credentials. Using temporary storage.
```

---

## 5. Command-Line Interface

### 5.1 Usage

```
klaas [OPTIONS] [-- CLAUDE_ARGS...]

Options:
  -h, --help       Show help message
  -V, --version    Show version

All other options pass through to Claude Code.
```

### 5.2 Version Output

```
klaas 0.1.0
```

### 5.3 Help Output

```
klaas - Remote access wrapper for Claude Code

USAGE:
    klaas [OPTIONS] [-- CLAUDE_ARGS...]

OPTIONS:
    -h, --help       Print help information
    -V, --version    Print version information

All other options are passed through to Claude Code.

KLAAS COMMANDS (type during session):
    /attach  - Connect for remote access
    /detach  - Disconnect from remote
    /status  - Show connection status
    /help    - Show available commands

EXAMPLES:
    klaas                           # Start Claude Code
    klaas -p "Review this code"     # Start with prompt
    klaas --model sonnet            # Use specific model
```

---

## 6. State Machine

### 6.1 Connection States

```
                    ┌──────────────────┐
                    │    DETACHED      │◀────────────────┐
                    │  (initial state) │                 │
                    └────────┬─────────┘                 │
                             │                           │
                        /attach                     max retries
                             │                      exceeded
                             ▼                           │
                    ┌──────────────────┐                 │
                    │   CONNECTING     │─────────────────┤
                    │                  │    failure      │
                    └────────┬─────────┘                 │
                             │                           │
                        success                          │
                             │                           │
                             ▼                           │
                    ┌──────────────────┐                 │
       ┌───────────▶│    ATTACHED      │                 │
       │            │                  │                 │
       │            └────────┬─────────┘                 │
       │                     │                           │
   reconnect            /detach or                       │
   success           disconnect                          │
       │                     │                           │
       │                     ▼                           │
       │            ┌──────────────────┐                 │
       └────────────│  RECONNECTING    │─────────────────┘
                    │                  │
                    └──────────────────┘
```

### 6.2 Command Interceptor States

```
                    ┌──────────────────┐
       ┌───────────▶│     NORMAL       │◀───────────────┐
       │            │                  │                │
       │            └────────┬─────────┘                │
       │                     │                          │
       │           '/' at line start                    │
       │                     │                          │
       │                     ▼                          │
  timeout or        ┌──────────────────┐          command
  unrecognized      │ READING_COMMAND  │─────────▶ executed
       │            │                  │                │
       │            └──────────────────┘                │
       │                                                │
       └────────────────────────────────────────────────┘
```

---

## 7. Dependencies

### 7.1 Required System Dependencies

- Claude Code CLI (`claude`) installed and in PATH
- Network access for remote features (optional)
- OS keychain service (optional, falls back to file storage)

### 7.2 Build Dependencies (Rust)

| Crate | Purpose |
|-------|---------|
| `portable-pty` | Cross-platform PTY handling |
| `tokio` | Async runtime |
| `tokio-tungstenite` | WebSocket client |
| `keyring` | OS keychain access |
| `serde` / `serde_json` | Message serialization |
| `ulid` | ULID generation |
| `base64` | Output encoding |
| `clap` | Command-line parsing |

---

## 8. Future Considerations (Not in MVP)

The following are explicitly out of scope for MVP but documented for
future reference:

- End-to-end encryption (relay can see traffic in MVP)
- Multiple simultaneous sessions per CLI instance
- Session listing from CLI (web only for MVP)
- Attaching to other sessions from CLI
- Mobile-specific optimizations
- Certificate pinning
- Hardware key support
- Audit logging
- Team/multi-user features
