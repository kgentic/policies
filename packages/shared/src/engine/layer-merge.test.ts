import { describe, it, expect } from 'vitest';
import {
  ENTITY_ARRAY_KEYS,
  dedupeById,
  replaceArray,
  filterDisabled,
  mergeManifests,
} from './layer-merge.js';
import type { ConfigLayer } from './engine-schema.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeLayer(
  source: ConfigLayer['source'],
  items: { rules?: Array<{ id: string; enabled?: boolean }>; hooks?: Array<{ id: string; enabled?: boolean }> } = {},
): ConfigLayer {
  return {
    source,
    sourcePath: `/fake/${source}/policy.yaml`,
    precedence: source === 'user' ? 0 : 1,
    mergeMode: 'defaults',
    manifest: items as ConfigLayer['manifest'],
    hash: 'abc123',
  };
}

// ─── ENTITY_ARRAY_KEYS ────────────────────────────────────────────────────────

describe('ENTITY_ARRAY_KEYS', () => {
  it('contains exactly rules, hooks, and rulepacks', () => {
    expect(ENTITY_ARRAY_KEYS).toHaveLength(3);
    expect(ENTITY_ARRAY_KEYS).toContain('rules');
    expect(ENTITY_ARRAY_KEYS).toContain('hooks');
    expect(ENTITY_ARRAY_KEYS).toContain('rulepacks');
  });
});

// ─── dedupeById ───────────────────────────────────────────────────────────────

describe('dedupeById', () => {
  it('returns empty array when both target and source are empty', () => {
    expect(dedupeById([], [])).toEqual([]);
  });

  it('returns target items when source is empty', () => {
    const target = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    expect(dedupeById(target, [])).toEqual(target);
  });

  it('appends source items when target is empty', () => {
    const source = [{ id: 'x', value: 10 }, { id: 'y', value: 20 }];
    expect(dedupeById([], source)).toEqual(source);
  });

  it('concatenates when there are no ID collisions', () => {
    const target = [{ id: 'a', v: 1 }];
    const source = [{ id: 'b', v: 2 }];
    const result = dedupeById(target, source);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('source wins when ID collides — target version is replaced', () => {
    const target = [{ id: 'rule-1', level: 'advisory' }];
    const source = [{ id: 'rule-1', level: 'enforcement' }];
    const result = dedupeById(target, source);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'rule-1', level: 'enforcement' });
  });

  it('handles multiple collisions and non-collisions mixed', () => {
    const target = [
      { id: 'shared-a', level: 'advisory' },
      { id: 'target-only', level: 'guardrail' },
      { id: 'shared-b', level: 'advisory' },
    ];
    const source = [
      { id: 'shared-a', level: 'enforcement' },
      { id: 'source-only', level: 'enforcement' },
      { id: 'shared-b', level: 'enforcement' },
    ];
    const result = dedupeById(target, source);
    // Walk order: target items (replaced by source on collision), then source-only
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ id: 'shared-a', level: 'enforcement' });
    expect(result[1]).toEqual({ id: 'target-only', level: 'guardrail' });
    expect(result[2]).toEqual({ id: 'shared-b', level: 'enforcement' });
    expect(result[3]).toEqual({ id: 'source-only', level: 'enforcement' });
  });

  it('source items not in target are appended after target items', () => {
    const target = [{ id: 'existing', name: 'existing' }];
    const source = [{ id: 'new', name: 'new' }];
    const result = dedupeById(target, source);
    expect(result[0]?.id).toBe('existing');
    expect(result[1]?.id).toBe('new');
  });

  it('keeps source version when same ID has different properties', () => {
    const target = [{ id: 'rule-1', file: 'old.md', tags: ['old'] }];
    const source = [{ id: 'rule-1', file: 'new.md', tags: ['new', 'extra'] }];
    const result = dedupeById(target, source);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'rule-1', file: 'new.md', tags: ['new', 'extra'] });
  });
});

// ─── replaceArray ─────────────────────────────────────────────────────────────

