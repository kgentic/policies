import { fetchPolicy } from '../github.js';
import { getAdapter, type ClientName } from '../adapters/index.js';
import { readLockfile, writeLockfile, addPolicy, resolveLockfilePath } from '../lockfile.js';
import { parseSource } from '../source-parser.js';
import type { InstalledPolicy } from '@kgentic/policies-shared';
import { join } from 'node:path';

export async function run(
  args: string[],
  options: { client: ClientName; ref?: string; scope?: 'global' | 'project' },
): Promise<void> {
  const sourceArg = args[0];
  const policyName = args[1];

  if (!sourceArg || !policyName) {
    throw new Error(
      'Usage: policies add <source> <policy-name>\n  Example: policies add kgentic/policies swe-essentials',
    );
  }

  const parsed = parseSource(sourceArg);
  // --ref flag overrides #ref from source
  const ref = options.ref ?? parsed.ref;
  const { source } = parsed;
  const scope = options.scope ?? 'project';

  const projectDir = process.cwd();

  // 1. Fetch from GitHub
  console.log(`Fetching ${policyName} from ${source}@${ref}...`);
  const { manifest, files } = await fetchPolicy(source, policyName, ref);

  // 2. Install via adapter
  const adapter = getAdapter(options.client);
  const result = await adapter.install(projectDir, policyName, files, scope);

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

  // 4. Update lockfile (scope-aware path)
  const lockfilePath = resolveLockfilePath(scope, projectDir);
  const lockfile = await readLockfile(lockfilePath);
  const updated = addPolicy(lockfile, entry);
  await writeLockfile(lockfilePath, updated);

  // 5. Report
  console.log(`✓ Installed ${manifest.name}@${manifest.version} (${result.filesWritten.length} rules)`);
  console.log(`  Source: ${source}@${ref}`);
  console.log(`  Client: ${options.client}`);
  console.log(`  Scope:  ${scope}`);
  console.log(`  Rules dir: ${result.rulesDir}`);
}
