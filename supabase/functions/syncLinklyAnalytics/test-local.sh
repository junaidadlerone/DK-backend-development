#!/bin/bash

# Configuration
# PLEASE SET YOUR LINKLY API KEY HERE
LINKLY_API_KEY="${LINKLY_API_KEY:-ogIivdy75aUk1bTzk8XXow==}"
# Workspace ID from your previous request
LINKLY_WORKSPACE_ID="${LINKLY_WORKSPACE_ID:-339418}" 

if [ "$LINKLY_API_KEY" == "YOUR_API_KEY_HERE" ]; then
  echo "Error: Please set LINKLY_API_KEY in the script or export it as an environment variable."
  exit 1
fi

echo "🚀 Starting Supabase Function locally..."
# Start the function server in the background and log output to serve.log
# We use --no-verify-jwt to verify signature logic isn't the blocker, and assume standard ports
supabase functions serve syncLinklyAnalytics --no-verify-jwt > serve.log 2>&1 &
SERVER_PID=$!

echo "Waiting 5 seconds for server to start..."
sleep 5

echo "📡 Invoking syncLinklyAnalytics..."
echo "Using Workspace ID: $LINKLY_WORKSPACE_ID"

# Call the function
curl -i -X POST 'http://localhost:54321/functions/v1/syncLinklyAnalytics' \
  -H 'Content-Type: application/json' \
  -H "x-linkly-api-key: $LINKLY_API_KEY" \
  -H "x-linkly-workspace-id: $LINKLY_WORKSPACE_ID"

echo ""
echo "✅ Request sent."

echo "🛑 Stopping server..."
kill $SERVER_PID

echo ""
echo "📜 LOGS (serve.log):"
echo "---------------------------------------------------"
cat serve.log
echo "---------------------------------------------------"
