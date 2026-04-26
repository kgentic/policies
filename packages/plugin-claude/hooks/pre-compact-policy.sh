#!/usr/bin/env bash
set -euo pipefail

node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/runner.js" pre-compact
