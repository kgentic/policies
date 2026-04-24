import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from './add.js';

const validManifestYaml = `
name: test-policy
version: 1.0.0
description: A test policy
rules:
  - id: no-any
    path: rules/no-any.md
  - id: strict-types
    path: rules/strict-types.md
`;

function makeResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('add command', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'policies-add-test-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('fetches, installs files, and writes lockfile', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('policy.yaml')) {
        return Promise.resolve(makeResponse(validManifestYaml));
      }
      if (url.endsWith('no-any.md')) {
        return Promise.resolve(makeResponse('# No Any\nDo not use any type.'));
      }
      if (url.endsWith('strict-types.md')) {
        return Promise.resolve(makeResponse('# Strict Types\nAlways use strict types.'));
      }
      return Promise.resolve(makeResponse('', 404));
    });
    vi.stubGlobal('fetch', mockFetch);

    await run(['kgentic/policies', 'test-policy'], { client: 'claude' });

    // Verify files written to .claude/rules/test-policy/
    const rulesDir = join(tmpDir, '.claude', 'rules', 'test-policy');
    const noAnyContent = await readFile(join(rulesDir, 'rules', 'no-any.md'), 'utf-8');
    const strictTypesContent = await readFile(join(rulesDir, 'rules', 'strict-types.md'), 'utf-8');

    expect(noAnyContent).toBe('# No Any\nDo not use any type.');
    expect(strictTypesContent).toBe('# Strict Types\nAlways use strict types.');

    // Verify lockfile created with correct entry
    const lockfileRaw = await readFile(join(tmpDir, 'policies.lock.json'), 'utf-8');
    const lockfile = JSON.parse(lockfileRaw);

    expect(lockfile.version).toBe(1);
    expect(lockfile.policies).toHaveLength(1);

    const policy = lockfile.policies[0];
    expect(policy.name).toBe('test-policy');
    expect(policy.version).toBe('1.0.0');
    expect(policy.source).toBe('kgentic/policies@main');
    expect(policy.client).toBe('claude');
    expect(policy.rules).toHaveLength(2);
    expect(policy.rules[0].id).toBe('no-any');
    expect(policy.rules[0].path).toBe('rules/no-any.md');
    expect(policy.rules[0].installedTo).toBe(join(rulesDir, 'rules', 'no-any.md'));
    expect(policy.rules[1].id).toBe('strict-types');
    expect(policy.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws when source arg is missing', async () => {
    await expect(run([], { client: 'claude' })).rejects.toThrow(
      'Usage: policies add <source> <policy-name>',
    );
  });

  it('throws when policy-name arg is missing', async () => {
    await expect(run(['kgentic/policies'], { client: 'claude' })).rejects.toThrow(
      'Usage: policies add <source> <policy-name>',
    );
  });

  it('propagates fetch failure errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse('Not Found', 404));
    vi.stubGlobal('fetch', mockFetch);

    await expect(run(['kgentic/policies', 'test-policy'], { client: 'claude' })).rejects.toThrow(
      'Failed to fetch policy manifest: 404 Not Found',
    );
  });

  it('uses process.cwd() as the project directory', async () => {
    expect(cwdSpy).toBeDefined();

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('policy.yaml')) {
        return Promise.resolve(makeResponse(validManifestYaml));
      }
      return Promise.resolve(makeResponse('# Rule content'));
    });
    vi.stubGlobal('fetch', mockFetch);

    await run(['kgentic/policies', 'test-policy'], { client: 'claude' });

    // cwd was called to get the project dir
    expect(cwdSpy).toHaveBeenCalled();

    // lockfile landed in tmpDir, confirming cwd() was used
    const lockfileRaw = await readFile(join(tmpDir, 'policies.lock.json'), 'utf-8');
    const lockfile = JSON.parse(lockfileRaw);
    expect(lockfile.policies[0].name).toBe('test-policy');
  });

  it('overwrites existing policy entry in lockfile on re-install', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('policy.yaml')) {
        return Promise.resolve(makeResponse(validManifestYaml));
      }
      return Promise.resolve(makeResponse('# Rule'));
    });
    vi.stubGlobal('fetch', mockFetch);

    // Install twice
    await run(['kgentic/policies', 'test-policy'], { client: 'claude' });
    await run(['kgentic/policies', 'test-policy'], { client: 'claude' });

    const lockfileRaw = await readFile(join(tmpDir, 'policies.lock.json'), 'utf-8');
    const lockfile = JSON.parse(lockfileRaw);

    // Should still be exactly one entry, not two
    expect(lockfile.policies).toHaveLength(1);
  });
});
