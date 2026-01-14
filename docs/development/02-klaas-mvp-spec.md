# Klaas MVP Specification

**Version:** 0.1.0  
**Status:** Draft  
**Last Updated:** January 2025

---

## Overview

Klaas is a cross-platform tool that wraps Claude Code sessions, enabling remote access and control via a web interface. Users run `klaas` in their terminal instead of `claude`, and can optionally attach sessions to the Klaas cloud service for remote access from any browser.

### Core Principles

- **Offline-first:** Running `klaas` works exactly like `claude` with zero network activity by default
- **Opt-in remote:** Users explicitly invoke `/attach` to connect a session to the cloud
- **Frictionless:** No passwords, minimal setup, cross-platform (Windows, macOS, Linux)
- **Secure:** End-to-end encryption for all remote traffic; relay server sees only encrypted blobs

### MVP Scope

The MVP enables a single user to:

1. Wrap Claude Code in a PTY and use it normally
2. Attach a session to Klaas cloud with `/attach`
3. View active sessions in a web dashboard
4. See session output in real-time from the browser
5. Send prompts to sessions from the browser

**Not in MVP:** Multiple users, session sharing, mobile apps, team features, billing.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User's Machine                                │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Klaas CLI (`klaas`)                            │  │
│  │                                                                  │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │  │
│  │  │ PTY Manager │───▶│ Claude Code │    │ Command Interceptor │  │  │
│  │  │             │◀───│  (child)    │    │ (detects /attach)   │  │  │
│  │  └──────┬──────┘    └─────────────┘    └──────────┬──────────┘  │  │
│  │         │                                         │             │  │
│  │         ▼                                         │             │  │
│  │  ┌─────────────────────────────────────┐         │             │  │
│  │  │        I/O Multiplexer              │◀────────┘             │  │
│  │  │  - Forwards to local terminal       │                       │  │
│  │  │  - Forwards to WebSocket (if attached)                      │  │
│  │  └──────────────────┬──────────────────┘                       │  │
│  │                     │                                          │  │
│  └─────────────────────┼──────────────────────────────────────────┘  │
│                        │ (only when attached)                        │
└────────────────────────┼────────────────────────────────────────────┘
                         │ WSS (E2E encrypted)
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge                                  │
│                                                                         │
│  ┌──────────────┐     ┌──────────────────────────────────────────┐     │
│  │   Worker     │     │         Durable Object                   │     │
│  │              │────▶│         (per user)                       │     │
│  │ - Auth       │     │                                          │     │
│  │ - Routing    │     │  - WebSocket hub (CLI ↔ Web clients)     │     │
│  │              │     │  - Session registry                      │     │
│  └──────────────┘     │  - Message routing                       │     │
│                       │  - Offline message queue                 │     │
│  ┌──────────────┐     └──────────────────────────────────────────┘     │
│  │     KV       │                                                      │
│  │ - Auth tokens│     ┌──────────────────────────────────────────┐     │
│  │ - Device IDs │     │              D1                          │     │
│  └──────────────┘     │  - User accounts                         │     │
│                       │  - Device registry                       │     │
│                       │  - Audit log (MVP: minimal)              │     │
│                       └──────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
                         │
                         │ WSS
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Web Client (Browser)                             │
│                                                                         │
│  - Session list                                                         │
│  - Terminal view (xterm.js)                                             │
│  - Prompt input                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Klaas CLI

**Language:** Rust (using `portable-pty`)  
**Distribution:** Single binary for Windows, macOS, Linux

#### Basic Usage

```bash
# Start Claude Code wrapped in Klaas (works offline, no network)
nexo

# Start with a specific prompt
nexo -p "Review this codebase"

# All claude flags pass through
nexo --model sonnet --allowedTools Read,Write
```

#### Commands (intercepted by Klaas, not passed to Claude)

| Command | Description |
|---------|-------------|
| `/attach` | Connect this session to Klaas cloud for remote access |
| `/detach` | Disconnect from Klaas cloud (continue locally) |
| `/status` | Show connection status and session ID |
| `/help` | Show Klaas commands |

