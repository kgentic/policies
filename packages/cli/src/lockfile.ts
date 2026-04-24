import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { policyLockfileSchema, type PolicyLockfile, type InstalledPolicy } from '@kgentic-ai/policies-shared';

const LOCKFILE_NAME = 'policies.lock.json';

export function getGlobalLockfilePath(): string {
  return join(homedir(), '.config', 'kgentic', LOCKFILE_NAME);
}

export function getProjectLockfilePath(projectDir: string): string {
  return join(projectDir, LOCKFILE_NAME);
}

export function resolveLockfilePath(scope: 'global' | 'project', projectDir: string): string {
  if (scope === 'global') {
    return getGlobalLockfilePath();
  }
  return getProjectLockfilePath(projectDir);
}

export async function readLockfile(lockfilePath: string): Promise<PolicyLockfile> {
  try {
    const raw = await readFile(lockfilePath, 'utf-8');
    return policyLockfileSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1, policies: [] };
  }
}

export async function writeLockfile(lockfilePath: string, lockfile: PolicyLockfile): Promise<void> {
  await mkdir(dirname(lockfilePath), { recursive: true });
  await writeFile(lockfilePath, JSON.stringify(lockfile, null, 2) + '\n', 'utf-8');
}

export function addPolicy(lockfile: PolicyLockfile, entry: InstalledPolicy): PolicyLockfile {
  return {
    ...lockfile,
    policies: [...lockfile.policies.filter(p => p.name !== entry.name), entry],
  };
}

export function removePolicy(lockfile: PolicyLockfile, policyName: string): PolicyLockfile {
  return {
    ...lockfile,
    policies: lockfile.policies.filter(p => p.name !== policyName),
  };
}

export function findPolicy(lockfile: PolicyLockfile, policyName: string): InstalledPolicy | undefined {
  return lockfile.policies.find(p => p.name === policyName);
}
