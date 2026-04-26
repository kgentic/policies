# @kgentic-ai/policies-shared

## 0.3.1

### Patch Changes

- 37e4641: feat: resolve workspace root via MCP listRoots with process.cwd() fallback

  WorkspaceContext class resolves workspace root from server.listRoots() (1s timeout)
  instead of relying on process.cwd(). Falls back gracefully when client doesn't
  support roots (e.g. Claude Code #3315). evaluatePolicy accepts optional
  workspaceRoot for correct path relativization.

## 0.3.0

### Minor Changes

- 446861d: feat: accept v2 policy manifest format (policies array with inline hooks)

## 0.2.0

### Minor Changes

- 23a8020: feat: initial release — CLI registry, shared evaluator engine, Claude plugin, MCP server