#### MVP CLI Features

- [ ] Spawn Claude Code in a PTY
- [ ] Forward all I/O to local terminal
- [ ] Intercept `/` commands at line start
- [ ] `/attach` initiates WebSocket connection to Cloudflare
- [ ] `/detach` closes connection, continues locally
- [ ] `/status` shows attached/detached and session ID
- [ ] Device key generation on first run (stored in OS keychain)
- [ ] OAuth Device Flow for authentication (first `/attach` only)
- [ ] Reconnection with exponential backoff
- [ ] Message queue during brief disconnections

#### MVP CLI Non-Goals

- Session listing from CLI (web only for MVP)
- Attaching to other sessions from CLI
- Multiple simultaneous sessions per CLI instance

---

### 2. Web API (Cloudflare Workers + Durable Objects)

**Base URL:** `https://api.nexo.dev` (placeholder)

#### Authentication

MVP uses OAuth Device Flow (RFC 8628) for initial auth, then short-lived JWTs.

##### Device Flow Endpoints

```
POST /auth/device
Response: { 
  "device_code": "xxx",
  "user_code": "ABCD-1234",
  "verification_uri": "https://nexo.dev/activate",
  "verification_uri_complete": "https://nexo.dev/activate?code=ABCD-1234",
  "expires_in": 900,
  "interval": 5
}

POST /auth/token
Body: { "device_code": "xxx", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" }
Response: { "access_token": "jwt...", "refresh_token": "xxx", "expires_in": 3600 }
```

##### Token Refresh

```
POST /auth/refresh
Body: { "refresh_token": "xxx" }
Response: { "access_token": "jwt...", "refresh_token": "new_xxx", "expires_in": 3600 }
```

#### REST Endpoints

##### Sessions

```
GET /sessions
Response: {
  "sessions": [
    {
      "id": "sess_abc123",
      "device_id": "dev_xyz",
      "device_name": "MacBook Pro",
      "status": "attached",
      "started_at": "2025-01-13T10:00:00Z",
      "attached_at": "2025-01-13T10:05:00Z",
      "cwd": "/Users/mark/projects/nexo"
    }
  ]
}

GET /sessions/:id
Response: { "id": "sess_abc123", ... }
```

#### WebSocket Protocol

**Endpoint:** `wss://api.nexo.dev/ws?session_id=xxx`

##### Connection

1. Client connects with `Authorization: Bearer <jwt>` header
2. Server validates token, associates connection with user
3. For CLI: also sends `X-Device-ID` and `X-Session-ID` headers
4. For Web: optionally sends `X-Subscribe-Sessions` to get updates for multiple sessions

##### Message Types

All messages are JSON with a `type` field.

###### CLI → Server

```json
// Session attached (sent once after /attach)
{
  "type": "session_attach",
  "session_id": "sess_abc123",
  "device_id": "dev_xyz",
  "device_name": "MacBook Pro",
  "cwd": "/Users/mark/projects/nexo"
}

// Terminal output (sent continuously)
{
  "type": "output",
  "session_id": "sess_abc123",
  "data": "base64_encoded_terminal_output",
  "timestamp": "2025-01-13T10:05:00.123Z"
}

// Session detached
{
  "type": "session_detach",
  "session_id": "sess_abc123"
}

// Heartbeat response
{
  "type": "pong"
}
```

###### Server → CLI

```json
// Prompt from web client
{
  "type": "prompt",
  "session_id": "sess_abc123",
  "text": "Please review the authentication module",
  "from": "web",
  "timestamp": "2025-01-13T10:06:00.000Z"
}

// Terminal resize (if web client resizes)
{
  "type": "resize",
  "session_id": "sess_abc123",
  "cols": 120,
  "rows": 40
}

// Heartbeat
{
  "type": "ping"
}
```

###### Web Client → Server

