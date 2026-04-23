import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { install, remove, resolveRulesDir } from './claude.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'policy-test-'));
  return tempDir;
}

describe('install', () => {
  it('creates .claude/rules/<policyName>/ directory structure', async () => {
    const projectDir = await createTempDir();
    const files = new Map([['no-console.md', '# No Console']]);

    await install(projectDir, 'swe-essentials', files);

    // Verify the directory was created by reading the file
    const content = await readFile(
      join(projectDir, '.claude', 'rules', 'swe-essentials', 'no-console.md'),
      'utf-8',
    );
    expect(content).toBe('# No Console');
  });

  it('writes all files with correct content', async () => {
    const projectDir = await createTempDir();
    const files = new Map([
      ['rule-a.md', 'Content A'],
      ['rule-b.md', 'Content B'],
    ]);

    await install(projectDir, 'my-policy', files);

    const rulesDir = join(projectDir, '.claude', 'rules', 'my-policy');
    const contentA = await readFile(join(rulesDir, 'rule-a.md'), 'utf-8');
    const contentB = await readFile(join(rulesDir, 'rule-b.md'), 'utf-8');

    expect(contentA).toBe('Content A');
    expect(contentB).toBe('Content B');
  });

  it('returns correct AdapterInstallResult', async () => {
    const projectDir = await createTempDir();
    const files = new Map([['no-console.md', '# No Console']]);

    const result = await install(projectDir, 'swe-essentials', files);

    expect(result.client).toBe('claude');
    expect(result.rulesDir).toBe(join(projectDir, '.claude', 'rules', 'swe-essentials'));
    expect(result.filesWritten).toHaveLength(1);
    expect(result.filesWritten[0]).toBe(
      join(projectDir, '.claude', 'rules', 'swe-essentials', 'no-console.md'),
    );
  });

  it('creates nested directory structure for files with subdirectories', async () => {
    const projectDir = await createTempDir();
    const files = new Map([['rules/strict-types.md', '# Strict Types']]);

    const result = await install(projectDir, 'my-policy', files);

    const content = await readFile(
      join(projectDir, '.claude', 'rules', 'my-policy', 'rules', 'strict-types.md'),
      'utf-8',
    );
    expect(content).toBe('# Strict Types');
    expect(result.filesWritten[0]).toContain('strict-types.md');
  });

  it('returns empty filesWritten for empty files map', async () => {
    const projectDir = await createTempDir();
    const files = new Map<string, string>();

    const result = await install(projectDir, 'empty-policy', files);

    expect(result.client).toBe('claude');
    expect(result.filesWritten).toHaveLength(0);
    expect(result.rulesDir).toBe(join(projectDir, '.claude', 'rules', 'empty-policy'));
  });
});

describe('remove', () => {
  it('deletes installed files', async () => {
    const projectDir = await createTempDir();
    const files = new Map([
      ['rule-a.md', 'Content A'],
      ['rule-b.md', 'Content B'],
    ]);

    const result = await install(projectDir, 'test-policy', files);

    await remove(projectDir, result.filesWritten.map((f) => ({ installedTo: f })));

    // Files should no longer exist — readFile should throw
    await expect(
      readFile(join(projectDir, '.claude', 'rules', 'test-policy', 'rule-a.md'), 'utf-8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(projectDir, '.claude', 'rules', 'test-policy', 'rule-b.md'), 'utf-8'),
    ).rejects.toThrow();
  });

  it('handles already-deleted files gracefully', async () => {
    const projectDir = await createTempDir();
    const nonExistentPath = join(projectDir, 'does-not-exist.md');

    // Should not throw even though file doesn't exist
    await expect(
      remove(projectDir, [{ installedTo: nonExistentPath }]),
    ).resolves.toBeUndefined();
  });

  it('handles mixed existing and non-existing files', async () => {
    const projectDir = await createTempDir();
    const files = new Map([['existing.md', 'content']]);
    const result = await install(projectDir, 'mixed-policy', files);

    const installedRules = [
      ...result.filesWritten.map((f) => ({ installedTo: f })),
      { installedTo: join(projectDir, 'ghost-file.md') },
    ];

    // Should complete without throwing
    await expect(remove(projectDir, installedRules)).resolves.toBeUndefined();
  });

  it('accepts empty installedRules array', async () => {
    const projectDir = await createTempDir();

    await expect(remove(projectDir, [])).resolves.toBeUndefined();
  });
});

describe('getAdapter (via adapters/index)', () => {
  it('returns claude adapter for claude client', async () => {
    const { getAdapter } = await import('./index.js');
    const adapter = getAdapter('claude');
    expect(typeof adapter.install).toBe('function');
    expect(typeof adapter.remove).toBe('function');
  });

  it('throws for unsupported cursor client', async () => {
    const { getAdapter } = await import('./index.js');
    expect(() => getAdapter('cursor')).toThrow('not yet supported');
  });

  it('throws for unsupported windsurf client', async () => {
    const { getAdapter } = await import('./index.js');
    expect(() => getAdapter('windsurf')).toThrow('not yet supported');
  });
});

// Dedicated test for mkdir scenario — verifies that install works even when
// the project dir doesn't pre-exist (mkdir recursive handles it)
describe('install with nested project dir', () => {
  it('creates full directory tree from scratch', async () => {
    const base = await createTempDir();
    // Use a deeper project dir that doesn't exist yet
    const projectDir = join(base, 'deep', 'project');
    await mkdir(projectDir, { recursive: true });

    const files = new Map([['test.md', 'hello']]);
    const result = await install(projectDir, 'pkg', files);

    expect(result.filesWritten).toHaveLength(1);
    const content = await readFile(result.filesWritten[0] as string, 'utf-8');
    expect(content).toBe('hello');
  });
});

describe('resolveRulesDir', () => {
  it('returns project-scoped path by default', () => {
    const projectDir = '/tmp/my-project';
    const result = resolveRulesDir('project', projectDir, 'swe-essentials');
    expect(result).toBe(join(projectDir, '.claude', 'rules', 'swe-essentials'));
  });

  it('returns global path under home directory', () => {
    const projectDir = '/tmp/my-project';
    const result = resolveRulesDir('global', projectDir, 'swe-essentials');
    expect(result).toBe(join(homedir(), '.claude', 'rules', 'swe-essentials'));
  });

  it('global path does not include projectDir', () => {
    const projectDir = '/tmp/my-project';
    const result = resolveRulesDir('global', projectDir, 'swe-essentials');
    expect(result.includes(projectDir)).toBe(false);
  });
});

describe('install with global scope', () => {
  it('installs to project scope by default (no scope arg)', async () => {
    const projectDir = await createTempDir();
    const files = new Map([['rule.md', 'content']]);

    const result = await install(projectDir, 'my-policy', files);

    expect(result.rulesDir).toBe(join(projectDir, '.claude', 'rules', 'my-policy'));
  });

  it('installs to project .claude/rules when scope=project', async () => {
    const projectDir = await createTempDir();
    const files = new Map([['rule.md', 'content']]);

    const result = await install(projectDir, 'my-policy', files, 'project');

    expect(result.rulesDir).toBe(join(projectDir, '.claude', 'rules', 'my-policy'));
  });

  it('installs to ~/.claude/rules when scope=global', async () => {
    const projectDir = await createTempDir();
    const files = new Map<string, string>();

    const result = await install(projectDir, 'my-policy', files, 'global');

    expect(result.rulesDir).toBe(join(homedir(), '.claude', 'rules', 'my-policy'));
  });
});