describe('replaceArray', () => {
  it('replaces target with source when source is non-empty', () => {
    const target = ['a', 'b', 'c'];
    const source = ['x', 'y'];
    expect(replaceArray(target, source)).toEqual(['x', 'y']);
  });

  it('keeps target when source is empty', () => {
    const target = ['a', 'b'];
    expect(replaceArray(target, [])).toEqual(['a', 'b']);
  });

  it('returns empty array when both are empty', () => {
    expect(replaceArray([], [])).toEqual([]);
  });

  it('does not mutate either input', () => {
    const target = ['a'];
    const source = ['b'];
    const result = replaceArray(target, source);
    // Mutate result and verify originals unchanged
    (result as string[]).push('c');
    expect(target).toHaveLength(1);
    expect(source).toHaveLength(1);
  });
});

// ─── filterDisabled ───────────────────────────────────────────────────────────

describe('filterDisabled', () => {
  it('returns all items and empty suppressedItems when nothing is disabled', () => {
    const merged: Record<string, unknown> = {
      rules: [{ id: 'rule-1', enabled: true }, { id: 'rule-2' }],
    };
    const layers: ConfigLayer[] = [makeLayer('project', { rules: [{ id: 'rule-1' }, { id: 'rule-2' }] })];
    const { filtered, suppressedItems } = filterDisabled(merged, layers);
    expect((filtered['rules'] as unknown[]).length).toBe(2);
    expect(suppressedItems).toHaveLength(0);
  });

  it('removes rule with enabled:false and records it in suppressedItems', () => {
    const merged: Record<string, unknown> = {
      rules: [
        { id: 'rule-keep', enabled: true },
        { id: 'rule-disabled', enabled: false },
      ],
    };
    const layers: ConfigLayer[] = [
      makeLayer('user', { rules: [{ id: 'rule-keep' }, { id: 'rule-disabled' }] }),
    ];
    const { filtered, suppressedItems } = filterDisabled(merged, layers);
    const rules = filtered['rules'] as Array<{ id: string }>;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('rule-keep');
    expect(suppressedItems).toHaveLength(1);
    expect(suppressedItems[0]?.id).toBe('rule-disabled');
    expect(suppressedItems[0]?.type).toBe('rule');
  });

  it('removes hook with enabled:false and records type hook', () => {
    const merged: Record<string, unknown> = {
      hooks: [
        { id: 'hook-active', enabled: true },
        { id: 'hook-off', enabled: false },
      ],
    };
    const layers: ConfigLayer[] = [
      makeLayer('project', { hooks: [{ id: 'hook-active' }, { id: 'hook-off' }] }),
    ];
    const { filtered, suppressedItems } = filterDisabled(merged, layers);
    const hooks = filtered['hooks'] as Array<{ id: string }>;
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.id).toBe('hook-active');
    expect(suppressedItems[0]?.type).toBe('hook');
    expect(suppressedItems[0]?.id).toBe('hook-off');
  });

  it('handles mix of enabled and disabled items across rule types', () => {
    const merged: Record<string, unknown> = {
      rules: [{ id: 'r1' }, { id: 'r2', enabled: false }, { id: 'r3' }],
      hooks: [{ id: 'h1', enabled: false }, { id: 'h2' }],
    };
    const layers: ConfigLayer[] = [
      makeLayer('project', {
        rules: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
        hooks: [{ id: 'h1' }, { id: 'h2' }],
      }),
    ];
    const { filtered, suppressedItems } = filterDisabled(merged, layers);
    expect((filtered['rules'] as unknown[]).length).toBe(2);
    expect((filtered['hooks'] as unknown[]).length).toBe(1);
    expect(suppressedItems).toHaveLength(2);
    const ids = suppressedItems.map(s => s.id);
    expect(ids).toContain('r2');
    expect(ids).toContain('h1');
  });

  it('suppressedItems.source identifies the original layer', () => {
    const merged: Record<string, unknown> = {
      rules: [{ id: 'user-rule', enabled: false }],
    };
    const layers: ConfigLayer[] = [
      makeLayer('user', { rules: [{ id: 'user-rule' }] }),
      makeLayer('project', { rules: [] }),
    ];
    const { suppressedItems } = filterDisabled(merged, layers);
    expect(suppressedItems[0]?.source).toBe('user');
  });

  it('does not throw when no entity array keys are present in merged', () => {
    const merged: Record<string, unknown> = { version: 1 };
    const { filtered, suppressedItems } = filterDisabled(merged, []);
    expect(filtered['version']).toBe(1);
    expect(suppressedItems).toHaveLength(0);
  });
});