```json
// Subscribe to session(s)
{
  "type": "subscribe",
  "session_ids": ["sess_abc123"]
}

// Send prompt to session
{
  "type": "prompt",
  "session_id": "sess_abc123",
  "text": "Please review the authentication module"
}

// Resize terminal view
{
  "type": "resize",
  "session_id": "sess_abc123",
  "cols": 120,
  "rows": 40
}
```

###### Server → Web Client

```json
// Session list update
{
  "type": "sessions_update",
  "sessions": [...]
}

// Terminal output (forwarded from CLI)
{
  "type": "output",
  "session_id": "sess_abc123",
  "data": "base64_encoded_terminal_output",
  "timestamp": "2025-01-13T10:05:00.123Z"
}

// Session attached/detached
{
  "type": "session_status",
  "session_id": "sess_abc123",
  "status": "attached" | "detached"
}
```

#### Error Handling

```json
{
  "type": "error",
  "code": "SESSION_NOT_FOUND" | "UNAUTHORIZED" | "RATE_LIMITED" | "INVALID_MESSAGE",
  "message": "Human-readable error message"
}
```

#### Rate Limits (MVP)

| Limit | Value |
|-------|-------|
| WebSocket connections per user | 10 |
| Messages per second per session | 100 |
| REST API requests per minute | 60 |

---

### 3. Web Client

**Stack:** React + TypeScript + xterm.js  
**Hosting:** Cloudflare Pages at `https://nexo.dev`

#### Pages

##### Login (`/login`)

- "Sign in with GitHub" button (MVP: GitHub OAuth only)
- Shows device code flow for CLI authentication

##### Dashboard (`/`)

- List of attached sessions
- Each session shows:
  - Device name
  - Working directory
  - Attached duration
  - Status indicator (connected/disconnected)
- Click session → opens terminal view

##### Session View (`/session/:id`)

- Full-screen terminal (xterm.js)
- Shows real-time output from CLI
- Input field at bottom for sending prompts
- "Send" button or Enter to send prompt
- Back button to return to dashboard

#### MVP Web Features

- [ ] GitHub OAuth login
- [ ] Session list with real-time updates
- [ ] Terminal view with xterm.js
- [ ] Real-time output streaming
- [ ] Prompt input and send
- [ ] Basic responsive layout (desktop-first)
- [ ] Connection status indicator

#### MVP Web Non-Goals

- Session history/scrollback persistence
- Multiple terminal tabs
- Session search/filter
- Settings/preferences
- Mobile-optimized layout

---

## Data Models

### User

```typescript
interface User {
  id: string;              // "user_xxx"
  github_id: string;       // GitHub user ID
  github_username: string;
  email: string;
  created_at: string;      // ISO 8601
}
```

### Device

```typescript
interface Device {
  id: string;              // "dev_xxx"
  user_id: string;
  name: string;            // e.g., "MacBook Pro"
  public_key: string;      // Ed25519 public key (for future E2E)
  created_at: string;
  last_seen_at: string;
}
```

### Session

```typescript
interface Session {
  id: string;              // "sess_xxx"
  user_id: string;
  device_id: string;
  status: "attached" | "detached";
  cwd: string;             // Working directory
  started_at: string;      // When nexo was launched
  attached_at: string | null;
  detached_at: string | null;
}
```

---

## Security (MVP)

### Authentication

- **Web:** GitHub OAuth 2.0
- **CLI:** OAuth Device Flow → JWT
- **Tokens:** Short-lived access tokens (1 hour), refresh tokens (30 days)
- **Storage:** 
  - CLI: OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
  - Web: httpOnly cookies

### Transport Security

- All connections over TLS 1.3
- WebSocket upgrade requires valid JWT

### MVP Security Non-Goals (Future)

- End-to-end encryption (relay can see traffic in MVP)
- Certificate pinning
- Hardware key support
- Audit logging

---

## Implementation Phases

### Phase 1: Local CLI Only (Week 1)

- [ ] Rust project setup with `portable-pty`
- [ ] Spawn Claude Code as child process
- [ ] Forward stdin/stdout/stderr
- [ ] Implement `/help` and `/status` commands
- [ ] Test on macOS, Linux, Windows

