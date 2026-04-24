import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { policyManifestSchema } from '@kgentic-ai/policies-shared';

export async function run(args: string[]): Promise<void> {
  const targetDir = resolve(args[0] ?? '.');

  const manifestPath = join(targetDir, 'policy.yaml');
  let manifestText: string;
  try {
    manifestText = await fs.readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(`No policy.yaml found at ${manifestPath}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(manifestText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid YAML in policy.yaml: ${msg}`);
  }

  try {
    const manifest = policyManifestSchema.parse(parsed);

    // Check rule files exist
    const missing: string[] = [];
    const found: string[] = [];
    for (const rule of manifest.rules) {
      const rulePath = join(targetDir, rule.path);
      try {
        await fs.access(rulePath);
        found.push(rule.path);
      } catch {
        missing.push(rule.path);
      }
    }

    console.log(`✓ policy.yaml is valid`);
    console.log(`  Name:    ${manifest.name}`);
    console.log(`  Version: ${manifest.version}`);
    console.log(`  Rules:   ${manifest.rules.length}`);

    if (found.length > 0) {
      console.log(`  Files:   ${found.length}/${manifest.rules.length} found`);
    }

    if (missing.length > 0) {
      console.log('');
      for (const path of missing) {
        console.log(`  ✗ missing: ${path}`);
      }
      throw new Error(`${missing.length} rule file(s) not found`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'ZodError') {
      const zodErr = err as Error & { issues: Array<{ path: (string | number)[]; message: string }> };
      console.log('✗ policy.yaml failed schema validation:\n');
      for (const issue of zodErr.issues) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        console.log(`  ✗ ${path}: ${issue.message}`);
      }
      process.exit(1);
    }
    throw err;
  }
}
