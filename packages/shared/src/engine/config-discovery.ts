import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { cosmiconfig } from 'cosmiconfig';
import type { ConfigLayerPath } from './engine-schema.js';

export const POLICY_CONFIG_SEARCH_PLACES = [
  'policy.yaml',
  'policy.yml',
  '.policyrc',
  '.policyrc.yaml',
  '.policyrc.yml',
  '.claude/policy.yaml',
  '.claude/policy.yml',
  '.claude/policyrc',
  '.claude/policyrc.yaml',
  '.claude/policyrc.yml',
  '.config/policy.yaml',
  '.config/policy.yml',
  '.config/policyrc',
  '.config/policyrc.yaml',
  '.config/policyrc.yml',
] as const;

export function getUserConfigPath(): string {
  const envPath = process.env['KGENTIC_USER_POLICY_PATH'];
  if (envPath !== undefined && envPath !== '') {
    return envPath;
  }
  return path.join(os.homedir(), '.claude', 'policy.yaml');
}

export async function discoverConfigLayers(startDir: string): Promise<ConfigLayerPath[]> {
  const layers: ConfigLayerPath[] = [];

  // User layer (precedence 0) — explicit fs.access, not cosmiconfig
  const userPath = getUserConfigPath();
  try {
    await fs.access(userPath);
    layers.push({
      source: 'user',
      path: userPath,
      precedence: 0,
      mergeMode: 'defaults',
    });
    process.stderr.write(`[policy] User config: ${userPath} (loaded)\n`);
  } catch {
    // File does not exist — not an error
    if (process.env['KGENTIC_USER_POLICY_PATH'] !== undefined && process.env['KGENTIC_USER_POLICY_PATH'] !== '') {
      process.stderr.write(
        `[policy] Warning: KGENTIC_USER_POLICY_PATH is set to ${userPath} but file not found\n`,
      );
    }
    process.stderr.write(`[policy] User config: ${userPath} (not found)\n`);
  }

  // Project layer (precedence 1) — cosmiconfig search (existing logic)
  const explorer = cosmiconfig('policy', {
    searchPlaces: [...POLICY_CONFIG_SEARCH_PLACES],
    searchStrategy: 'project',
    cache: false,
  });
  const projectResult = await explorer.search(path.resolve(startDir));
  if (projectResult?.filepath) {
    layers.push({
      source: 'project',
      path: projectResult.filepath,
      precedence: 1,
      mergeMode: 'defaults',
    });
  }

  return layers;
}

/** @deprecated Use discoverConfigLayers() instead. Returns the highest-precedence path. */
export async function discoverPolicyManifestPath(startDir: string): Promise<string | undefined> {
  const layers = await discoverConfigLayers(startDir);
  if (layers.length === 0) return undefined;
  // Return highest-precedence (project if exists, else user)
  const sorted = [...layers].sort((a, b) => b.precedence - a.precedence);
  const top = sorted[0];
  return top?.path;
}