### Phase 2: Cloudflare Backend (Week 2)

- [ ] Worker with OAuth Device Flow
- [ ] Durable Object for WebSocket handling
- [ ] Session registry in DO state
- [ ] Message routing between CLI and web clients
- [ ] KV for auth tokens
- [ ] D1 schema for users and devices

### Phase 3: CLI Remote Features (Week 3)

- [ ] `/attach` command with OAuth Device Flow
- [ ] WebSocket client with reconnection
- [ ] Device key generation and keychain storage
- [ ] Output streaming to server
- [ ] Receive and inject prompts from server

### Phase 4: Web Client (Week 4)

- [ ] React app with routing
- [ ] GitHub OAuth login
- [ ] Session list view
- [ ] Terminal view with xterm.js
- [ ] Prompt input
- [ ] Deploy to Cloudflare Pages

### Phase 5: Polish & Testing (Week 5)

- [ ] Error handling and edge cases
- [ ] Reconnection testing
- [ ] Cross-platform CLI testing
- [ ] Basic documentation
- [ ] README and installation instructions

---

## Open Questions

1. **Session persistence:** Should we store session output for later viewing, or is real-time only acceptable for MVP?
   - *Leaning:* Real-time only for MVP

2. **Multiple sessions per device:** Should `klaas` support multiple simultaneous sessions on one machine?
   - *Leaning:* No, one session per `klaas` process. User can run multiple terminals.

3. **Session naming:** Should users be able to name sessions, or auto-generate?
   - *Leaning:* Auto-generate for MVP (e.g., device name + timestamp)

4. **Detach behavior:** When CLI disconnects ungracefully, how long before session is marked detached?
   - *Leaning:* 30 seconds of no heartbeat

---

## CLI Functional Specification

This section provides implementation-level detail for the CLI.

### Startup Sequence

```
1. Parse command line arguments
2. Check if `--help` or `--version` → print and exit
3. Generate session ID (UUID v4)
4. Put local terminal into raw mode
5. Spawn Claude Code in PTY with remaining args
6. Start I/O loop (main loop)
7. On exit: restore terminal, cleanup
```

### Terminal Raw Mode

The CLI must put the user's terminal into raw mode to intercept individual keystrokes:

```rust
// Pseudocode
let original_termios = tcgetattr(stdin)?;
let mut raw = original_termios.clone();
raw.local_flags.remove(LocalFlags::ICANON);  // Disable line buffering
raw.local_flags.remove(LocalFlags::ECHO);    // We'll echo ourselves
tcsetattr(stdin, TCSANOW, &raw)?;

// On exit (including panic):
tcsetattr(stdin, TCSANOW, &original_termios)?;
```

### I/O Loop (Main Loop)

The main loop handles three event sources concurrently:

```
┌─────────────────────────────────────────────────────────────┐
│                      Main I/O Loop                          │
│                                                             │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐  │
│   │ User stdin  │   │ PTY output  │   │ WebSocket recv  │  │
│   │ (keyboard)  │   │ (Claude)    │   │ (if attached)   │  │
│   └──────┬──────┘   └──────┬──────┘   └────────┬────────┘  │
│          │                 │                    │           │
│          ▼                 ▼                    ▼           │
│   ┌─────────────────────────────────────────────────────┐  │
│   │              Event Multiplexer (select/poll)        │  │
│   └─────────────────────────────────────────────────────┘  │
│                            │                               │
│          ┌─────────────────┼─────────────────┐            │
│          ▼                 ▼                 ▼            │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐     │
│   │ Command    │    │ Output     │    │ Remote     │     │
│   │ Interceptor│    │ Forwarder  │    │ Handler    │     │
│   └────────────┘    └────────────┘    └────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

**Event priorities:**
1. PTY output → forward to local terminal (+ WebSocket if attached)
2. User stdin → process through command interceptor
3. WebSocket messages → handle prompts, pings, errors

### Command Interceptor State Machine

The interceptor detects `/` commands without interfering with normal input.

```
States:
  NORMAL          - Default state, forwarding input
  READING_COMMAND - Buffering potential command after `/`

