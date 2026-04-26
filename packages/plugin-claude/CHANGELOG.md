# @kgentic-ai/policies-plugin-claude

## 0.4.0

### Minor Changes

- 78fb328: feat: migrate CC integration layer — hooks, skills, packs, templates, CLAUDE.md

## 0.3.0

### Minor Changes

- 37e4641: feat: resolve workspace root via MCP listRoots with process.cwd() fallback

  WorkspaceContext class resolves workspace root from server.listRoots() (1s timeout)
  instead of relying on process.cwd(). Falls back gracefully when client doesn't
  support roots (e.g. Claude Code #3315). evaluatePolicy accepts optional
  workspaceRoot for correct path relativization.

### Patch Changes

- Updated dependencies [37e4641]
  - @kgentic-ai/policies-shared@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [446861d]
  - @kgentic-ai/policies-shared@0.3.0

## 0.2.0

### Minor Changes

- 23a8020: feat: initial release — CLI registry, shared evaluator engine, Claude plugin, MCP server

### Patch Changes

- Updated dependencies [23a8020]
  - @kgentic-ai/policies-shared@0.2.0
