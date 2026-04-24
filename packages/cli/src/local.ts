import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { policyManifestSchema, type PolicyManifest } from '@kgentic-ai/policies-shared';

export async function loadLocalPolicy(
  basePath: string,
  policyName: string,
): Promise<{ manifest: PolicyManifest; files: Map<string, string> }> {
  const resolvedBase = resolve(basePath.replace(/^~/, process.env['HOME'] ?? '~'));
  const policyDir = join(resolvedBase, 'policies', policyName);

  const manifestPath = join(policyDir, 'policy.yaml');
  const manifestText = await fs.readFile(manifestPath, 'utf8').catch(() => {
    throw new Error(`Policy manifest not found: ${manifestPath}`);
  });

  const parsed = parseYaml(manifestText) as unknown;
  const manifest = policyManifestSchema.parse(parsed);

  const files = new Map<string, string>();
  const reads = manifest.rules.map(async (rule) => {
    const rulePath = join(policyDir, rule.path);
    const content = await fs.readFile(rulePath, 'utf8').catch(() => {
      throw new Error(`Rule file not found: ${rulePath}`);
    });
    files.set(rule.path, content);
  });

  await Promise.all(reads);
  return { manifest, files };
}
