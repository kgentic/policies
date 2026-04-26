import path from 'node:path';
import { createActionHash } from './approvals.js';
import { LAYER_PRECEDENCE } from './engine-schema.js';
import type { PolicyDecision, PolicyHook, LayerSource } from './engine-schema.js';
import type { ResolvedManifest } from './loader.js';
import { getAssetFilesForHook } from './loader.js';
import { matchesGlob } from './glob.js';
import { retrieveRelevantContent } from './retrieve.js';

export interface PolicyEvaluationInput {
  event: string;
  toolName?: string;
  command?: string;
  path?: string;
}

export interface MatchedDecideHook {
  hookId: string;
  decision: PolicyDecision;
  systemMessage: string;
  actionHash: string;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  matched: boolean;
  hookId?: string;
  mode?: PolicyHook['mode'];
  systemMessage: string;
  matchedFiles: string[];
  actionHash?: string;
  matchedDecideHooks: MatchedDecideHook[];
  explanation?: {
    hookId?: string;
    matchedFiles: string[];
    reason: string;
  };
}

function matchesMatcher(toolName: string | undefined, matcher: string): boolean {
  if (matcher === '*') {
    return true;
  }

  if (toolName === undefined) {
    return false;
  }

  const parts = matcher.split('|').map((part) => part.trim()).filter(Boolean);
  return parts.includes(toolName);
}

function matchesAny(value: string | undefined, patterns: string[] | undefined): boolean {
  if (patterns === undefined || patterns.length === 0) {
    return true;
  }
  if (value === undefined) {
    // A wildcard-only pattern list matches even when value is absent
    // (e.g., SessionStart has no toolName, but when.tools: ["*"] should still match)
    return patterns.length === 1 && patterns[0] === '*';
  }
  return patterns.some((pattern) => matchesGlob(value, pattern));
}

function normalizePath(inputPath: string | undefined, baseDir: string): string | undefined {
  if (inputPath === undefined) {
    return undefined;
  }
  const forward = inputPath.replace(/\\/g, '/');
  if (path.isAbsolute(forward)) {
    return path.relative(baseDir, forward).replace(/\\/g, '/');
  }
  return forward;
}

function hookMatches(input: PolicyEvaluationInput, hook: PolicyHook, manifestDir: string): boolean {
  if (hook.event !== input.event) {
    return false;
  }
  if (!matchesMatcher(input.toolName, hook.matcher)) {
    return false;
  }
  if (!matchesAny(input.command, hook.when.commands)) {
    return false;
  }
  if (!matchesAny(normalizePath(input.path, manifestDir), hook.when.paths)) {
    return false;
  }
  if (!matchesAny(input.toolName, hook.when.tools)) {
    return false;
  }
  return true;
}

function buildSystemMessage(loaded: ResolvedManifest, hook: PolicyHook): string {
  const files = getAssetFilesForHook(hook, loaded.assets);
  const snippets = files
    .map((file) => loaded.ruleContents.get(file))
    .filter((value): value is string => value !== undefined)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (snippets.length === 0) {
    return '';
  }

  const heading = `Policy ${hook.mode} triggered by ${hook.id}.`;
  return `${heading}\n\n${snippets.join('\n\n')}`.trim();
}

export function resolveStopDecision(result: PolicyEvaluationResult): 'approve' | 'block' {
  if (result.matched && (result.decision === 'approve' || result.decision === 'block')) {
    return result.decision;
  }
  return 'approve';
}

const DECISION_SEVERITY: Record<string, number> = {
  allow: 0,
  approve: 0,
  ask: 1,
  deny: 2,
  block: 2,
};

function decisionSeverity(decision: string): number {
  return DECISION_SEVERITY[decision] ?? 0;
}

