---
"@kgentic-ai/policies-plugin-claude": minor
"@kgentic-ai/policies-shared": patch
---

feat: resolve workspace root via MCP listRoots with process.cwd() fallback

WorkspaceContext class resolves workspace root from server.listRoots() (1s timeout)
instead of relying on process.cwd(). Falls back gracefully when client doesn't
support roots (e.g. Claude Code #3315). evaluatePolicy accepts optional
workspaceRoot for correct path relativization.
