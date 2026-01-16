#!/bin/bash
# Find available port starting from 8787 and run Wrangler dev server

PORT=$(npx get-port-cli --port 8787 8788 8789 8790 8791 8792 8793 8794)
echo "Starting API dev server on port $PORT"

# Write port to shared config file for dashboard to discover
echo "{\"apiPort\": $PORT, \"dashboardPort\": null}" > ../../.dev-ports.json

wrangler dev --local --port $PORT