export function evaluatePolicy(
  loaded: ResolvedManifest,
  input: PolicyEvaluationInput,
  options?: { workspaceRoot?: string },
): PolicyEvaluationResult {
  const resolvedManifest = path.resolve(loaded.manifestPath);
  const manifestDir = path.dirname(resolvedManifest);
  const projectRoot = path.basename(manifestDir) === '.claude'
    ? path.dirname(manifestDir)
    : manifestDir;

  const matched: Array<{ hook: PolicyHook; decision: PolicyDecision; severity: number }> = [];

  for (const hook of loaded.manifest.hooks) {
    if (!hookMatches(input, hook, projectRoot)) {
      continue;
    }

    const decision: PolicyDecision = hook.mode === 'decide' ? hook.decision ?? 'allow' : 'allow';
    const severity = decisionSeverity(decision);
    matched.push({ hook, decision, severity });
  }

  if (matched.length === 0) {
    return {
      decision: 'allow',
      matched: false,
      systemMessage: '',
      matchedFiles: [],
      matchedDecideHooks: [],
      explanation: {
        matchedFiles: [],
        reason: 'No policy hook matched; default allow applied',
      },
    };
  }

  const winner = matched.reduce((a, b) => {
    // 1. Severity: most restrictive wins
    if (b.severity !== a.severity) {
      return b.severity > a.severity ? b : a;
    }
    // 2. Layer precedence: higher layer wins (project > user)
    const aSource: LayerSource = loaded.effectiveSource.get(a.hook.id) ?? 'project';
    const bSource: LayerSource = loaded.effectiveSource.get(b.hook.id) ?? 'project';
    const aLayerPrec = LAYER_PRECEDENCE[aSource] ?? 0;
    const bLayerPrec = LAYER_PRECEDENCE[bSource] ?? 0;
    if (bLayerPrec !== aLayerPrec) {
      return bLayerPrec > aLayerPrec ? b : a;
    }
    // 3. Intra-layer priority: higher integer wins
    const aPriority = a.hook.priority ?? 0;
    const bPriority = b.hook.priority ?? 0;
    if (bPriority !== aPriority) {
      return bPriority > aPriority ? b : a;
    }
    // 4. Source order: last-wins (CSS cascade)
    return b;
  });

  function buildHookMessage(m: { hook: PolicyHook; decision: PolicyDecision; severity: number }): string {
    if (m.hook.retrieve?.enabled === true) {
      const content = retrieveRelevantContent(loaded, m.hook, input);
      if (content.length === 0) {
        return '';
      }
      const heading = `Policy ${m.hook.mode} triggered by ${m.hook.id}.`;
      return `${heading}\n\n${content}`.trim();
    }
    return buildSystemMessage(loaded, m.hook);
  }

  const allMessages = matched
    .map(buildHookMessage)
    .filter((msg) => msg.length > 0);
  const combinedSystemMessage = allMessages.join('\n\n');

  const allMatchedFiles = [...new Set(
    matched.flatMap((m) => getAssetFilesForHook(m.hook, loaded.assets)),
  )].map((file) => path.relative(options?.workspaceRoot ?? process.cwd(), file));

  const allHookIds = matched.map((m) => m.hook.id).filter((id): id is string => id !== undefined);

  // Build the list of decide hooks with ask/deny decisions for per-hook sequential approval
  const matchedDecideHooks: MatchedDecideHook[] = matched
    .filter((m) => m.hook.mode === 'decide' && m.hook.id !== undefined && (m.decision === 'ask' || m.decision === 'deny'))
    .map((m) => ({
      hookId: m.hook.id as string,
      decision: m.decision,
      systemMessage: buildHookMessage(m),
      actionHash: createActionHash(input, m.hook.id as string),
    }));

  const explanationBase = `Matched policy hooks [${allHookIds.join(', ')}] using most-restrictive-wins evaluation`;
  const sameSeverityOthers = matched.filter((m) => m.severity === winner.severity && m.hook !== winner.hook);

  let resolutionReason: string;
  if (sameSeverityOthers.length === 0) {
    resolutionReason = `${explanationBase}; decision from ${winner.hook.id}`;
  } else {
    const winnerLayerPrec = LAYER_PRECEDENCE[loaded.effectiveSource.get(winner.hook.id) ?? 'project'] ?? 0;
    const hasDifferentLayer = sameSeverityOthers.some((m) => {
      const s: LayerSource = loaded.effectiveSource.get(m.hook.id) ?? 'project';
      return (LAYER_PRECEDENCE[s] ?? 0) !== winnerLayerPrec;
    });
    const hasDifferentPriority = sameSeverityOthers.some((m) => (m.hook.priority ?? 0) !== (winner.hook.priority ?? 0));

    if (hasDifferentLayer) {
      resolutionReason = `${explanationBase}; layer precedence selected ${winner.hook.id}`;
    } else if (hasDifferentPriority) {
      resolutionReason = `${explanationBase}; priority tiebreaker selected ${winner.hook.id}`;
    } else {
      resolutionReason = `${explanationBase}; source order selected ${winner.hook.id}`;
    }
  }

  return {
    decision: winner.decision,
    matched: true,
    hookId: winner.hook.id,
    mode: winner.hook.mode,
    systemMessage: combinedSystemMessage,
    matchedFiles: allMatchedFiles,
    matchedDecideHooks,
    actionHash: winner.hook.id !== undefined ? createActionHash(input, winner.hook.id) : undefined,
    explanation: {
      hookId: winner.hook.id,
      matchedFiles: allMatchedFiles,
      reason: resolutionReason,
    },
  };
}
