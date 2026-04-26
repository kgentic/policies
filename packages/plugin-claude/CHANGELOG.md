# @kgentic-ai/policies-plugin-claude

## 0.5.2

### Patch Changes

- 0184289: fix: add missing .mcp.json — MCP server wasn't starting without it

## 0.5.1

### Patch Changes

- c2fabd8: fix: align plugin.json name with marketplace entry to resolve CC lookup error

## 0.5.0

### Minor Changes

- 84d66c7: feat: add code-review policy pack with retrieve-enabled advisory guidance

### Patch Changes

- 5adb51e: fix: move runner.ts to src/hooks/ so dist output matches shell script paths

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
