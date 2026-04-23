import { readLockfile, writeLockfile, removePolicy, findPolicy, resolveLockfilePath } from '../lockfile.js';
import { getAdapter, isClientName, type ClientName } from '../adapters/index.js';

export async function run(
  args: string[],
  options: { client: ClientName; scope?: 'global' | 'project' },
): Promise<void> {
  const policyName = args[0];

  if (!policyName) {
    throw new Error('Usage: policies remove <policy-name>');
  }

  const projectDir = process.cwd();
  const scope = options.scope ?? 'project';
  const lockfilePath = resolveLockfilePath(scope, projectDir);
  const lockfile = await readLockfile(lockfilePath);
  const existing = findPolicy(lockfile, policyName);

  if (!existing) {
    throw new Error(`Policy "${policyName}" is not installed.`);
  }

  // Remove files via adapter — prefer client stored in lockfile, fall back to CLI flag
  const clientName = isClientName(existing.client) ? existing.client : options.client;
  const adapter = getAdapter(clientName);
  await adapter.remove(projectDir, existing.rules);

  // Update lockfile
  const updated = removePolicy(lockfile, policyName);
  await writeLockfile(lockfilePath, updated);

  console.log(`✓ Removed ${policyName}`);
}
