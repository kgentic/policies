import { readLockfile } from '../lockfile.js';

export async function run(): Promise<void> {
  const projectDir = process.cwd();
  const lockfile = await readLockfile(projectDir);

  if (lockfile.policies.length === 0) {
    console.log('No policies installed.');
    return;
  }

  console.log('Installed policies:\n');
  for (const policy of lockfile.policies) {
    console.log(`  ${policy.name}@${policy.version}`);
    console.log(`    Source: ${policy.source}`);
    console.log(`    Client: ${policy.client}`);
    console.log(`    Rules:  ${policy.rules.length}`);
    console.log(`    Installed: ${policy.installedAt}`);
    console.log('');
  }
}
