#!/usr/bin/env bash
set -euo pipefail

MODE="user-prompt-submit"

# Read stdin into variable (hook payload)
PAYLOAD=$(cat)

# Try HTTP bridge first: extract cwd from payload to locate the port file.
# This grep pattern handles standard paths (no embedded double-quotes or
# backslashes). If extraction fails, the fast-path is skipped gracefully
# and the node runner fallback handles evaluation correctly.
CWD=$(echo "$PAYLOAD" | grep -o '"cwd":"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"')

PORT_FILE=""
if [ -n "$CWD" ] && [ -f "${CWD}/.policy/.port" ]; then
  PORT_FILE="${CWD}/.policy/.port"
elif [ -f "${CLAUDE_PLUGIN_ROOT}/.policy/.port" ]; then
  PORT_FILE="${CLAUDE_PLUGIN_ROOT}/.policy/.port"
fi

if [ -n "$PORT_FILE" ]; then
  PORT=$(cat "$PORT_FILE")
  RESPONSE=$(curl -s --max-time 2 \
    -X POST "http://localhost:${PORT}/evaluate" \
    -H "Content-Type: application/json" \
    --data-binary "{\"mode\":\"${MODE}\",\"payload\":${PAYLOAD}}" \
    2>/dev/null) && {
    echo "$RESPONSE"
    exit 0
  }
fi

# Fallback: spawn node process
echo "$PAYLOAD" | node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/runner.js" "$MODE"
