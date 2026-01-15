# Klaas Deployment Guide

This guide covers deploying all Klaas components:
- **API** - Cloudflare Workers
- **Dashboard** - Cloudflare Pages/Workers
- **CLI** - GitHub Releases (cross-platform binaries)

## Quick Start

Run the automated setup script:

```bash
./scripts/setup-cloudflare.sh
```

This will:
- Create D1 databases (staging + production)
- Create KV namespaces (cache + rate limit for each environment)
- Update `wrangler.toml` with resource IDs
- Run database migrations
- Show you the GitHub secrets to configure

## Prerequisites

- Cloudflare account with `klaas.sh` domain
- GitHub repository with Actions enabled
- Node.js 20+ and Yarn
- Rust toolchain (for local CLI development)
- `jq` installed (for JSON parsing in setup script)

---

## 1. GitHub Secrets

Add these secrets in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Description | How to Get |
|--------|-------------|------------|
| `CLOUDFLARE_API_TOKEN` | API token for Workers, D1, KV, DNS | Cloudflare Dashboard → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Your account identifier | Cloudflare Dashboard → right sidebar |

### Creating the API Token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use "Custom token" with these permissions:
   - **Account → Workers Scripts** → Edit
   - **Account → Workers KV Storage** → Edit
   - **Account → D1** → Edit
   - **Account → Workers R2 Storage** → Edit (for dashboard)
   - **Zone → DNS** → Edit
   - **Zone → Workers Routes** → Edit
4. Set Zone Resources to "Include → Specific zone → klaas.sh"
5. Create and copy the token

---

## 2. Cloudflare Resources

### D1 Databases

Create databases for each environment:

```bash
# From packages/api directory
cd packages/api

# Create databases
wrangler d1 create klaas-db-staging
wrangler d1 create klaas-db-production
```

Note the database IDs from the output and update `wrangler.toml`:

```toml
[env.staging.d1_databases]
[[env.staging.d1_databases]]
binding = "DB"
database_name = "klaas-db-staging"
database_id = "YOUR_STAGING_DB_ID"  # Replace this

[env.production.d1_databases]
[[env.production.d1_databases]]
binding = "DB"
database_name = "klaas-db-production"
database_id = "YOUR_PRODUCTION_DB_ID"  # Replace this
```

### KV Namespaces

Create KV namespaces for rate limiting and caching:

```bash
# Staging
wrangler kv namespace create klaas-cache-staging
wrangler kv namespace create klaas-rate-limit-staging

# Production
wrangler kv namespace create klaas-cache-production
wrangler kv namespace create klaas-rate-limit-production
```

Update `wrangler.toml` with the namespace IDs:

```toml
[env.staging.kv_namespaces]
[[env.staging.kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "YOUR_STAGING_RATE_LIMIT_KV_ID"

[[env.staging.kv_namespaces]]
binding = "CACHE_KV"
id = "YOUR_STAGING_CACHE_KV_ID"

# Same for production...
```

### DNS Setup

In Cloudflare Dashboard for `klaas.sh`:

**Production:**
1. `api` → A record pointing to `192.0.2.1` (proxied)
2. `app` → A record pointing to `192.0.2.1` (proxied)

**Staging:**
3. `api-staging` → A record pointing to `192.0.2.1` (proxied)
4. `app-staging` → A record pointing to `192.0.2.1` (proxied)

The Workers Routes will handle the actual routing.

---

## 3. Database Migrations

Apply migrations to each environment:

```bash
cd packages/api

# Local development
yarn db:migrate

# Staging
wrangler d1 migrations apply klaas-db-staging --env staging --remote

# Production
wrangler d1 migrations apply klaas-db-production --env production --remote
```

---

## 4. API Deployment

### Manual Deployment

```bash
cd packages/api

# Deploy to staging
yarn deploy:staging

# Deploy to production
yarn deploy:production
```

### Automatic Deployment (GitHub Actions)

The workflow in `.github/workflows/deploy-all.yml` handles deployment:

| Trigger | Action |
|---------|--------|
| Push to feature branch | Deploy to staging (if API changed) |
| Merge to main | Deploy to production |
| Pull request | Run tests only (no deploy) |

### Verify Deployment

```bash
# Check API health
curl https://api.klaas.sh/health
curl https://api.klaas.sh/health/db
```

