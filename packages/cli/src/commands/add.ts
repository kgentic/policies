import { fetchPolicy } from '../github.js';
import { getAdapter, type ClientName } from '../adapters/index.js';
import { readLockfile, writeLockfile, addPolicy } from '../lockfile.js';
import type { InstalledPolicy } from '@kgentic/policies-shared';
import { join } from 'node:path';

export async function run(args: string[], options: { client: ClientName }): Promise<void> {
  const source = args[0];
  const policyName = args[1];

  if (!source || !policyName) {
    throw new Error(
      'Usage: policies add <source> <policy-name>\n  Example: policies add kgentic/policies swe-essentials',
    );
  }

  const projectDir = process.cwd();

  // 1. Fetch from GitHub
  console.log(`Fetching ${policyName} from ${source}...`);
  const { manifest, files } = await fetchPolicy(source, policyName);

  // 2. Install via adapter
  const adapter = getAdapter(options.client);
  const result = await adapter.install(projectDir, policyName, files);

  // 3. Build lockfile entry
  const entry: InstalledPolicy = {
    name: manifest.name,
    version: manifest.version,
    source,
    installedAt: new Date().toISOString(),
    client: options.client,
    rules: manifest.rules.map((rule) => ({
      id: rule.id,
      path: rule.path,
      installedTo: join(result.rulesDir, rule.path),
    })),
  };

  // 4. Update lockfile
  const lockfile = await readLockfile(projectDir);
  const updated = addPolicy(lockfile, entry);
  await writeLockfile(projectDir, updated);

  // 5. Report
  console.log(`✓ Installed ${manifest.name}@${manifest.version} (${result.filesWritten.length} rules)`);
  console.log(`  Source: ${source}`);
  console.log(`  Client: ${options.client}`);
  console.log(`  Rules dir: ${result.rulesDir}`);
}
