# TODO


## MVP
- sessions overview last active time in seconds/minutes/hours/days. it's not
  accurate, current session already says 1 hour ago
- cursor is visible in xtermjs again
- history is not preserved
- delete/archive old sessions

plugin suggestions
/plugin marketplace add anthropics/claude-code
/plugin install frontend-design@claude-code-plugins

## OTHERS
https://dev.to/rajeshroyal/claude-code-remote-your-ai-anywhere-you-go-l94
https://teleportation.dev/
    teleportation alternatives: https://claude.ai/chat/840ab361-c51b-4318-8e47-e089df04677d

https://agentclientprotocol.com/
https://github.com/coder/agentapi

### CLI tools
- https://claude.ai/chat/98301e76-f191-4b7a-ac7e-6642ed2c77bd
- https://kilo.ai/
- https://github.com/anthropics/claude-code/tree/main

### CLI Background Reconnection

The CLI should periodically retry connecting to the API when offline, enabling
seamless reconnection for approved devices.

**Current behavior:**
- CLI fails to start if API is unreachable during authentication
- User must restart CLI to reconnect

**Desired behavior:**
1. CLI starts in offline mode if API is unreachable (show warning)
2. Background task retries connection with exponential backoff (5s → 10s → 30s → 60s max)
3. When connection succeeds:
   - If device has stored valid token: reconnect transparently, show "Syncing resumed"
   - If token expired/invalid: show new device code for re-approval
4. If connection drops mid-session: automatic reconnection using same logic

**Implementation:**
- Add `try_authenticate()` that returns `Option<String>` instead of failing
- Add background tokio task for periodic retry
- Use existing `handle_reconnection()` infrastructure
- Store backoff state in `ConnectionState` or separate struct

## v1.1

### Remote Image Paste from Browser

Currently, image paste only works when browser and CLI are on the same machine
(they share the system clipboard). For true remote access, we need to send
image data from browser to CLI.

**Implementation:**
1. Browser: Detect image paste via Clipboard API
2. Browser: Read image data, base64 encode
3. Browser → Server: Send via WebSocket as new `image` message type
4. Server → CLI: Forward image data
5. CLI: Save to temp file, copy to system clipboard
6. CLI: Send bracketed paste sequence to Claude Code
7. Claude Code: Checks clipboard, finds image → `[Image #N]`

**Changes needed:**
- Dashboard terminal component: Add paste event listener for images
- WebSocket protocol: Add `image` message type to types
- SessionHub DO: Forward image messages to CLI
- CLI websocket.rs: Handle incoming image messages
- CLI: Use `pbcopy` (macOS) / `xclip` (Linux) to copy image to clipboard

## Deployment Setup

Before the GitHub Actions workflow can deploy to Cloudflare, the following
resources need to be created and configured.

### GitHub Repository Secrets

Add these secrets to the GitHub repository (Settings > Secrets and variables):

- `CLOUDFLARE_API_TOKEN` - API token with Workers/D1/KV/R2 permissions
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

### API Package Setup

#### 1. Create D1 Databases

```bash
# Staging
npx wrangler d1 create klaas-db-staging

# Production
npx wrangler d1 create klaas-db-production
```

Update `packages/api/wrangler.toml` with the returned database IDs.

#### 2. Create KV Namespaces

```bash
# Staging
npx wrangler kv:namespace create RATE_LIMIT_KV --env staging
npx wrangler kv:namespace create CACHE_KV --env staging

# Production
npx wrangler kv:namespace create RATE_LIMIT_KV --env production
npx wrangler kv:namespace create CACHE_KV --env production
```

Update `packages/api/wrangler.toml` with the returned namespace IDs.

#### 3. Set Secrets

```bash
# Staging
npx wrangler secret put JWT_SECRET --env staging

# Production
npx wrangler secret put JWT_SECRET --env production
```

#### 4. Update wrangler.toml

Add staging routes to `packages/api/wrangler.toml`:

```toml
[env.staging]
routes = [
  { pattern = "api-staging.klaas.sh/*", zone_name = "klaas.sh" }
]
```

### Dashboard Package Setup

#### 1. Install OpenNext for Cloudflare

```bash
cd packages/dashboard
yarn add -D @opennextjs/cloudflare
```

#### 2. Add Build Scripts

Update `packages/dashboard/package.json`:

```json
{
  "scripts": {
    "build:cf": "yarn clean && opennextjs-cloudflare build",
    "clean": "rm -rf .next .open-next"
  }
}
```

#### 3. Create wrangler.toml

Create `packages/dashboard/wrangler.toml` with:

- OpenNext configuration (`main = ".open-next/worker.js"`)
- D1 database bindings (if needed)
- KV namespaces for caching, rate limiting, sessions
- R2 bucket for cache
- Durable Objects for OpenNext (DOQueueHandler, DOShardedTagCache, BucketCachePurge)
- Assets configuration
- Staging and production environments with routes

Reference: `/Users/bjorn/projects/smoking-media/redirme.com/packages/dashboard/wrangler.toml`

#### 4. Create KV Namespaces

```bash
# Staging
npx wrangler kv:namespace create CACHE --env staging
npx wrangler kv:namespace create RATE_LIMITER --env staging
npx wrangler kv:namespace create SESSIONS --env staging

# Production
npx wrangler kv:namespace create CACHE --env production
npx wrangler kv:namespace create RATE_LIMITER --env production
npx wrangler kv:namespace create SESSIONS --env production
```

#### 5. Create R2 Buckets

```bash
npx wrangler r2 bucket create klaas-dashboard-cache-staging
npx wrangler r2 bucket create klaas-dashboard-cache-production
```

### DNS Setup

Ensure the `klaas.sh` domain is added to your Cloudflare account. The GitHub
Actions workflow will automatically create DNS records and Worker routes for:

- `api.klaas.sh` / `api-staging.klaas.sh`
- `app.klaas.sh` / `app-staging.klaas.sh`
- `admin.klaas.sh` / `admin-staging.klaas.sh` (when admin package exists)

### CLI Release Process

To release a new CLI version:

```bash
git tag v0.1.0
git push --tags
```

This triggers the workflow to:
1. Build binaries for all platforms (macOS, Linux, Windows)
2. Create a GitHub Release with the binaries attached

### CLI Installation Script

The `scripts/install.sh` script allows users to install klaas via curl:

```bash
curl -fsSL https://klaas.sh/install.sh | bash
```

**To set up the redirect from klaas.sh/install.sh:**

Option 1: Cloudflare redirect rule (recommended)
- In Cloudflare dashboard for klaas.sh
- Add a redirect rule: `klaas.sh/install.sh` ->
  `https://raw.githubusercontent.com/smoking-media/klaas/main/scripts/install.sh`

Option 2: Hugo site redirect
- In the hugo-sites project, add a redirect in `_redirects` or `netlify.toml`

Option 3: API worker
- Add a route in the API worker to serve the install script


## Future Features

### Full Session History (Premium Feature)

Currently, terminal output is kept in an in-memory ring buffer (256KB) that
provides scroll-back for recently connected web clients. However, this buffer
is lost when the Durable Object hibernates (after all connections close).

**For paying customers**, implement persistent full session history:

- Store complete terminal output to R2 or DO Storage
- Allow scrolling back through entire session history
- Provide session transcript downloads
- Consider compression for storage efficiency (terminal output compresses well)
- Add retention policies (e.g., 30 days for pro, 90 days for enterprise)

This would require:
1. Periodic writes to persistent storage (R2 recommended for large histories)
2. Chunked storage with index for efficient retrieval
3. API endpoint for fetching historical chunks
4. Dashboard UI for loading history on scroll
