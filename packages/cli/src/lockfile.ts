import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { policyLockfileSchema, type PolicyLockfile, type InstalledPolicy } from '@kgentic/policies-shared';

const LOCKFILE_NAME = 'policies.lock.json';

export async function readLockfile(projectDir: string): Promise<PolicyLockfile> {
  const lockfilePath = join(projectDir, LOCKFILE_NAME);
  try {
    const raw = await readFile(lockfilePath, 'utf-8');
    return policyLockfileSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1, policies: [] };
  }
}

export async function writeLockfile(projectDir: string, lockfile: PolicyLockfile): Promise<void> {
  const lockfilePath = join(projectDir, LOCKFILE_NAME);
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
