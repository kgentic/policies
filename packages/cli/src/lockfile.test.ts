import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  readLockfile,
  writeLockfile,
  addPolicy,
  removePolicy,
  findPolicy,
  resolveLockfilePath,
  getGlobalLockfilePath,
  getProjectLockfilePath,
} from './lockfile.js';
import type { InstalledPolicy, PolicyLockfile } from '@kgentic-ai/policies-shared';

const makePolicy = (name: string): InstalledPolicy => ({
  name,
  version: '1.0.0',
  source: 'github:kgentic/policies',
  installedAt: '2026-04-23T00:00:00.000Z',
  client: 'claude',
  rules: [{ id: 'rule-1', path: 'rules/rule-1.md', installedTo: '.claude/rules/rule-1.md' }],
});

describe('readLockfile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lockfile-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty lockfile when file does not exist', async () => {
    const lockfilePath = getProjectLockfilePath(tmpDir);
    const lockfile = await readLockfile(lockfilePath);
    expect(lockfile).toEqual({ version: 1, policies: [] });
  });

  it('round-trips write then read correctly', async () => {
    const policy = makePolicy('security-baseline');
    const original: PolicyLockfile = { version: 1, policies: [policy] };
    const lockfilePath = getProjectLockfilePath(tmpDir);

    await writeLockfile(lockfilePath, original);
    const loaded = await readLockfile(lockfilePath);

    expect(loaded).toEqual(original);
  });
});

describe('resolveLockfilePath', () => {
  it('returns global lockfile path for scope=global', () => {
    const result = resolveLockfilePath('global', '/some/project');
    expect(result).toBe(join(homedir(), '.config', 'kgentic', 'policies.lock.json'));
  });

  it('returns project lockfile path for scope=project', () => {
    const result = resolveLockfilePath('project', '/some/project');
    expect(result).toBe(join('/some/project', 'policies.lock.json'));
  });

  it('global path is under home directory', () => {
    const result = getGlobalLockfilePath();
    expect(result.startsWith(homedir())).toBe(true);
  });

  it('project path is under projectDir', () => {
    const projectDir = '/tmp/my-project';
    const result = getProjectLockfilePath(projectDir);
    expect(result.startsWith(projectDir)).toBe(true);
    expect(result.endsWith('policies.lock.json')).toBe(true);
  });
});

describe('addPolicy', () => {
  it('adds a new policy entry', () => {
    const lockfile: PolicyLockfile = { version: 1, policies: [] };
    const policy = makePolicy('my-policy');
    const result = addPolicy(lockfile, policy);
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0]?.name).toBe('my-policy');
  });

  it('replaces an existing entry with the same name (idempotent)', () => {
    const existing = makePolicy('my-policy');
    const lockfile: PolicyLockfile = { version: 1, policies: [existing] };
    const updated: InstalledPolicy = { ...existing, version: '2.0.0' };
    const result = addPolicy(lockfile, updated);
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0]?.version).toBe('2.0.0');
  });

  it('preserves other policies when replacing', () => {
    const other = makePolicy('other-policy');
    const lockfile: PolicyLockfile = { version: 1, policies: [other] };
    const newPolicy = makePolicy('my-policy');
    const result = addPolicy(lockfile, newPolicy);
    expect(result.policies).toHaveLength(2);
  });
});

describe('removePolicy', () => {
  it('removes a policy by name', () => {
    const policy = makePolicy('my-policy');
    const lockfile: PolicyLockfile = { version: 1, policies: [policy] };
    const result = removePolicy(lockfile, 'my-policy');
    expect(result.policies).toHaveLength(0);
  });

  it('is a no-op for a non-existent policy name', () => {
    const policy = makePolicy('my-policy');
    const lockfile: PolicyLockfile = { version: 1, policies: [policy] };
    const result = removePolicy(lockfile, 'does-not-exist');
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0]?.name).toBe('my-policy');
  });

  it('does not mutate the original lockfile', () => {
    const policy = makePolicy('my-policy');
    const lockfile: PolicyLockfile = { version: 1, policies: [policy] };
    removePolicy(lockfile, 'my-policy');
    expect(lockfile.policies).toHaveLength(1);
  });
});

describe('findPolicy', () => {
  it('returns the matching policy entry', () => {
    const policy = makePolicy('my-policy');
    const lockfile: PolicyLockfile = { version: 1, policies: [policy] };
    const found = findPolicy(lockfile, 'my-policy');
    expect(found).toBeDefined();
    expect(found?.name).toBe('my-policy');
  });

  it('returns undefined for a non-existent policy name', () => {
    const lockfile: PolicyLockfile = { version: 1, policies: [] };
    const found = findPolicy(lockfile, 'does-not-exist');
    expect(found).toBeUndefined();
  });
});
