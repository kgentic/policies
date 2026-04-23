import { readLockfile, writeLockfile, removePolicy, findPolicy } from '../lockfile.js';
import { getAdapter, type ClientName } from '../adapters/index.js';

export async function run(args: string[], options: { client: ClientName }): Promise<void> {
  const policyName = args[0];

  if (!policyName) {
    throw new Error('Usage: policies remove <policy-name>');
  }

  const projectDir = process.cwd();
  const lockfile = await readLockfile(projectDir);
  const existing = findPolicy(lockfile, policyName);

  if (!existing) {
    throw new Error(`Policy "${policyName}" is not installed.`);
  }

  // Remove files via adapter
  const adapter = getAdapter((existing.client as ClientName) || options.client);
  await adapter.remove(projectDir, existing.rules);

  // Update lockfile
  const updated = removePolicy(lockfile, policyName);
  await writeLockfile(projectDir, updated);

  console.log(`✓ Removed ${policyName}`);
}
