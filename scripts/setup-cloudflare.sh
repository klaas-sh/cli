#!/bin/bash

# Klaas Cloudflare Setup Script
# This script automates the initial Cloudflare resource creation

set -e

echo "Klaas Cloudflare Setup Script"
echo "=============================="
echo

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Wrangler CLI not found. Please install it first:"
    echo "   npm install -g wrangler"
    exit 1
fi

# Check if user is logged in
if ! wrangler whoami &> /dev/null; then
    echo "Please log in to Cloudflare first:"
    wrangler login
fi

echo "Wrangler CLI ready"
echo

# Get the script directory and navigate to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Create D1 Databases
echo "Creating D1 Databases..."
echo "Checking for existing databases..."
DB_LIST=$(wrangler d1 list)
echo "Database list:"
echo "$DB_LIST"
echo

# Function to create or get D1 database
create_or_get_db() {
    local db_name="$1"
    local var_name="$2"

    echo "Processing $db_name database..."

    # Check if database exists
    local existing_db=$(echo "$DB_LIST" | grep "$db_name" || echo "")
    local db_id=""

    if [ -n "$existing_db" ]; then
        echo "Database '$db_name' already exists, extracting ID..."
        db_id=$(echo "$existing_db" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
        echo "Found existing D1 Database with ID: $db_id"
    else
        echo "Creating new $db_name database..."
        local db_output=$(wrangler d1 create "$db_name")
        echo "Database creation output:"
        echo "$db_output"
        db_id=$(echo "$db_output" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
        echo "D1 Database created with ID: $db_id"
    fi

    if [ -z "$db_id" ]; then
        echo "Could not extract database ID. Please check the output above."
        exit 1
    fi

    # Set the variable dynamically
    eval "$var_name='$db_id'"
    echo
}

# Create databases for staging and production
create_or_get_db "klaas-db-staging" "DB_ID_STAGING"
create_or_get_db "klaas-db-production" "DB_ID_PROD"

# Create KV Namespaces
echo "Creating KV Namespaces..."
echo "Getting current KV namespaces..."
KV_LIST=$(wrangler kv namespace list)
echo "KV namespace list:"
echo "$KV_LIST"
echo

# Function to create or get KV namespace
create_or_get_kv() {
    local namespace_name="$1"
    local var_name="$2"

    echo "Processing $namespace_name namespace..."

    # Check if namespace exists and extract ID from JSON
    local kv_id=$(echo "$KV_LIST" | jq -r ".[] | select(.title==\"$namespace_name\") | .id" 2>/dev/null || echo "")

    if [ -n "$kv_id" ] && [ "$kv_id" != "null" ]; then
        echo "Namespace '$namespace_name' already exists, using existing ID..."
        echo "Found existing $namespace_name KV with ID: $kv_id"
    else
        echo "Creating $namespace_name namespace..."
        local kv_output=$(wrangler kv namespace create "$namespace_name")
        echo "$kv_output"
        kv_id=$(echo "$kv_output" | grep -oE '[a-f0-9]{32}')
        echo "$namespace_name KV created with ID: $kv_id"
    fi

    # Set the variable dynamically
    eval "$var_name='$kv_id'"
    echo
}

# Create all KV namespaces for staging and production
create_or_get_kv "klaas-cache-staging" "CACHE_STAGING_ID"
create_or_get_kv "klaas-rate-limit-staging" "RATE_LIMIT_STAGING_ID"
create_or_get_kv "klaas-cache-production" "CACHE_PROD_ID"
create_or_get_kv "klaas-rate-limit-production" "RATE_LIMIT_PROD_ID"

# Update wrangler.toml with actual IDs
echo "Updating wrangler.toml configuration..."

cd "$PROJECT_ROOT/packages/api"

# Create backup
cp wrangler.toml wrangler.toml.backup
echo "Created backup: wrangler.toml.backup"

# Update staging database ID
sed -i '' "s/database_id = \"placeholder-staging-db-id\"/database_id = \"$DB_ID_STAGING\"/g" wrangler.toml
# Also try updating existing IDs if they were already set
sed -i '' "s/database_name = \"klaas-db-staging\"\ndatabase_id = \"[a-f0-9-]*\"/database_name = \"klaas-db-staging\"\ndatabase_id = \"$DB_ID_STAGING\"/g" wrangler.toml 2>/dev/null || true

# Update production database ID
sed -i '' "s/database_id = \"placeholder-production-db-id\"/database_id = \"$DB_ID_PROD\"/g" wrangler.toml

# Update staging KV IDs
sed -i '' "s/id = \"placeholder-staging-rate-limit\"/id = \"$RATE_LIMIT_STAGING_ID\"/g" wrangler.toml
sed -i '' "s/id = \"placeholder-staging-cache\"/id = \"$CACHE_STAGING_ID\"/g" wrangler.toml

# Update production KV IDs
sed -i '' "s/id = \"placeholder-production-rate-limit\"/id = \"$RATE_LIMIT_PROD_ID\"/g" wrangler.toml
sed -i '' "s/id = \"placeholder-production-cache\"/id = \"$CACHE_PROD_ID\"/g" wrangler.toml

# Update local/dev KV IDs (use staging for local dev)
sed -i '' "s/id = \"placeholder-rate-limit\"/id = \"$RATE_LIMIT_STAGING_ID\"/g" wrangler.toml
sed -i '' "s/id = \"placeholder-cache\"/id = \"$CACHE_STAGING_ID\"/g" wrangler.toml
sed -i '' "s/preview_id = \"placeholder-rate-limit-preview\"/preview_id = \"$RATE_LIMIT_STAGING_ID\"/g" wrangler.toml
sed -i '' "s/preview_id = \"placeholder-cache-preview\"/preview_id = \"$CACHE_STAGING_ID\"/g" wrangler.toml

echo "Updated API wrangler.toml with resource IDs"
echo

cd "$PROJECT_ROOT"

# Get account info for GitHub secrets
WHOAMI_OUTPUT=$(wrangler whoami)
# Extract account ID from the table format - look for 32-character hex string
ACCOUNT_ID=$(echo "$WHOAMI_OUTPUT" | grep -oE '[a-f0-9]{32}' | head -1)

echo
echo "Cloudflare setup complete!"
echo "=========================="
echo
echo "Summary of created resources:"
echo ""
echo "   Staging Environment:"
echo "     - Worker: klaas-api-staging"
echo "     - Routes: api-staging.klaas.sh, app-staging.klaas.sh"
echo "     - D1 Database: klaas-db-staging (ID: $DB_ID_STAGING)"
echo "     - Rate Limit KV: klaas-rate-limit-staging (ID: $RATE_LIMIT_STAGING_ID)"
echo "     - Cache KV: klaas-cache-staging (ID: $CACHE_STAGING_ID)"
echo "     - Durable Object: klaas-api-staging_SessionHub"
echo ""
echo "   Production Environment:"
echo "     - Worker: klaas-api-production"
echo "     - Routes: api.klaas.sh, app.klaas.sh"
echo "     - D1 Database: klaas-db-production (ID: $DB_ID_PROD)"
echo "     - Rate Limit KV: klaas-rate-limit-production (ID: $RATE_LIMIT_PROD_ID)"
echo "     - Cache KV: klaas-cache-production (ID: $CACHE_PROD_ID)"
echo "     - Durable Object: klaas-api-production_SessionHub"
echo ""
echo "   Account ID: $ACCOUNT_ID"
echo
echo "GitHub Repository Secrets to add:"
echo "   CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID"
echo "   CLOUDFLARE_API_TOKEN=<your-api-token>"
echo
echo "Important: You still need to:"
echo "   1. Add the secrets to your GitHub repository"
echo "   2. Ensure klaas.sh zone is configured in Cloudflare"
echo "   3. Database migrations will run automatically via GitHub Actions"
echo "   4. Set worker secrets for each environment:"
echo ""
echo "      # Generate a JWT secret"
echo "      openssl rand -base64 32"
echo ""
echo "      # Staging"
echo "      cd packages/api && npx wrangler secret put JWT_SECRET --env staging"
echo ""
echo "      # Production"
echo "      cd packages/api && npx wrangler secret put JWT_SECRET --env production"
echo