Transitions:
  NORMAL + '/' at line start     → READING_COMMAND, start buffer, start 100ms timer
  NORMAL + any other char        → stay NORMAL, forward char, update line-start flag
  NORMAL + '\n' or '\r'          → stay NORMAL, forward char, set line-start = true
  
  READING_COMMAND + '\n' or '\r' → check buffer, execute or forward, → NORMAL
  READING_COMMAND + backspace    → modify buffer (if not empty, else → NORMAL + forward)
  READING_COMMAND + timeout      → forward '/' + buffer contents, → NORMAL
  READING_COMMAND + space        → check buffer for command, execute or forward all
  READING_COMMAND + other char   → append to buffer

Line-start detection:
  - true at session start
  - true after '\n' or '\r'
  - false after any other character
```

**Command matching:**

```rust
fn match_command(buffer: &str) -> Option<Command> {
    match buffer.to_lowercase().as_str() {
        "attach" => Some(Command::Attach),
        "detach" => Some(Command::Detach),
        "status" => Some(Command::Status),
        "help"   => Some(Command::Help),
        _        => None
    }
}
```

**Double-slash escape:** If user types `//`, forward a single `/` to Claude and return to NORMAL.

### Command Behaviors

#### `/attach`

```
1. If already attached:
   - Print "Already attached. Session ID: {id}"
   - Return

2. Check for stored credentials in keychain:
   - If valid token exists → skip to step 5
   - If refresh token exists → attempt refresh → if success, skip to step 5

3. Start OAuth Device Flow:
   - POST /auth/device
   - Print "To attach this session, visit: {verification_uri}"
   - Print "Enter code: {user_code}"
   - Print QR code (if terminal supports it)
   - Poll POST /auth/token every {interval} seconds
   - On success → store tokens in keychain

4. Register device (first time only):
   - Generate Ed25519 keypair
   - Store private key in keychain
   - POST /devices with public key and device name

5. Connect WebSocket:
   - URL: wss://api.nexo.dev/ws
   - Headers: Authorization: Bearer {token}, X-Device-ID: {device_id}
   - On connect success:
     - Send session_attach message
     - Set state to ATTACHED
     - Print "✓ Attached. Session ID: {session_id}"
   - On connect failure:
     - Print error
     - Remain in DETACHED state
```

#### `/detach`

```
1. If not attached:
   - Print "Not attached."
   - Return

2. Send session_detach message over WebSocket
3. Close WebSocket connection gracefully
4. Set state to DETACHED
5. Print "Detached. Continuing locally."
```

#### `/status`

```
1. Print "Session ID: {session_id}"
2. Print "Status: {ATTACHED|DETACHED}"
3. If attached:
   - Print "Connected to: api.nexo.dev"
   - Print "Device: {device_name}"
4. Print "Working directory: {cwd}"
```

#### `/help`

```
Print:
  Klaas Commands:
    /attach  - Connect this session for remote access
    /detach  - Disconnect from remote (continue locally)  
    /status  - Show connection status
    /help    - Show this help

  All other input is sent to Claude Code.
  Type // to send a literal /
```

### Output Forwarding

All PTY output is:
1. Written to local stdout (always)
2. Sent via WebSocket (if attached)

```rust
fn handle_pty_output(data: &[u8], state: &mut State) {
    // Always write to local terminal
    stdout().write_all(data)?;
    stdout().flush()?;
    
    // Forward to WebSocket if attached
    if let Some(ws) = &mut state.websocket {
        let msg = OutputMessage {
            type_: "output",
            session_id: &state.session_id,
            data: base64::encode(data),
            timestamp: Utc::now().to_rfc3339(),
        };
        ws.send(serde_json::to_string(&msg)?)?;
    }
}
```

### Remote Prompt Injection

When a prompt arrives via WebSocket:

```rust
fn handle_remote_prompt(prompt: &str, pty: &mut Pty) {
    // Write prompt text to PTY stdin (sends to Claude Code)
    pty.write_all(prompt.as_bytes())?;
    pty.write_all(b"\n")?;  // Press enter
    pty.flush()?;
}
```