---

## 5. Dashboard Deployment

> **Note**: Dashboard deployment requires OpenNext setup (similar to redirme.com).
> This is currently pending implementation.

### Required Setup (TODO)

1. Add `@opennextjs/cloudflare` dependency
2. Create `wrangler.toml` for dashboard
3. Create R2 bucket for caching
4. Configure `open-next.config.ts`

---

## 6. CLI Distribution

### Release Process

1. **Update version** in `packages/cli/Cargo.toml`
2. **Commit** the version change
3. **Create and push a tag**:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. GitHub Actions automatically:
   - Runs tests
   - Builds binaries for all platforms
   - Creates a GitHub Release

### Supported Platforms

| Platform | Architecture | Artifact |
|----------|--------------|----------|
| macOS | Intel (x86_64) | `klaas-macos-x64.tar.gz` |
| macOS | Apple Silicon (ARM64) | `klaas-macos-arm64.tar.gz` |
| Linux | x64 | `klaas-linux-x64.tar.gz` |
| Linux | ARM64 | `klaas-linux-arm64.tar.gz` |
| Windows | x64 | `klaas-windows-x64.zip` |

### Installation Script

Users can install via:

```bash
curl -fsSL https://klaas.sh/install.sh | bash
```

The install script (`scripts/install.sh`) automatically:
- Detects OS and architecture
- Downloads the correct binary from GitHub Releases
- Installs to `/usr/local/bin` (or `$KLAAS_INSTALL_DIR`)

### Hosting the Install Script

Add the install script to the klaas.sh website at `/install.sh`.

---

## 7. Environment Variables

### API Environment Variables

Set in `wrangler.toml` per environment:

| Variable | Staging | Production |
|----------|---------|------------|
| `ENVIRONMENT` | staging | production |
| `API_VERSION` | v1 | v1 |
| `DASHBOARD_URL` | https://app-staging.klaas.sh | https://app.klaas.sh |

### Dashboard Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | API base URL for the environment |

---

## 8. Deployment Checklist

### First-Time Setup

- [ ] Create Cloudflare API token with required permissions
- [ ] Get Cloudflare Account ID
- [ ] Add `CLOUDFLARE_API_TOKEN` to GitHub secrets
- [ ] Add `CLOUDFLARE_ACCOUNT_ID` to GitHub secrets
- [ ] Create D1 database for staging
- [ ] Create D1 database for production
- [ ] Create KV namespaces (rate limit + cache) for staging
- [ ] Create KV namespaces (rate limit + cache) for production
- [ ] Update `packages/api/wrangler.toml` with all resource IDs
- [ ] Configure DNS records in Cloudflare
- [ ] Apply database migrations to staging
- [ ] Apply database migrations to production
- [ ] Push to main to trigger first production deploy
- [ ] Verify API health endpoints

### CLI Release

- [ ] Update version in `Cargo.toml`
- [ ] Commit version change
- [ ] Create version tag (`git tag v0.1.0`)
- [ ] Push tag (`git push origin v0.1.0`)
- [ ] Verify GitHub Release was created
- [ ] Test installation script

---

## 9. Troubleshooting

### API Deployment Fails

1. Check GitHub Actions logs for specific error
2. Verify Cloudflare API token has all required permissions
3. Ensure all resource IDs in `wrangler.toml` are correct
4. Check that D1 migrations have been applied

### CLI Build Fails

1. Check Rust version compatibility
2. For ARM64 Linux, ensure cross-compilation setup is correct
3. Review clippy warnings - builds fail on warnings

### Database Issues

```bash
# Check migration status
wrangler d1 migrations list klaas-db-production --env production --remote

# Execute SQL directly (debugging)
wrangler d1 execute klaas-db-production --env production --remote --command "SELECT * FROM users LIMIT 5"
```

---

## 10. Useful Commands

```bash
# API
yarn dev:api              # Local development
yarn deploy:api:staging   # Deploy staging
yarn deploy:api:production # Deploy production
yarn db:migrate           # Apply migrations locally

# CLI
cargo build --release     # Build release binary
cargo run                 # Run locally
cargo test                # Run tests
cargo clippy              # Lint

# Full project
yarn pre-commit           # Run all checks before committing
yarn build                # Build all packages
```
