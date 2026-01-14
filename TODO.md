# TODO

## MVP
- cursor is visible in xtermjs again
- history is not preserved
- delete/archive old sessions
- often it says CLI detached in browser although from the terminal it still
  seems to work

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
npx wrangler d1 create nexo-db-staging

# Production
npx wrangler d1 create nexo-db-production
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
  { pattern = "api-staging.nexo.dev/*", zone_name = "nexo.dev" }
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
npx wrangler r2 bucket create nexo-dashboard-cache-staging
npx wrangler r2 bucket create nexo-dashboard-cache-production
```

### DNS Setup

Ensure the `nexo.dev` domain is added to your Cloudflare account. The GitHub
Actions workflow will automatically create DNS records and Worker routes for:

- `api.nexo.dev` / `api-staging.nexo.dev`
- `app.nexo.dev` / `app-staging.nexo.dev`
- `admin.nexo.dev` / `admin-staging.nexo.dev` (when admin package exists)

### CLI Release Process

To release a new CLI version:

```bash
git tag v0.1.0
git push --tags
```

This triggers the workflow to:
1. Build binaries for all platforms (macOS, Linux, Windows)
2. Create a GitHub Release with the binaries attached


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
