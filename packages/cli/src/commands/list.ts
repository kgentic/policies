import { readLockfile, resolveLockfilePath } from '../lockfile.js';
import type { PolicyLockfile } from '@kgentic-ai/policies-shared';

function printLockfile(lockfile: PolicyLockfile, label: string): void {
  if (lockfile.policies.length === 0) {
    console.log(`No ${label} policies installed.`);
    return;
  }

  console.log(`${label} policies:\n`);
  for (const policy of lockfile.policies) {
    console.log(`  ${policy.name}@${policy.version}`);
    console.log(`    Source: ${policy.source}`);
    console.log(`    Client: ${policy.client}`);
    console.log(`    Rules:  ${policy.rules.length}`);
    console.log(`    Installed: ${policy.installedAt}`);
    console.log('');
  }
}

export async function run(options: { scope: 'global' | 'project' | 'both' }): Promise<void> {
  const projectDir = process.cwd();

  if (options.scope === 'global') {
    const lockfilePath = resolveLockfilePath('global', projectDir);
    const lockfile = await readLockfile(lockfilePath);
    printLockfile(lockfile, 'Global');
    return;
  }

  if (options.scope === 'project') {
    const lockfilePath = resolveLockfilePath('project', projectDir);
    const lockfile = await readLockfile(lockfilePath);
    printLockfile(lockfile, 'Project');
    return;
  }

  // Both: show global then project
  const globalPath = resolveLockfilePath('global', projectDir);
  const projectPath = resolveLockfilePath('project', projectDir);
  const [globalLockfile, projectLockfile] = await Promise.all([
    readLockfile(globalPath),
    readLockfile(projectPath),
  ]);

  printLockfile(globalLockfile, 'Global');
  printLockfile(projectLockfile, 'Project');
}
