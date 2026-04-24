# Build Plan: Phase 1b — Engine Port + Claude Plugin

**Topology**: Star (3 tasks, 2 dependency phases)
**Session**: 20260424-phase1b
**Timestamp**: 2026-04-24
**Ralph max iterations**: 10

## Dependency Phases

### Phase 1 (parallel)
- **T1**: Port evaluator engine into packages/shared/src/engine/ (~2000 lines)
- **T2**: Scaffold packages/plugin-claude/ (package.json, tsconfig, .claude-plugin/)

### Phase 2 (depends on Phase 1)
- **T3**: Port plugin-claude source (runner.ts, claude-hooks.ts, MCP server/tools) + all tests

## Quality Gate
pnpm build && pnpm typecheck && pnpm test — must all pass