// ─── mergeManifests ───────────────────────────────────────────────────────────

describe('mergeManifests', () => {
  it('scalar override: project approval_ttl_minutes overrides user', () => {
    const base: Record<string, unknown> = {
      version: 1,
      governance: { approval_ttl_minutes: 30, allow_llm_updates: ['advisory'] },
    };
    const override: Record<string, unknown> = {
      version: 1,
      governance: { approval_ttl_minutes: 60 },
    };
    const result = mergeManifests(base, override);
    const gov = result['governance'] as Record<string, unknown>;
    expect(gov['approval_ttl_minutes']).toBe(60);
    // Base field preserved when not overridden via deepmerge object recursion
    expect(gov['allow_llm_updates']).toEqual(['advisory']);
  });

  it('governance arrays: project replaces user entirely (not concatenated)', () => {
    const base: Record<string, unknown> = {
      governance: { require_approval_for: ['guardrail', 'enforcement'] },
    };
    const override: Record<string, unknown> = {
      governance: { require_approval_for: ['enforcement'] },
    };
    const result = mergeManifests(base, override);
    const gov = result['governance'] as Record<string, unknown>;
    expect(gov['require_approval_for']).toEqual(['enforcement']);
  });

  it('rules: project wins on ID collision (dedupeById)', () => {
    const base: Record<string, unknown> = {
      rules: [{ id: 'shared-rule', level: 'advisory', file: 'user.md', tags: [] }],
    };
    const override: Record<string, unknown> = {
      rules: [{ id: 'shared-rule', level: 'enforcement', file: 'project.md', tags: [] }],
    };
    const result = mergeManifests(base, override);
    const rules = result['rules'] as Array<{ id: string; level: string }>;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.level).toBe('enforcement');
    expect(rules[0]?.id).toBe('shared-rule');
  });

  it('hooks: project wins on ID collision (dedupeById)', () => {
    const base: Record<string, unknown> = {
      hooks: [{ id: 'hook-1', event: 'Stop', mode: 'inject', use: ['r1'], when: {} }],
    };
    const override: Record<string, unknown> = {
      hooks: [{ id: 'hook-1', event: 'Stop', mode: 'audit', use: ['r2'], when: {} }],
    };
    const result = mergeManifests(base, override);
    const hooks = result['hooks'] as Array<{ id: string; mode: string }>;
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.mode).toBe('audit');
  });

  it('user-only rules are preserved when project has no override for that ID', () => {
    const base: Record<string, unknown> = {
      rules: [{ id: 'user-only', level: 'advisory', file: 'u.md', tags: [] }],
    };
    const override: Record<string, unknown> = {
      rules: [{ id: 'project-only', level: 'enforcement', file: 'p.md', tags: [] }],
    };
    const result = mergeManifests(base, override);
    const rules = result['rules'] as Array<{ id: string }>;
    expect(rules).toHaveLength(2);
    const ids = rules.map(r => r.id);
    expect(ids).toContain('user-only');
    expect(ids).toContain('project-only');
  });

  it('project-only rules are added alongside user rules', () => {
    const base: Record<string, unknown> = {
      rules: [{ id: 'r-user', level: 'advisory', file: 'u.md', tags: [] }],
    };
    const override: Record<string, unknown> = {
      rules: [{ id: 'r-project', level: 'enforcement', file: 'p.md', tags: [] }],
    };
    const result = mergeManifests(base, override);
    const rules = result['rules'] as Array<{ id: string }>;
    expect(rules.find(r => r.id === 'r-user')).toBeDefined();
    expect(rules.find(r => r.id === 'r-project')).toBeDefined();
  });
});
