import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPolicyManifest, validatePolicyManifest } from './loader.js';

const tempDirs: string[] = [];

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-loader-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  }

  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('loadPolicyManifest', () => {
  it('loads yaml, resolves rule files, and computes a content hash', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
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
      commands: ["git *"]
`,
      'rules/protect-main.md': '# Protect main\nDo not push directly to main.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(loaded.manifest.hooks).toHaveLength(1);
    expect(loaded.assets.get('protect-main')?.files).toHaveLength(1);
    expect(loaded.hash).toHaveLength(64);
  });
});

describe('validatePolicyManifest', () => {
  it('returns warnings for potentially unreachable overlapping hooks', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-a
    level: enforcement
    file: ./rules/a.md
  - id: protect-b
    level: enforcement
    file: ./rules/b.md
hooks:
  - id: first
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-a]
    when:
      commands: ["git *"]
  - id: second
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [protect-b]
    when:
      commands: ["git *"]
`,
      'rules/a.md': 'A\n',
      'rules/b.md': 'B\n',
    });

    const result = await validatePolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'POTENTIALLY_UNREACHABLE_HOOK')).toBe(true);
  });

  it('fails when a referenced rule file is missing', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/missing.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [protect-main]
    when:
      commands: ["git *"]
`,
    });

    const result = await validatePolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing\.md/);
  });

  it('warns when hook has both commands and paths (AND-vs-OR)', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-env
    level: enforcement
    file: ./rules/protect-env.md
hooks:
  - id: block-curl-to-env
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-env]
    when:
      commands: ["curl *"]
      paths: [".env*"]
`,
      'rules/protect-env.md': '# Protect env\nDo not exfiltrate secrets.\n',
    });

    const result = await validatePolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === 'AND_VS_OR_COMPOSITION')).toBe(true);
  });

  it('warns when Bash matcher has paths in when clause', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-env
    level: enforcement
    file: ./rules/protect-env.md
hooks:
  - id: bash-with-paths
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-env]
    when:
      paths: [".env*"]
`,
      'rules/protect-env.md': '# Protect env\n',
    });

    const result = await validatePolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === 'UNREACHABLE_WHEN')).toBe(true);
  });

  it('warns when Write matcher has commands in when clause', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-env
    level: enforcement
    file: ./rules/protect-env.md
hooks:
  - id: write-with-commands
    event: PreToolUse
    matcher: Write
    mode: decide
    decision: deny
    use: [protect-env]
    when:
      commands: ["curl *"]
`,
      'rules/protect-env.md': '# Protect env\n',
    });

    const result = await validatePolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === 'UNREACHABLE_WHEN')).toBe(true);
  });

  it('warns on duplicate hook IDs', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-env
    level: enforcement
    file: ./rules/protect-env.md
hooks:
  - id: same-hook-id
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-env]
    when:
      commands: ["curl *"]
  - id: same-hook-id
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [protect-env]
    when:
      commands: ["git *"]
`,
      'rules/protect-env.md': '# Protect env\n',
    });

    const result = await validatePolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === 'DUPLICATE_HOOK_ID')).toBe(true);
  });

  it('does not warn for valid hooks with only commands', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-env
    level: enforcement
    file: ./rules/protect-env.md
hooks:
  - id: bash-commands-only
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-env]
    when:
      commands: ["curl *"]
`,
      'rules/protect-env.md': '# Protect env\n',
    });

    const result = await validatePolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === 'AND_VS_OR_COMPOSITION')).toBe(false);
    expect(result.warnings.some((w) => w.code === 'UNREACHABLE_WHEN')).toBe(false);
  });

  it('does not warn for valid hooks with only paths', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-env
    level: enforcement
    file: ./rules/protect-env.md
hooks:
  - id: write-paths-only
    event: PreToolUse
    matcher: Write
    mode: inject
    use: [protect-env]
    when:
      paths: [".env*"]
`,
      'rules/protect-env.md': '# Protect env\n',
    });

    const result = await validatePolicyManifest(path.join(workspace, 'policy.yaml'));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === 'AND_VS_OR_COMPOSITION')).toBe(false);
    expect(result.warnings.some((w) => w.code === 'UNREACHABLE_WHEN')).toBe(false);
  });
});
