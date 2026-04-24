import type { LoadedPolicyAsset, LoadedPolicyManifest } from './loader.js';

export interface PolicySearchInput {
  query: string;
  event?: string;
  toolName?: string;
  command?: string;
  path?: string;
  topK?: number;
}

export interface PolicySearchResult {
  assetId: string;
  kind: LoadedPolicyAsset['kind'];
  score: number;
  files: string[];
  snippet: string;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function scoreContent(queryTokens: string[], content: string): number {
  const lower = content.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function makeSnippet(content: string, queryTokens: string[]): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (queryTokens.some((token) => lower.includes(token))) {
      return line;
    }
  }

  return lines[0] ?? '';
}

export function searchPolicies(
  loaded: LoadedPolicyManifest,
  input: PolicySearchInput,
): PolicySearchResult[] {
  const queryTokens = tokenize(input.query);
  const topK = input.topK ?? 3;

  const results: PolicySearchResult[] = [];

  for (const asset of loaded.assets.values()) {
    const contents = asset.files
      .map((file) => loaded.ruleContents.get(file))
      .filter((value): value is string => value !== undefined);

    const combined = contents.join('\n\n');
    const score = scoreContent(queryTokens, `${asset.id}\n${asset.tags.join(' ')}\n${combined}`);
    if (score === 0) {
      continue;
    }

    results.push({
      assetId: asset.id,
      kind: asset.kind,
      score,
      files: [...asset.files],
      snippet: makeSnippet(combined, queryTokens),
    });
  }

  return results
    .sort((left, right) => right.score - left.score || left.assetId.localeCompare(right.assetId))
    .slice(0, topK);
}
