import { parse as parseYaml } from 'yaml';
import { policyManifestSchema, type PolicyManifest } from '@kgentic-ai/policies-shared';

export function buildRawUrl(
  source: string,
  policyName: string,
  filePath: string,
  ref = 'main',
): string {
  return `https://raw.githubusercontent.com/${source}/${ref}/policies/${policyName}/${filePath}`;
}

export async function fetchPolicyManifest(
  source: string,
  policyName: string,
  ref = 'main',
): Promise<PolicyManifest> {
  const url = buildRawUrl(source, policyName, 'policy.yaml', ref);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch policy manifest: ${response.status} ${response.statusText} (${url})`);
  }
  const text = await response.text();
  const parsed = parseYaml(text) as unknown;
  return policyManifestSchema.parse(parsed);
}

export async function fetchRuleFile(
  source: string,
  policyName: string,
  rulePath: string,
  ref = 'main',
): Promise<string> {
  const url = buildRawUrl(source, policyName, rulePath, ref);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch rule file: ${response.status} ${response.statusText} (${url})`);
  }
  return response.text();
}

export async function fetchPolicy(
  source: string,
  policyName: string,
  ref = 'main',
): Promise<{ manifest: PolicyManifest; files: Map<string, string> }> {
  const manifest = await fetchPolicyManifest(source, policyName, ref);
  const files = new Map<string, string>();

  const fetches = manifest.rules.map(async (rule) => {
    const content = await fetchRuleFile(source, policyName, rule.path, ref);
    files.set(rule.path, content);
  });

  await Promise.all(fetches);
  return { manifest, files };
}
