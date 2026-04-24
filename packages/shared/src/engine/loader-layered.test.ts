import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { loadPolicyManifestFromPath, loadPolicyManifestFromDir } from './loader.js';

const tempDirs: string[] = [];
let savedEnv: string | undefined;

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-layered-'));
  tempDirs.push(dir);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }
  return dir;
}

beforeEach(() => {
  savedEnv = process.env['KGENTIC_USER_POLICY_PATH'];
  delete process.env['KGENTIC_USER_POLICY_PATH'];
});

afterEach(async () => {
  if (savedEnv !== undefined) {
    process.env['KGENTIC_USER_POLICY_PATH'] = savedEnv;
  } else {
    delete process.env['KGENTIC_USER_POLICY_PATH'];
  }
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

// ─── Reusable YAML snippets ───────────────────────────────────────────────────

const SIMPLE_POLICY = `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/protect-main.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [protect-main]
    when:
      commands: ["git push *"]
`;

const RULE_FILE_CONTENT = '# Protect main\nDo not push directly to main.\n';

// ─── loadPolicyManifestFromPath ───────────────────────────────────────────────

describe('loadPolicyManifestFromPath', () => {
  it('returns a ResolvedManifest with a layers array containing a single entry', async () => {
    const dir = await makeWorkspace({
      'policy.yaml': SIMPLE_POLICY,
      'rules/protect-main.md': RULE_FILE_CONTENT,
    });

    const result = await loadPolicyManifestFromPath(path.join(dir, 'policy.yaml'));

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.source).toBe('project');
    expect(result.layers[0]?.precedence).toBe(1);
    expect(result.layers[0]?.mergeMode).toBe('defaults');
  });

  it('effectiveSource maps all IDs to project', async () => {
    const dir = await makeWorkspace({
      'policy.yaml': SIMPLE_POLICY,
      'rules/protect-main.md': RULE_FILE_CONTENT,
    });

    const result = await loadPolicyManifestFromPath(path.join(dir, 'policy.yaml'));

    expect(result.effectiveSource.get('protect-main')).toBe('project');
    expect(result.effectiveSource.get('pretool-git')).toBe('project');
  });

  it('suppressedItems is an empty array for a manifest with no disabled items', async () => {
    const dir = await makeWorkspace({
      'policy.yaml': SIMPLE_POLICY,
      'rules/protect-main.md': RULE_FILE_CONTENT,
    });

    const result = await loadPolicyManifestFromPath(path.join(dir, 'policy.yaml'));

    expect(result.suppressedItems).toEqual([]);
  });

  it('is backward compatible — all LoadedPolicyManifest fields are present', async () => {
    const dir = await makeWorkspace({
      'policy.yaml': SIMPLE_POLICY,
      'rules/protect-main.md': RULE_FILE_CONTENT,
    });

    const result = await loadPolicyManifestFromPath(path.join(dir, 'policy.yaml'));

    expect(result.manifestPath).toBeTruthy();
    expect(result.manifest).toBeDefined();
    expect(result.manifest.version).toBe(1);
    expect(result.hash).toHaveLength(64);
    expect(result.assets).toBeInstanceOf(Map);
    expect(result.ruleContents).toBeInstanceOf(Map);
  });

  it('resolves manifestPath to an absolute path', async () => {
    const dir = await makeWorkspace({
      'policy.yaml': SIMPLE_POLICY,
      'rules/protect-main.md': RULE_FILE_CONTENT,
    });

    const result = await loadPolicyManifestFromPath(path.join(dir, 'policy.yaml'));

    expect(path.isAbsolute(result.manifestPath)).toBe(true);
  });
});

// ─── loadPolicyManifestFromDir ────────────────────────────────────────────────

describe('loadPolicyManifestFromDir', () => {
  it('single project config — same result as loadPolicyManifestFromPath', async () => {
    const dir = await makeWorkspace({
      'policy.yaml': SIMPLE_POLICY,
      'rules/protect-main.md': RULE_FILE_CONTENT,
    });
    // Ensure no user config is found
    process.env['KGENTIC_USER_POLICY_PATH'] = path.join(dir, 'nonexistent-user.yaml');

    const result = await loadPolicyManifestFromDir({ startDir: dir });

    expect(result.manifest.rules).toHaveLength(1);
    expect(result.manifest.rules[0]?.id).toBe('protect-main');
    expect(result.layers).toHaveLength(1);
    expect(result.suppressedItems).toHaveLength(0);
  });

  it('two configs (user + project) — merged correctly, effectiveSource shows winning layer', async () => {
    const userYaml = `version: 1
rules:
  - id: user-advisory
    level: advisory
    file: ./rules/advisory.md
  - id: shared-rule
    level: advisory
    file: ./rules/shared.md
`;
    const projectYaml = `version: 1
rules:
  - id: shared-rule
    level: enforcement
    file: ./rules/shared.md
  - id: project-strict
    level: enforcement
    file: ./rules/strict.md
`;
    const dir = await makeWorkspace({
      'policy.yaml': projectYaml,
      'rules/advisory.md': '# Advisory\n',
      'rules/shared.md': '# Shared\n',
      'rules/strict.md': '# Strict\n',
      'user-policy.yaml': userYaml,
    });

    // Point user config at the user-policy.yaml in the same dir for test isolation
    const userPolicyDir = await makeWorkspace({
      'policy.yaml': userYaml,
      'rules/advisory.md': '# Advisory\n',
      'rules/shared.md': '# Shared\n',
    });
    process.env['KGENTIC_USER_POLICY_PATH'] = path.join(userPolicyDir, 'policy.yaml');

    const result = await loadPolicyManifestFromDir({ startDir: dir });

    expect(result.layers).toHaveLength(2);
    const ruleIds = result.manifest.rules.map(r => r.id);
    expect(ruleIds).toContain('user-advisory');
    expect(ruleIds).toContain('shared-rule');
    expect(ruleIds).toContain('project-strict');

    // shared-rule should come from project (higher precedence)
    expect(result.effectiveSource.get('shared-rule')).toBe('project');
    // user-advisory comes from user layer
    expect(result.effectiveSource.get('user-advisory')).toBe('user');
  });

  it('project overrides user rule with same ID — project version in final manifest', async () => {
    const userYaml = `version: 1
rules:
  - id: overrideable
    level: advisory
    file: ./rules/rule.md
`;
    const projectYaml = `version: 1
rules:
  - id: overrideable
    level: enforcement
    file: ./rules/rule.md
`;
    const userDir = await makeWorkspace({
      'policy.yaml': userYaml,
      'rules/rule.md': '# Rule\n',
    });
    const projectDir = await makeWorkspace({
      'policy.yaml': projectYaml,
      'rules/rule.md': '# Rule\n',
    });
    process.env['KGENTIC_USER_POLICY_PATH'] = path.join(userDir, 'policy.yaml');

    const result = await loadPolicyManifestFromDir({ startDir: projectDir });

    const rule = result.manifest.rules.find(r => r.id === 'overrideable');
    expect(rule).toBeDefined();
    expect(rule?.level).toBe('enforcement');
    expect(result.effectiveSource.get('overrideable')).toBe('project');
  });

  it('project disables user rule with enabled:false — appears in suppressedItems', async () => {
    const userYaml = `version: 1
rules:
  - id: user-rule-to-disable
    level: advisory
    file: ./rules/user-rule.md
`;
    const projectYaml = `version: 1
rules:
  - id: user-rule-to-disable
    level: advisory
    file: ./rules/user-rule.md
    enabled: false
`;
    const userDir = await makeWorkspace({
      'policy.yaml': userYaml,
      'rules/user-rule.md': '# User rule\n',
    });
    const projectDir = await makeWorkspace({
      'policy.yaml': projectYaml,
      'rules/user-rule.md': '# User rule\n',
    });
    process.env['KGENTIC_USER_POLICY_PATH'] = path.join(userDir, 'policy.yaml');

    const result = await loadPolicyManifestFromDir({ startDir: projectDir });

    // The disabled rule must NOT appear in manifest.rules
    const ruleInManifest = result.manifest.rules.find(r => r.id === 'user-rule-to-disable');
    expect(ruleInManifest).toBeUndefined();

    // It MUST appear in suppressedItems
    const suppressed = result.suppressedItems.find(s => s.id === 'user-rule-to-disable');
    expect(suppressed).toBeDefined();
    expect(suppressed?.type).toBe('rule');
  });

  it('throws when no config file is found in the directory', async () => {
    const emptyDir = await makeWorkspace({});
    process.env['KGENTIC_USER_POLICY_PATH'] = path.join(emptyDir, 'nonexistent-user.yaml');

    await expect(loadPolicyManifestFromDir({ startDir: emptyDir })).rejects.toThrow(
      /No policy manifest found/,
    );
  });

  it('returns a non-empty hash when loading two merged layers', async () => {
    const userYaml = `version: 1
governance:
  approval_ttl_minutes: 10
`;
    const projectYaml = `version: 1
governance:
  approval_ttl_minutes: 20
`;
    const userDir = await makeWorkspace({ 'policy.yaml': userYaml });
    const projectDir = await makeWorkspace({ 'policy.yaml': projectYaml });
    process.env['KGENTIC_USER_POLICY_PATH'] = path.join(userDir, 'policy.yaml');

    const result = await loadPolicyManifestFromDir({ startDir: projectDir });

    expect(result.hash).toHaveLength(64);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
