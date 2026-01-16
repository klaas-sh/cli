#!/bin/bash
# Find available port starting from 3001 and run Next.js dev server

PORT=$(npx get-port-cli --port 3001 3002 3003 3004 3005 3006 3007 3008)

# Read API port from shared config file
DEV_PORTS_FILE="../../.dev-ports.json"
if [ -f "$DEV_PORTS_FILE" ]; then
  API_PORT=$(cat "$DEV_PORTS_FILE" | grep -o '"apiPort": *[0-9]*' | grep -o '[0-9]*')
  if [ ! -z "$API_PORT" ]; then
    export NEXT_PUBLIC_DEV_API_PORT=$API_PORT
    echo "Detected API on port $API_PORT"
  fi
fi

echo "Starting dashboard dev server on port $PORT"
next dev --turbopack --port $PORT
