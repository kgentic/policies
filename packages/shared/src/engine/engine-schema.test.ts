import { describe, expect, it } from 'vitest';
import {
  POLICY_HOOK_EVENTS,
  POLICY_HOOK_MODES,
  POLICY_RULE_LEVELS,
  PolicyHookEventSchema,
  PolicyHookModeSchema,
  PolicyHookSchema,
  EngineManifestSchema,
  PolicyRuleLevelSchema,
} from './engine-schema.js';

describe('PolicyHookEventSchema', () => {
  it('accepts the v1 subset of Claude hook events', () => {
    for (const event of POLICY_HOOK_EVENTS) {
      expect(PolicyHookEventSchema.parse(event)).toBe(event);
    }
  });

  it('rejects unsupported hook events', () => {
    expect(() => PolicyHookEventSchema.parse('PermissionRequest')).toThrow();
  });
});

describe('PolicyRuleLevelSchema', () => {
  it('accepts the supported rule levels', () => {
    for (const level of POLICY_RULE_LEVELS) {
      expect(PolicyRuleLevelSchema.parse(level)).toBe(level);
    }
  });
});

describe('PolicyHookModeSchema', () => {
  it('accepts the supported hook modes', () => {
    for (const mode of POLICY_HOOK_MODES) {
      expect(PolicyHookModeSchema.parse(mode)).toBe(mode);
    }
  });
});

describe('PolicyHookSchema', () => {
  it('accepts a PreToolUse hook with command matching', () => {
    const parsed = PolicyHookSchema.parse({
      id: 'pretool-bash-safety',
      event: 'PreToolUse',
      matcher: 'Bash',
      mode: 'decide',
      decision: 'ask',
      use: ['shell-safety', 'protect-main'],
      when: {
        commands: ['git *', 'rm *'],
      },
      retrieve: {
        enabled: true,
        strategy: 'fts',
        top_k: 3,
      },
    });

    expect(parsed.event).toBe('PreToolUse');
    expect(parsed.retrieve?.enabled).toBe(true);
  });

  it('accepts a Write hook with path matching', () => {
    const parsed = PolicyHookSchema.parse({
      id: 'pretool-write-protected',
      event: 'PreToolUse',
      matcher: 'Write|Edit|MultiEdit|NotebookEdit',
      mode: 'decide',
      decision: 'deny',
      use: ['protected-files'],
      when: {
        paths: ['src/**', 'package.json'],
      },
    });

    expect(parsed.when.paths).toEqual(['src/**', 'package.json']);
  });

  it('rejects hooks with no when conditions', () => {
    expect(() => PolicyHookSchema.parse({
      id: 'bad-hook',
      event: 'PreToolUse',
      matcher: 'Bash',
      mode: 'decide',
      decision: 'deny',
      use: ['shell-safety'],
      when: {},
    })).toThrow(/At least one/);
  });

  it('rejects decide hooks without a decision', () => {
    expect(() => PolicyHookSchema.parse({
      id: 'missing-decision',
      event: 'PreToolUse',
      matcher: 'Bash',
      mode: 'decide',
      use: ['shell-safety'],
      when: {
        commands: ['git *'],
      },
    })).toThrow(/decision is required/);
  });

  it('accepts Stop hooks without tool-level when conditions', () => {
    const parsed = PolicyHookSchema.parse({
      id: 'stop-validation',
      event: 'Stop',
      matcher: '*',
      mode: 'decide',
      decision: 'approve',
      use: ['shell-safety'],
      when: {},
    });

    expect(parsed.event).toBe('Stop');
    expect(parsed.decision).toBe('approve');
  });

  it('rejects invalid decision types for Stop hooks', () => {
    expect(() => PolicyHookSchema.parse({
      id: 'bad-stop',
      event: 'Stop',
      matcher: '*',
      mode: 'decide',
      decision: 'ask',
      use: ['shell-safety'],
      when: {},
    })).toThrow(/approve or block/);
  });

  it('rejects decide mode for non-decision lifecycle hooks', () => {
    expect(() => PolicyHookSchema.parse({
      id: 'bad-session-start',
      event: 'SessionStart',
      matcher: '*',
      mode: 'decide',
      decision: 'allow',
      use: ['shell-safety'],
      when: {},
    })).toThrow(/Only PreToolUse, Stop, and SubagentStop support mode=decide/);
  });
});

describe('EngineManifestSchema', () => {
  it('applies defaults for governance and empty collections', () => {
    const parsed = EngineManifestSchema.parse({
      version: 1,
    });

    expect(parsed.governance.allow_llm_updates).toEqual(['advisory']);
    expect(parsed.governance.require_approval_for).toEqual(['guardrail', 'enforcement']);
    expect(parsed.rulepacks).toEqual([]);
    expect(parsed.rules).toEqual([]);
    expect(parsed.hooks).toEqual([]);
  });

  it('accepts a representative manifest', () => {
    const parsed = EngineManifestSchema.parse({
      version: 1,
      rulepacks: [
        {
          id: 'shell-safety',
          files: ['./rules/shell-safety.md'],
          tags: ['bash', 'shell', 'risk'],
        },
      ],
      rules: [
        {
          id: 'protect-main',
          level: 'enforcement',
          file: './rules/protect-main.md',
          tags: ['git', 'branch-protection'],
        },
      ],
      hooks: [
        {
          id: 'pretool-bash-safety',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'ask',
          use: ['shell-safety', 'protect-main'],
          when: {
            commands: ['git *', 'rm *', 'pnpm *'],
          },
          retrieve: {
            enabled: true,
            strategy: 'fts',
            top_k: 3,
          },
        },
      ],
    });

    expect(parsed.rulepacks).toHaveLength(1);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.hooks).toHaveLength(1);
  });

  it('rejects unsupported retrieval strategies', () => {
    expect(() => EngineManifestSchema.parse({
      version: 1,
      hooks: [
        {
          id: 'bad-retrieve',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'allow',
          use: ['shell-safety'],
          when: {
            commands: ['git *'],
          },
          retrieve: {
            enabled: true,
            strategy: 'semantic',
            top_k: 3,
          },
        },
      ],
    })).toThrow();
  });
});
