import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  createRuleFile,
  formatPolicyYamlFile,
  getPolicyManifestState,
  listGovernableTools,
  listPolicyTemplates,
  proposePolicyRule,
  writePolicyFiles,
  findActiveApproval,
  readApprovals,
  discoverPolicyManifestPath,
  evaluatePolicy,
  loadPolicyManifest,
  validatePolicyManifest,
  searchPolicies,
  EngineManifestSchema,
  PolicyDecisionSchema,
  PolicyHookEventSchema,
  PolicyHookModeSchema,
  PolicyRuleLevelSchema,
  type PolicyEvaluationInput,
  type EngineManifest,
  type EngineRule,
  type EngineRulepack,
  type PolicyHook,
} from '@kgentic-ai/policies-shared';

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
};

let _workspaceRoot: string = process.cwd();

export function setWorkspaceRoot(root: string): void {
  _workspaceRoot = root;
}

function textResult(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

function workspaceRootFromManifestPath(manifestPath: string): string {
  return path.dirname(path.resolve(manifestPath));
}

const DEFAULT_MANIFEST_PATH = '.claude/policy.yaml';

async function resolveManifestPath(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const discovered = await discoverPolicyManifestPath(_workspaceRoot);
  if (discovered) return discovered;
  throw new Error(
    'No policy manifest found. Searched: policy.yaml, .claude/policy.yaml, .config/policy.yaml and variants. ' +
    'Create one with apply_policy_change or place a policy.yaml in .claude/',
  );
}

async function resolveManifestPathForWrite(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const discovered = await discoverPolicyManifestPath(_workspaceRoot);
  if (discovered) return discovered;
  return path.join(_workspaceRoot, DEFAULT_MANIFEST_PATH);
}

async function resolveManifestPathForScope(scope: 'user' | 'project', explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (scope === 'user') {
    // User-scope config lives at ~/.claude/policy.yaml
    return path.join(os.homedir(), '.claude', 'policy.yaml');
  }
  return resolveManifestPathForWrite();
}

const scopeSchema = z.enum(['user', 'project']).default('project').describe(
  'Config scope: user (global ~/.claude/policy.yaml) or project (this repo).',
);

const manifestPathSchema = z.string().optional().describe(
  'Path to policy.yaml. If omitted, auto-discovered via cosmiconfig search.',
);

export const validatePolicyPackTool = {
  name: 'validate_policy_pack',
  description: 'Validate policy.yaml and all referenced policy rule files.',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
  }),
  async execute(input: { manifestPath?: string }): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPath(input.manifestPath);
      const result = await validatePolicyManifest(resolved);
      return textResult(result);
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const evaluatePolicyTool = {
  name: 'evaluate_policy',
  description: 'Evaluate a policy decision for a proposed Claude Code hook context. Set verbose=true for full explanation (hook ID, matched files, approval status).',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
    event: z.string(),
    toolName: z.string().optional(),
    command: z.string().optional(),
    path: z.string().optional(),
    verbose: z.boolean().default(false).describe('Include full explanation with hook ID, matched files, and approval details.'),
  }),
  async execute(input: { manifestPath?: string; verbose?: boolean } & PolicyEvaluationInput): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPath(input.manifestPath);
      const loaded = await loadPolicyManifest(resolved);
      const result = evaluatePolicy(loaded, input);
      const workspaceRoot = workspaceRootFromManifestPath(resolved);
      const approval = result.actionHash !== undefined
        ? await findActiveApproval(workspaceRoot, result.actionHash)
        : { matched: false };

      if (input.verbose) {
        return textResult({
          ok: true,
          hash: loaded.hash,
          decision: approval.matched ? 'allow' : result.decision,
          matched: result.matched,
          hookId: result.hookId,
          matchedFiles: result.matchedFiles,
          actionHash: result.actionHash,
          approval: approval.record,
          explanation: approval.matched
            ? 'A prior non-expired approval record matched this action, so the original ask decision was upgraded to allow.'
            : result.explanation?.reason ?? 'No explanation available.',
        });
      }

      return textResult({
        ok: true,
        hash: loaded.hash,
        result: approval.matched
          ? {
              ...result,
              decision: 'allow',
              reusedApproval: approval.record,
              explanation: {
                hookId: result.hookId,
                matchedFiles: result.matchedFiles,
                reason: 'Matching approval record found; policy ask reused as allow',
              },
            }
          : result,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const searchPoliciesTool = {
  name: 'search_policies',
  description: 'Search policy rule files for relevant policy guidance.',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
    query: z.string().min(1),
    topK: z.number().int().positive().max(10).default(3),
  }),
  async execute(input: { manifestPath?: string; query: string; topK: number }): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPath(input.manifestPath);
      const loaded = await loadPolicyManifest(resolved);
      const results = searchPolicies(loaded, {
        query: input.query,
        topK: input.topK,
      });
      return textResult({
        ok: true,
        hash: loaded.hash,
        results,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const listPolicyAssetsTool = {
  name: 'list_policy_assets',
  description: 'List policy rulepacks, rules, and referenced files from policy.yaml.',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
  }),
  async execute(input: { manifestPath?: string }): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPath(input.manifestPath);
      const loaded = await loadPolicyManifest(resolved);
      return textResult({
        ok: true,
        hash: loaded.hash,
        assets: [...loaded.assets.values()].map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          tags: asset.tags,
          files: asset.files,
        })),
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const explainPolicyDecisionTool = {
  name: 'explain_policy_decision',
  description: 'Explain why a policy decision was reached for a proposed hook context.',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
    event: z.string(),
    toolName: z.string().optional(),
    command: z.string().optional(),
    path: z.string().optional(),
  }),
  async execute(input: { manifestPath?: string } & PolicyEvaluationInput): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPath(input.manifestPath);
      const loaded = await loadPolicyManifest(resolved);
      const result = evaluatePolicy(loaded, input);
      const workspaceRoot = workspaceRootFromManifestPath(resolved);
      const approval = result.actionHash !== undefined
        ? await findActiveApproval(workspaceRoot, result.actionHash)
        : { matched: false };

      return textResult({
        ok: true,
        hash: loaded.hash,
        decision: approval.matched ? 'allow' : result.decision,
        matched: result.matched,
        hookId: result.hookId,
        matchedFiles: result.matchedFiles,
        actionHash: result.actionHash,
        approval: approval.record,
        explanation: approval.matched
          ? 'A prior non-expired approval record matched this action, so the original ask decision was upgraded to allow.'
          : result.explanation?.reason ?? 'No explanation available.',
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const listApprovalsTool = {
  name: 'list_approvals',
  description: 'List persisted approval records for the current workspace.',
  inputSchema: z.object({
    workspaceRoot: z.string().default('.'),
  }),
  async execute(input: { workspaceRoot: string }): Promise<ToolResult> {
    try {
      const approvals = await readApprovals(input.workspaceRoot);
      return textResult({
        ok: true,
        approvals,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const listGovernableToolsTool = {
  name: 'list_governable_tools',
  description: 'List native Claude tools, policy MCP tools, and best-effort external MCP tool patterns that can be governed by policy.',
  inputSchema: z.object({
    workspaceRoot: z.string().default('.'),
  }),
  async execute(input: { workspaceRoot: string }): Promise<ToolResult> {
    try {
      const tools = await listGovernableTools(input.workspaceRoot);
      return textResult({
        ok: true,
        tools,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const getPolicyManifestTool = {
  name: 'get_policy_manifest',
  description: 'Load the current policy.yaml, resolved rule files, and validation warnings. When multiple config layers exist, also returns layers, effectiveSource, and suppressedItems.',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
  }),
  async execute(input: { manifestPath?: string }): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPath(input.manifestPath);
      const state = await getPolicyManifestState(resolved);
      const loaded = await loadPolicyManifest(resolved);

      // Expose layer info when available
      const layersSummary = 'layers' in loaded
        ? (loaded as { layers: Array<{ source: string; sourcePath: string; precedence: number; mergeMode: string; hash: string }> }).layers.map((l) => ({
            source: l.source,
            sourcePath: l.sourcePath,
            precedence: l.precedence,
            mergeMode: l.mergeMode,
            hash: l.hash,
          }))
        : [];

      const effectiveSourceObj = 'effectiveSource' in loaded && loaded.effectiveSource instanceof Map
        ? Object.fromEntries((loaded.effectiveSource as Map<string, string>).entries())
        : {};

      const suppressedItems = 'suppressedItems' in loaded && Array.isArray(loaded.suppressedItems)
        ? loaded.suppressedItems
        : [];

      return textResult({
        ok: true,
        ...state,
        layers: layersSummary,
        effectiveSource: effectiveSourceObj,
        suppressedItems,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const listPolicyTemplatesTool = {
  name: 'list_policy_templates',
  description: 'List bundled policy templates and starter rule files shipped with the plugin.',
  inputSchema: z.object({}),
  async execute(_: Record<string, never> = {}): Promise<ToolResult> {
    try {
      const templates = await listPolicyTemplates();
      return textResult({
        ok: true,
        templates,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const proposePolicyRuleTool = {
  name: 'propose_policy_rule',
  description: 'Create a structured proposed rule and hook for policy authoring without writing any files.',
  inputSchema: z.object({
    ruleId: z.string().optional(),
    level: PolicyRuleLevelSchema,
    description: z.string().min(1),
    toolName: z.string().min(1),
    event: PolicyHookEventSchema.optional(),
    mode: PolicyHookModeSchema.optional(),
    decision: PolicyDecisionSchema.optional(),
    commands: z.array(z.string()).optional(),
    paths: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    matcher: z.string().optional(),
    file: z.string().optional(),
    scope: scopeSchema,
  }),
  async execute(input: {
    ruleId?: string;
    level: z.infer<typeof PolicyRuleLevelSchema>;
    description: string;
    toolName: string;
    event?: z.infer<typeof PolicyHookEventSchema>;
    mode?: z.infer<typeof PolicyHookModeSchema>;
    decision?: z.infer<typeof PolicyDecisionSchema>;
    commands?: string[];
    paths?: string[];
    tools?: string[];
    tags?: string[];
    matcher?: string;
    file?: string;
    scope?: 'user' | 'project';
  }): Promise<ToolResult> {
    try {
      const proposal = proposePolicyRule({ ...input, scope: input.scope ?? 'project' });
      return textResult({
        ok: true,
        proposal,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const createRuleFileTool = {
  name: 'create_rule_file',
  description: 'Create a reusable policy rule markdown file relative to policy.yaml.',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
    relativePath: z.string().min(1),
    content: z.string().min(1),
    overwrite: z.boolean().default(false),
    scope: scopeSchema,
  }),
  async execute(input: {
    manifestPath?: string;
    relativePath: string;
    content: string;
    overwrite: boolean;
    scope?: 'user' | 'project';
  }): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPathForScope(input.scope ?? 'project', input.manifestPath);
      const result = await createRuleFile({ ...input, manifestPath: resolved, scope: input.scope ?? 'project' });
      return textResult({
        ok: true,
        ...result,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const applyPolicyChangeTool = {
  name: 'apply_policy_change',
  description: 'Write policy.yaml and optional rule files after schema validation and approval-gate checks.',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
    manifest: EngineManifestSchema,
    ruleFiles: z.array(z.object({
      path: z.string().min(1),
      content: z.string(),
    })).default([]),
    approvalConfirmed: z.boolean().default(false),
    scope: scopeSchema,
  }),
  async execute(input: {
    manifestPath?: string;
    manifest: z.infer<typeof EngineManifestSchema>;
    ruleFiles: Array<{ path: string; content: string }>;
    approvalConfirmed: boolean;
    scope?: 'user' | 'project';
  }): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPathForScope(input.scope ?? 'project', input.manifestPath);
      const result = await writePolicyFiles({ ...input, manifestPath: resolved });
      return textResult({
        ok: true,
        ...result,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export const formatPolicyYamlTool = {
  name: 'format_policy_yaml',
  description: 'Parse policy.yaml through the Zod schema and return or write a canonical YAML representation.',
  inputSchema: z.object({
    manifestPath: manifestPathSchema,
    write: z.boolean().default(false),
  }),
  async execute(input: {
    manifestPath?: string;
    write: boolean;
  }): Promise<ToolResult> {
    try {
      const resolved = await resolveManifestPath(input.manifestPath);
      const result = await formatPolicyYamlFile({ ...input, manifestPath: resolved });
      return textResult({
        ok: true,
        ...result,
      });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

// ============================================================
// install_rulepack — stub (pack-loader/pack-installer not ported)
// TODO: adapt for new registry when pack distribution is implemented
// ============================================================

export const installRulepackTool = {
  name: 'install_rulepack',
  inputSchema: z.object({
    packId: z.string().optional().describe('Pack ID to install. Omit to list available packs.'),
    manifestPath: manifestPathSchema,
    scope: z.enum(['user', 'project']).default('project'),
  }),
  async execute(_input: {
    packId?: string;
    manifestPath?: string;
    scope?: 'user' | 'project';
  }): Promise<ToolResult> {
    return textResult({
      ok: false,
      error: 'install_rulepack: pack distribution not yet implemented in this build. TODO: adapt for new registry.',
    });
  },
};

// ============================================================
// install_rulepack — MCP elicitation wrapper (stubbed)
// TODO: adapt for new registry when pack distribution is implemented
// ============================================================

const installRulepackElicitInputSchema = z.object({
  packId: z.string().optional().describe('Pack ID to install. Elicited as a select list if omitted.'),
  manifestPath: manifestPathSchema,
  scope: z.enum(['user', 'project']).default('project'),
  confirm: z.boolean().optional().describe('Set true to skip confirmation. Elicited if omitted.'),
});

interface InstallRulepackArgs {
  packId?: string;
  manifestPath?: string;
  scope?: 'user' | 'project';
  confirm?: boolean;
}

export function installRulepackToolRegistration(_server: Server): {
  name: string;
  config: {
    description: string;
    inputSchema: typeof installRulepackElicitInputSchema;
  };
  handler: (args: InstallRulepackArgs) => Promise<CallToolResult>;
} {
  return {
    name: 'install_rulepack',
    config: {
      description: 'Install a bundled rulepack into the current project. Presents available packs for selection if no packId given.',
      inputSchema: installRulepackElicitInputSchema,
    },
    async handler(_args: InstallRulepackArgs): Promise<CallToolResult> {
      // TODO: adapt for new registry when pack distribution is implemented
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: false,
            error: 'install_rulepack: pack distribution not yet implemented in this build. TODO: adapt for new registry.',
          }),
        }],
      };
    },
  };
}

// ============================================================
// create_policy_rule — native MCP elicitation
// ============================================================

interface CreatePolicyRuleArgs {
  manifestPath?: string;
  scope?: 'user' | 'project';
  ruleId?: string;
  description?: string;
  level?: 'advisory' | 'guardrail' | 'enforcement';
  event?: string;
  toolMatcher?: string;
  pathPatterns?: string;
  commandPatterns?: string;
  hookMode?: 'inject' | 'decide' | 'audit';
  decision?: 'allow' | 'deny' | 'ask';
  ruleContent?: string;
  confirm?: boolean;
}

const createPolicyRuleInputSchema = z.object({
  manifestPath: manifestPathSchema,
  scope: z.enum(['user', 'project']).optional().describe('Config scope. Elicited if omitted.'),
  ruleId: z.string().optional().describe('Rule ID (e.g., no-force-push). Elicited if omitted.'),
  description: z.string().optional().describe('One sentence describing what this rule governs. Elicited if omitted.'),
  level: z.enum(['advisory', 'guardrail', 'enforcement']).optional().describe('Enforcement level. Elicited if omitted.'),
  event: z.string().optional().describe('Hook event (e.g., PreToolUse). Elicited if omitted.'),
  toolMatcher: z.string().optional().describe('Tool name pattern (e.g., Bash, Write|Edit, *). Elicited if omitted.'),
  pathPatterns: z.string().optional().describe('Comma-separated path globs (e.g., src/**,.env*). Elicited if omitted.'),
  commandPatterns: z.string().optional().describe('Comma-separated command globs (e.g., git push*,rm*). Elicited if omitted.'),
  hookMode: z.enum(['inject', 'decide', 'audit']).optional().describe('Hook mode. Elicited if omitted.'),
  decision: z.enum(['allow', 'deny', 'ask']).optional().describe('Decision for decide mode. Elicited if omitted.'),
  ruleContent: z.string().optional().describe('Rule file markdown content. Auto-generated if omitted.'),
  confirm: z.boolean().optional().describe('Set true to skip confirmation. Elicited if omitted.'),
});

export function createPolicyRuleToolRegistration(server: Server): {
  name: string;
  config: {
    description: string;
    inputSchema: typeof createPolicyRuleInputSchema;
  };
  handler: (args: CreatePolicyRuleArgs) => Promise<CallToolResult>;
} {
  return {
    name: 'create_policy_rule',
    config: {
      description: 'Create a new policy rule. All fields are optional — provided values are used directly, missing values are asked via interactive forms. An LLM can fill all fields to skip elicitation entirely.',
      inputSchema: createPolicyRuleInputSchema,
    },
    async handler(args: CreatePolicyRuleArgs): Promise<CallToolResult> {
      // Step 1: Scope — use arg or elicit
      let scope = args.scope;
      if (scope === undefined) {
        const scopeResult = await server.elicitInput({
          mode: 'form',
          message: 'Where should this rule apply?',
          requestedSchema: {
            type: 'object',
            properties: {
              scope: {
                type: 'string',
                title: 'Scope',
                description: 'User scope applies to all your projects. Project scope applies to this repo only.',
                oneOf: [
                  { const: 'user', title: 'User — all projects (~/.claude/policy.yaml)' },
                  { const: 'project', title: 'Project — this repo (.claude/policy.yaml)' },
                ],
                default: 'project',
              },
            },
            required: ['scope'],
          },
        });
        if (scopeResult.action !== 'accept') {
          return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true, stage: 'scope' }) }] };
        }
        scope = (scopeResult.content?.['scope'] as 'user' | 'project' | undefined) ?? 'project';
      }

      // Step 2: Identity — use args or elicit missing fields
      let ruleId = args.ruleId;
      let description = args.description;
      let level = args.level;
      if (ruleId === undefined || description === undefined || level === undefined) {
        const identityResult = await server.elicitInput({
          mode: 'form',
          message: 'Define the rule identity.',
          requestedSchema: {
            type: 'object',
            properties: {
              ruleId: {
                type: 'string',
                title: 'Rule ID',
                description: 'Short lowercase hyphenated identifier (e.g., no-force-push)',
                ...(ruleId !== undefined ? { default: ruleId } : {}),
              },
              description: {
                type: 'string',
                title: 'Description',
                description: 'One sentence describing what this rule governs',
                ...(description !== undefined ? { default: description } : {}),
              },
              level: {
                type: 'string',
                title: 'Enforcement Level',
                oneOf: [
                  { const: 'advisory', title: 'Advisory — informational only' },
                  { const: 'guardrail', title: 'Guardrail — asks for confirmation' },
                  { const: 'enforcement', title: 'Enforcement — blocks or denies' },
                ],
                default: level ?? 'guardrail',
              },
            },
            required: ['ruleId', 'description', 'level'],
          },
        });
        if (identityResult.action !== 'accept') {
          return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true, stage: 'identity' }) }] };
        }
        ruleId = (identityResult.content?.['ruleId'] as string | undefined) ?? ruleId ?? 'unnamed-rule';
        description = (identityResult.content?.['description'] as string | undefined) ?? description ?? 'Unnamed rule';
        level = (identityResult.content?.['level'] as typeof level | undefined) ?? level ?? 'guardrail';
      }

      // Step 3: Trigger — use args or elicit missing fields
      let event = args.event;
      let toolMatcher = args.toolMatcher;
      let pathPatternsRaw = args.pathPatterns;
      let commandPatternsRaw = args.commandPatterns;
      if (event === undefined || toolMatcher === undefined) {
        const triggerResult = await server.elicitInput({
          mode: 'form',
          message: 'Define when this rule triggers.',
          requestedSchema: {
            type: 'object',
            properties: {
              event: {
                type: 'string',
                title: 'Hook Event',
                oneOf: [
                  { const: 'PreToolUse', title: 'PreToolUse — before a tool runs' },
                  { const: 'PostToolUse', title: 'PostToolUse — after a tool runs' },
                  { const: 'Stop', title: 'Stop — before agent stops' },
                  { const: 'UserPromptSubmit', title: 'UserPromptSubmit — when user sends a message' },
                ],
                default: event ?? 'PreToolUse',
              },
              toolMatcher: {
                type: 'string',
                title: 'Tool Matcher',
                description: 'Tool name pattern (e.g., Bash, Write, Edit, * for all)',
                default: toolMatcher ?? '*',
              },
              pathPatterns: {
                type: 'string',
                title: 'Path Patterns (optional)',
                description: 'Comma-separated glob patterns for file paths. Leave empty for all.',
                default: pathPatternsRaw ?? '',
              },
              commandPatterns: {
                type: 'string',
                title: 'Command Patterns (optional)',
                description: 'Comma-separated glob patterns for commands. Leave empty for all.',
                default: commandPatternsRaw ?? '',
              },
            },
            required: ['event', 'toolMatcher'],
          },
        });
        if (triggerResult.action !== 'accept') {
          return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true, stage: 'trigger' }) }] };
        }
        event = (triggerResult.content?.['event'] as string | undefined) ?? event ?? 'PreToolUse';
        toolMatcher = (triggerResult.content?.['toolMatcher'] as string | undefined) ?? toolMatcher ?? '*';
        pathPatternsRaw = (triggerResult.content?.['pathPatterns'] as string | undefined) ?? pathPatternsRaw;
        commandPatternsRaw = (triggerResult.content?.['commandPatterns'] as string | undefined) ?? commandPatternsRaw;
      }

      // Step 4: Action — use args or elicit missing fields
      let hookMode = args.hookMode;
      let decision = args.decision;
      if (hookMode === undefined) {
        const modeDefault = level === 'advisory' ? 'inject' : 'decide';
        const actionResult = await server.elicitInput({
          mode: 'form',
          message: 'Define how this rule acts.',
          requestedSchema: {
            type: 'object',
            properties: {
              hookMode: {
                type: 'string',
                title: 'Mode',
                oneOf: [
                  { const: 'inject', title: 'Inject — adds advisory context' },
                  { const: 'decide', title: 'Decide — makes allow/deny/ask decision' },
                  { const: 'audit', title: 'Audit — logs without affecting behavior' },
                ],
                default: modeDefault,
              },
              decision: {
                type: 'string',
                title: 'Decision (only for decide mode)',
                oneOf: [
                  { const: 'ask', title: 'Ask — prompt for confirmation' },
                  { const: 'deny', title: 'Deny — block hard' },
                  { const: 'allow', title: 'Allow — permit explicitly' },
                ],
                default: decision ?? 'ask',
              },
            },
            required: ['hookMode'],
          },
        });
        if (actionResult.action !== 'accept') {
          return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true, stage: 'action' }) }] };
        }
        hookMode = (actionResult.content?.['hookMode'] as typeof hookMode | undefined) ?? modeDefault;
        decision = (actionResult.content?.['decision'] as typeof decision | undefined) ?? decision;
      }

      // Build rule content and manifest shape
      const ruleFilePath = `./rules/${ruleId}.md`;
      const ruleContentFinal = args.ruleContent ?? `# ${description}\n\n[Describe the constraint and rationale here.]\n`;

      const paths = pathPatternsRaw ? pathPatternsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const commands = commandPatternsRaw ? commandPatternsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

      const hookWhen: PolicyHook['when'] = {};
      if (paths.length > 0) hookWhen.paths = paths;
      if (commands.length > 0) hookWhen.commands = commands;
      if (Object.keys(hookWhen).length === 0) hookWhen.tools = [toolMatcher];

      const validEvent = event as PolicyHook['event'];
      const validMode = hookMode as PolicyHook['mode'];
      const validDecision = (hookMode === 'decide' && decision !== undefined)
        ? decision as PolicyHook['decision']
        : undefined;

      const hookEntry: PolicyHook = {
        id: `pretool-${ruleId}`,
        event: validEvent,
        matcher: toolMatcher,
        mode: validMode,
        decision: validDecision,
        use: [ruleId],
        when: hookWhen,
        enabled: true,
      };

      const manifestPath = await resolveManifestPathForScope(scope, args.manifestPath);

      // Load existing manifest to merge into, preserving all existing rules and hooks
      let existingManifest: EngineManifest;
      try {
        const loaded = await loadPolicyManifest(manifestPath);
        existingManifest = loaded.manifest;
      } catch {
        // No existing manifest — start with defaults
        existingManifest = {
          version: 1,
          governance: {
            allow_llm_updates: ['advisory'],
            require_approval_for: ['guardrail', 'enforcement'],
            approval_ttl_minutes: 30,
          },
          rulepacks: [] as EngineRulepack[],
          rules: [] as EngineRule[],
          hooks: [],
        };
      }

      const manifest: EngineManifest = {
        ...existingManifest,
        rules: [
          ...existingManifest.rules.filter((r) => r.id !== ruleId),
          {
            id: ruleId,
            level,
            file: ruleFilePath,
            tags: [],
            enabled: true,
          } satisfies EngineRule,
        ],
        hooks: [
          ...existingManifest.hooks.filter((h) => h.id !== hookEntry.id),
          hookEntry,
        ],
      };

      const applyArgs = {
        manifestPath,
        scope,
        manifest,
        ruleFiles: [{ path: ruleFilePath, content: ruleContentFinal }],
        approvalConfirmed: false,
      };

      // Step 5: Confirm — use arg or elicit
      if (args.confirm !== true) {
        const confirmResult = await server.elicitInput({
          mode: 'form',
          message: [
            `Preview — Rule: ${ruleId} (${level}, ${hookMode}${hookMode === 'decide' ? '/' + (decision ?? 'ask') : ''})`,
            `Scope: ${scope}`,
            `Trigger: ${event} on ${toolMatcher}`,
            '',
            'Confirm to create this rule?',
          ].join('\n'),
          requestedSchema: {
            type: 'object',
            properties: {
              confirm: {
                type: 'boolean',
                title: 'Create this rule?',
                default: true,
              },
            },
            required: ['confirm'],
          },
        });

        if (confirmResult.action !== 'accept' || confirmResult.content?.['confirm'] !== true) {
          return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true, stage: 'confirm', applyArgs }) }] };
        }
      }

      // Apply
      const writeResult = await applyPolicyChangeTool.execute({
        ...applyArgs,
        scope,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            ruleId,
            scope,
            level,
            event,
            toolMatcher,
            hookMode,
            decision: hookMode === 'decide' ? decision : undefined,
            manifestPath,
            ruleFilePath,
            writeResult: JSON.parse(writeResult.content[0]?.text ?? '{}') as unknown,
          }),
        }],
      };
    },
  };
}

// ============================================================
// update_rulepacks — stub (pack-loader/pack-installer not ported)
// TODO: adapt for new registry when pack distribution is implemented
// ============================================================

export const updateRulepacksTool = {
  name: 'update_rulepacks',
  description: 'Check for and apply updates to installed rulepacks. Compares installed versions against bundled versions and re-installs stale packs.',
  inputSchema: z.object({
    scope: z.enum(['user', 'project']).default('project').describe(
      'Scope to check: "user" (~/.claude/policy.yaml) or "project" (.claude/policy.yaml)',
    ),
    dryRun: z.boolean().default(false).describe('If true, only report stale packs without updating'),
  }),
  async execute(_input: { scope?: 'user' | 'project'; dryRun?: boolean }): Promise<ToolResult> {
    // TODO: adapt for new registry when pack distribution is implemented
    return textResult({
      ok: false,
      error: 'update_rulepacks: pack distribution not yet implemented in this build. TODO: adapt for new registry.',
    });
  },
};
