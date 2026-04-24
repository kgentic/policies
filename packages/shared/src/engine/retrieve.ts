import type { PolicyHook } from './engine-schema.js';
import type { LoadedPolicyManifest } from './loader.js';
import { getAssetFilesForHook } from './loader.js';
import type { PolicyEvaluationInput } from './evaluator.js';

interface RuleSection {
  heading: string;
  text: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/)
    .filter((t) => t.length > 1);
}

function buildQueryTokens(input: PolicyEvaluationInput): string[] {
  const parts: string[] = [];

  if (input.toolName !== undefined) {
    parts.push(input.toolName);
  }

  if (input.event !== undefined) {
    parts.push(input.event);
  }

  if (input.path !== undefined) {
    // Split path into components: "src/api/auth.ts" → ["src", "api", "auth", "ts"]
    parts.push(...input.path.replace(/\\/g, '/').split(/[/.]/).filter((p) => p.length > 0));
  }

  if (input.command !== undefined) {
    // Split command into words, filtering short tokens
    parts.push(...input.command.split(/\s+/).filter((w) => w.length > 1));
  }

  return tokenize(parts.join(' '));
}

function splitIntoSections(content: string): RuleSection[] {
  const sections: RuleSection[] = [];
  let currentHeading = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#')) {
      currentHeading = trimmed;
      continue;
    }

    if (trimmed.startsWith('- ')) {
      sections.push({ heading: currentHeading, text: trimmed });
    }
  }

  return sections;
}

function scoreSection(section: RuleSection, queryTokens: string[]): number {
  const combined = `${section.heading} ${section.text}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (combined.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function formatSection(section: RuleSection): string {
  if (section.heading.length === 0) {
    return section.text;
  }
  return `${section.heading}\n${section.text}`;
}

export function retrieveRelevantContent(
  loaded: LoadedPolicyManifest,
  hook: PolicyHook,
  input: PolicyEvaluationInput,
): string {
  const topK = hook.retrieve?.top_k ?? 3;

  const files = getAssetFilesForHook(hook, loaded.assets);
  const allContent = files
    .map((file) => loaded.ruleContents.get(file))
    .filter((value): value is string => value !== undefined)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\n\n');

  if (allContent.length === 0) {
    return '';
  }

  const sections = splitIntoSections(allContent);

  // Fall back to full content if no bullet sections were found
  if (sections.length === 0) {
    return allContent;
  }

  const queryTokens = buildQueryTokens(input);

  const scored = sections
    .map((section, index) => ({ section, score: scoreSection(section, queryTokens), index }))
    // Stable sort: descending score, then original order for ties
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, topK);

  const result = scored.map(({ section }) => formatSection(section)).join('\n\n');
  return result;
}
