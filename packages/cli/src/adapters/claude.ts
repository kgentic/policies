import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface AdapterInstallResult {
  client: 'claude';
  rulesDir: string;
  filesWritten: string[];
}

export function resolveRulesDir(
  scope: 'global' | 'project',
  projectDir: string,
  policyName: string,
): string {
  if (scope === 'global') {
    return join(homedir(), '.claude', 'rules', policyName);
  }
  return join(projectDir, '.claude', 'rules', policyName);
}

export async function install(
  projectDir: string,
  policyName: string,
  files: Map<string, string>,
  scope: 'global' | 'project' = 'project',
): Promise<AdapterInstallResult> {
  const rulesDir = resolveRulesDir(scope, projectDir, policyName);
  await mkdir(rulesDir, { recursive: true });

  const filesWritten: string[] = [];

  for (const [filename, content] of files) {
    const filePath = join(rulesDir, filename);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    filesWritten.push(filePath);
  }

  return { client: 'claude', rulesDir, filesWritten };
}

export async function remove(
  _projectDir: string,
  installedRules: Array<{ installedTo: string }>,
): Promise<void> {
  for (const rule of installedRules) {
    try {
      await rm(rule.installedTo, { force: true });
    } catch {
      // File already gone, that's fine
    }
  }
}