### WebSocket Reconnection

```
On disconnect (unexpected):
  1. Set state to RECONNECTING
  2. Start reconnection loop:
     
     attempt = 0
     while attempt < MAX_ATTEMPTS (10):
       delay = min(500ms * 2^attempt + random(0-1000ms), 30s)
       sleep(delay)
       try connect:
         if success:
           send session_attach
           set state to ATTACHED
           return
         attempt += 1
     
     set state to DETACHED
     print "Connection lost. Use /attach to reconnect."
```

### Message Queue (During Reconnection)

While in RECONNECTING state, buffer outgoing messages:

```rust
struct MessageQueue {
    messages: VecDeque<QueuedMessage>,
    max_size: usize,        // 100 messages
    max_age: Duration,      // 5 minutes
}

impl MessageQueue {
    fn push(&mut self, msg: Message) {
        if self.messages.len() >= self.max_size {
            self.messages.pop_front();  // Drop oldest
        }
        self.messages.push_back(QueuedMessage {
            message: msg,
            timestamp: Instant::now(),
        });
    }
    
    fn flush(&mut self, ws: &mut WebSocket) {
        let now = Instant::now();
        while let Some(queued) = self.messages.pop_front() {
            if now.duration_since(queued.timestamp) < self.max_age {
                ws.send(&queued.message)?;
            }
            // else: drop stale message
        }
    }
}
```

### Credential Storage

```rust
// Keychain service name
const SERVICE: &str = "dev.nexo.cli";

// Stored items:
// - "access_token"  → JWT access token
// - "refresh_token" → Refresh token  
// - "device_id"     → Device UUID
// - "device_key"    → Ed25519 private key (base64)

fn store_credential(key: &str, value: &str) -> Result<()> {
    keyring::Entry::new(SERVICE, key)?.set_password(value)
}

fn get_credential(key: &str) -> Result<Option<String>> {
    match keyring::Entry::new(SERVICE, key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
```

### Graceful Shutdown

On SIGINT, SIGTERM, or Claude Code exit:

```
1. If attached:
   - Send session_detach message
   - Close WebSocket gracefully (close frame)
2. Restore terminal to original mode
3. Exit with Claude Code's exit code
```

### Error Handling Principles

1. **Network errors** → Log warning, continue locally, attempt reconnection
2. **PTY errors** → Fatal, print error, exit
3. **Auth errors** → Print message, clear stored tokens, prompt re-auth on next /attach
4. **Keychain errors** → Fall back to file-based storage in `~/.config/nexo/`

---

## Appendix: File Structure

```
nexo/
├── packages/
│   ├── cli/                    # Rust CLI
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── pty.rs          # PTY management
│   │       ├── interceptor.rs  # Command interception state machine
│   │       ├── websocket.rs    # WebSocket client + reconnection
│   │       ├── auth.rs         # OAuth Device Flow
│   │       ├── keychain.rs     # Secure credential storage
│   │       ├── commands.rs     # /attach, /detach, /status, /help handlers
│   │       └── types.rs        # Shared types and message definitions
│   │
│   ├── worker/                 # Cloudflare Worker
│   │   ├── wrangler.toml
│   │   └── src/
│   │       ├── index.ts        # Worker entry point
│   │       ├── auth.ts         # OAuth handlers
│   │       ├── durable/
│   │       │   └── session-hub.ts  # Durable Object
│   │       └── types.ts
│   │
│   └── web/                    # React web client
│       ├── package.json
│       └── src/
│           ├── App.tsx
│           ├── pages/
│           │   ├── Login.tsx
│           │   ├── Dashboard.tsx
│           │   └── Session.tsx
│           ├── components/
│           │   ├── SessionList.tsx
│           │   └── Terminal.tsx
│           └── hooks/
│               └── useWebSocket.ts
│
├── docs/
│   └── mvp-spec.md             # This document
│
├── README.md
└── .gitignore
```
