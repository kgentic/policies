import { fetchPolicy } from '../github.js';
import { loadLocalPolicy } from '../local.js';
import { getAdapter, type ClientName } from '../adapters/index.js';
import { readLockfile, writeLockfile, addPolicy, resolveLockfilePath } from '../lockfile.js';
import { parseSource } from '../source-parser.js';
import type { InstalledPolicy, PolicyManifest } from '@kgentic-ai/policies-shared';
import { join } from 'node:path';

export async function run(
  args: string[],
  options: { client: ClientName; ref?: string; scope?: 'global' | 'project' },
): Promise<void> {
  const sourceArg = args[0];
  const policyName = args[1];

  if (!sourceArg || !policyName) {
    throw new Error(
      'Usage: policies add <source> <policy-name>\n  Example: policies add kgentic/policies swe-essentials\n  Example: policies add ./path/to/repo swe-essentials',
    );
  }

  const parsed = parseSource(sourceArg);
  const scope = options.scope ?? 'project';
  const projectDir = process.cwd();

  let manifest: PolicyManifest;
  let files: Map<string, string>;
  let sourceLabel: string;

  if (parsed.type === 'local') {
    console.log(`Loading ${policyName} from ${parsed.path}...`);
    const result = await loadLocalPolicy(parsed.path, policyName);
    manifest = result.manifest;
    files = result.files;
    sourceLabel = parsed.path;
  } else {
    const ref = options.ref ?? parsed.ref;
    console.log(`Fetching ${policyName} from ${parsed.source}@${ref}...`);
    const result = await fetchPolicy(parsed.source, policyName, ref);
    manifest = result.manifest;
    files = result.files;
    sourceLabel = `${parsed.source}@${ref}`;
  }

  // 2. Install via adapter
  const adapter = getAdapter(options.client);
  const result = await adapter.install(projectDir, policyName, files, scope);

  // 3. Build lockfile entry
  const entry: InstalledPolicy = {
    name: manifest.name,
    version: manifest.version,
    source: sourceLabel,
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
  console.log(`  Source: ${sourceLabel}`);
  console.log(`  Client: ${options.client}`);
  console.log(`  Scope:  ${scope}`);
  console.log(`  Rules dir: ${result.rulesDir}`);
}
