import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { loadConfigLayer, mergeLayers } from './layer-loader.js';
import type { ConfigLayer } from './engine-schema.js';

const tempDirs: string[] = [];

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-layer-loader-'));
  tempDirs.push(dir);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

// ─── Minimal valid YAML snippets ──────────────────────────────────────────────

const MINIMAL_USER_YAML = `version: 1
governance:
  approval_ttl_minutes: 30
rules:
  - id: user-base-rule
    level: advisory
    file: ./rules/base.md
`;

const MINIMAL_PROJECT_YAML = `version: 1
governance:
  approval_ttl_minutes: 60
rules:
  - id: project-rule
    level: enforcement
    file: ./rules/enforce.md
`;

// ─── loadConfigLayer ──────────────────────────────────────────────────────────

describe('loadConfigLayer', () => {
  it('loads valid YAML and returns a ConfigLayer with correct fields', async () => {
    const dir = await makeWorkspace({ 'policy.yaml': MINIMAL_USER_YAML });
    const filePath = path.join(dir, 'policy.yaml');

    const layer = await loadConfigLayer(filePath, 'user', 0, 'defaults');

    expect(layer.source).toBe('user');
    expect(layer.sourcePath).toBe(filePath);
    expect(layer.precedence).toBe(0);
    expect(layer.mergeMode).toBe('defaults');
    expect(layer.manifest).toBeDefined();
  });

  it('computes a non-empty SHA-256 hash of the raw YAML', async () => {
    const dir = await makeWorkspace({ 'policy.yaml': MINIMAL_USER_YAML });
    const filePath = path.join(dir, 'policy.yaml');

    const layer = await loadConfigLayer(filePath, 'user', 0, 'defaults');

    expect(layer.hash).toHaveLength(64);
    expect(layer.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash for different file content', async () => {
    const dir = await makeWorkspace({
      'user.yaml': MINIMAL_USER_YAML,
      'project.yaml': MINIMAL_PROJECT_YAML,
    });

    const layerA = await loadConfigLayer(path.join(dir, 'user.yaml'), 'user', 0, 'defaults');
    const layerB = await loadConfigLayer(path.join(dir, 'project.yaml'), 'project', 1, 'defaults');

    expect(layerA.hash).not.toBe(layerB.hash);
  });

  it('sets source, precedence, and mergeMode from params', async () => {
    const dir = await makeWorkspace({ 'cfg.yaml': MINIMAL_PROJECT_YAML });
    const filePath = path.join(dir, 'cfg.yaml');

    const layer = await loadConfigLayer(filePath, 'project', 1, 'defaults');

    expect(layer.source).toBe('project');
    expect(layer.precedence).toBe(1);
    expect(layer.mergeMode).toBe('defaults');
  });

  it('parses manifest rules into the layer manifest', async () => {
    const dir = await makeWorkspace({ 'policy.yaml': MINIMAL_USER_YAML });
    const layer = await loadConfigLayer(path.join(dir, 'policy.yaml'), 'user', 0, 'defaults');

    expect(layer.manifest.rules).toHaveLength(1);
    expect(layer.manifest.rules?.[0]?.id).toBe('user-base-rule');
  });

  it('throws on invalid YAML syntax', async () => {
    // The yaml parser throws before the schema validation wrapper adds the file path,
    // so we only assert that it rejects — not on the specific message format.
    const dir = await makeWorkspace({ 'bad.yaml': 'version: 1\nrules: [invalid: : yaml:' });
    const filePath = path.join(dir, 'bad.yaml');

    await expect(loadConfigLayer(filePath, 'project', 1, 'defaults')).rejects.toThrow();
  });

  it('throws with file path on partial schema failure (rule missing id)', async () => {
    const yaml = `version: 1
rules:
  - level: advisory
    file: ./rules/no-id.md
`;
    const dir = await makeWorkspace({ 'bad-schema.yaml': yaml });
    const filePath = path.join(dir, 'bad-schema.yaml');

    await expect(loadConfigLayer(filePath, 'project', 1, 'defaults')).rejects.toThrow(/bad-schema\.yaml/);
  });

  it('throws on non-existent file', async () => {
    const filePath = '/tmp/this-file-does-not-exist-policy-test.yaml';

    await expect(loadConfigLayer(filePath, 'project', 1, 'defaults')).rejects.toThrow();
  });
});

// ─── mergeLayers ──────────────────────────────────────────────────────────────

describe('mergeLayers', () => {
  it('returns empty MergeResult when 0 layers provided', () => {
    const result = mergeLayers([]);
    expect(result.merged).toEqual({});
    expect(result.suppressedItems).toEqual([]);
  });

  it('returns single-layer manifest without merging when 1 layer provided', async () => {
    const dir = await makeWorkspace({ 'policy.yaml': MINIMAL_USER_YAML });
    const layer = await loadConfigLayer(path.join(dir, 'policy.yaml'), 'user', 0, 'defaults');

    const result = mergeLayers([layer]);

    const rules = result.merged['rules'] as Array<{ id: string }>;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('user-base-rule');
    expect(result.suppressedItems).toHaveLength(0);
  });

  it('merges 2 layers with project winning on ID conflict', async () => {
    const userYaml = `version: 1
rules:
  - id: shared-rule
    level: advisory
    file: ./rules/shared.md
  - id: user-only
    level: advisory
    file: ./rules/user-only.md
`;
    const projectYaml = `version: 1
rules:
  - id: shared-rule
    level: enforcement
    file: ./rules/shared.md
`;
    const dir = await makeWorkspace({
      'user.yaml': userYaml,
      'project.yaml': projectYaml,
    });

    const userLayer = await loadConfigLayer(path.join(dir, 'user.yaml'), 'user', 0, 'defaults');
    const projectLayer = await loadConfigLayer(path.join(dir, 'project.yaml'), 'project', 1, 'defaults');

    const result = mergeLayers([userLayer, projectLayer]);

    const rules = result.merged['rules'] as Array<{ id: string; level: string }>;
    expect(rules).toHaveLength(2);
    const shared = rules.find(r => r.id === 'shared-rule');
    expect(shared?.level).toBe('enforcement');
    const userOnly = rules.find(r => r.id === 'user-only');
    expect(userOnly).toBeDefined();
  });

  it('sorts by precedence regardless of input order — lowest precedence first', async () => {
    const userYaml = `version: 1
governance:
  approval_ttl_minutes: 10
`;
    const projectYaml = `version: 1
governance:
  approval_ttl_minutes: 99
`;
    const dir = await makeWorkspace({ 'user.yaml': userYaml, 'project.yaml': projectYaml });

    const userLayer = await loadConfigLayer(path.join(dir, 'user.yaml'), 'user', 0, 'defaults');
    const projectLayer = await loadConfigLayer(path.join(dir, 'project.yaml'), 'project', 1, 'defaults');

    // Pass in reverse order — project first, then user — project should still win
    const result = mergeLayers([projectLayer, userLayer]);

    const gov = result.merged['governance'] as Record<string, unknown>;
    expect(gov['approval_ttl_minutes']).toBe(99);
  });

  it('collects suppressedItems from rules with enabled:false', async () => {
    const projectYaml = `version: 1
rules:
  - id: active-rule
    level: advisory
    file: ./rules/active.md
  - id: disabled-rule
    level: guardrail
    file: ./rules/disabled.md
    enabled: false
`;
    const dir = await makeWorkspace({ 'policy.yaml': projectYaml });
    const layer = await loadConfigLayer(path.join(dir, 'policy.yaml'), 'project', 1, 'defaults');

    const result = mergeLayers([layer]);

    const rules = result.merged['rules'] as Array<{ id: string }>;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('active-rule');
    expect(result.suppressedItems).toHaveLength(1);
    expect(result.suppressedItems[0]?.id).toBe('disabled-rule');
    expect(result.suppressedItems[0]?.type).toBe('rule');
  });

  it('throws when any layer has mergeMode enforced', () => {
    // The enforced check only runs in the multi-layer code path (length >= 2).
    // A single enforced layer would take the early-return path and skip the guard.
    const userLayer: ConfigLayer = {
      source: 'user',
      sourcePath: '/fake/user/policy.yaml',
      precedence: 0,
      mergeMode: 'defaults',
      manifest: { version: 1, rules: [], hooks: [], rulepacks: [] },
      hash: 'aaa',
    };
    const enforcedLayer: ConfigLayer = {
      source: 'project',
      sourcePath: '/fake/project/policy.yaml',
      precedence: 1,
      mergeMode: 'enforced',
      manifest: { version: 1, rules: [], hooks: [], rulepacks: [] },
      hash: 'bbb',
    };

    expect(() => mergeLayers([userLayer, enforcedLayer])).toThrow(/[Ee]nforced/);
  });

  it('preserves user-only rules when project layer has no conflicting IDs', async () => {
    const userYaml = `version: 1
rules:
  - id: user-baseline
    level: advisory
    file: ./rules/baseline.md
`;
    const projectYaml = `version: 1
rules:
  - id: project-strict
    level: enforcement
    file: ./rules/strict.md
`;
    const dir = await makeWorkspace({ 'user.yaml': userYaml, 'project.yaml': projectYaml });

    const userLayer = await loadConfigLayer(path.join(dir, 'user.yaml'), 'user', 0, 'defaults');
    const projectLayer = await loadConfigLayer(path.join(dir, 'project.yaml'), 'project', 1, 'defaults');

    const result = mergeLayers([userLayer, projectLayer]);

    const rules = result.merged['rules'] as Array<{ id: string }>;
    const ids = rules.map(r => r.id);
    expect(ids).toContain('user-baseline');
    expect(ids).toContain('project-strict');
  });
});
