import { z } from 'zod';
import { ClaudeHookEventSchema } from './claude-hooks.js';

export const POLICY_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreCompact',
  'Notification',
] as const;

export const PolicyHookEventSchema = ClaudeHookEventSchema.refine(
  (event) => (POLICY_HOOK_EVENTS as readonly string[]).includes(event),
  { message: `Policy supports only documented Claude Code hook events: ${POLICY_HOOK_EVENTS.join(', ')}` },
);

export const POLICY_RULE_LEVELS = [
  'advisory',
  'guardrail',
  'enforcement',
] as const;

export const PolicyRuleLevelSchema = z.enum(POLICY_RULE_LEVELS);

export const POLICY_HOOK_MODES = [
  'inject',
  'decide',
  'audit',
] as const;

export const PolicyHookModeSchema = z.enum(POLICY_HOOK_MODES);

export const POLICY_DECISIONS = [
  'allow',
  'deny',
  'ask',
  'approve',
  'block',
] as const;

export const PolicyDecisionSchema = z.enum(POLICY_DECISIONS);

const NonEmptyStringSchema = z.string().trim().min(1);
const StringArraySchema = z.array(NonEmptyStringSchema).default([]);

export const PolicyGovernanceSchema = z.object({
  allow_llm_updates: z.array(PolicyRuleLevelSchema).default(['advisory']),
  require_approval_for: z.array(PolicyRuleLevelSchema).default(['guardrail', 'enforcement']),
  approval_ttl_minutes: z.number().int().nonnegative().default(30),
});

export const PolicyRulepackSchema = z.object({
  id: NonEmptyStringSchema,
  files: z.array(NonEmptyStringSchema).min(1),
  tags: StringArraySchema,
  version: z.string().optional(),
});

export const EngineRuleSchema = z.object({
  id: NonEmptyStringSchema,
  level: PolicyRuleLevelSchema,
  file: NonEmptyStringSchema,
  tags: StringArraySchema,
  priority: z.number().int().optional(),
  enabled: z.boolean().default(true),
});

export const PolicyHookWhenSchema = z.object({
  commands: StringArraySchema.optional(),
  paths: StringArraySchema.optional(),
  tools: StringArraySchema.optional(),
});

export const PolicyHookRetrieveSchema = z.object({
  enabled: z.boolean().default(false),
  strategy: z.enum(['fts']).default('fts'),
  top_k: z.number().int().positive().max(10).default(3),
});

export const PolicyHookSchema = z.object({
  id: NonEmptyStringSchema,
  event: PolicyHookEventSchema,
  matcher: NonEmptyStringSchema,
  mode: PolicyHookModeSchema,
  decision: PolicyDecisionSchema.optional(),
  use: z.array(NonEmptyStringSchema).min(1),
  when: PolicyHookWhenSchema,
  retrieve: PolicyHookRetrieveSchema.optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().optional(),
}).superRefine((value, ctx) => {
  const hasWhenConditions = (value.when.commands?.length ?? 0) > 0
    || (value.when.paths?.length ?? 0) > 0
    || (value.when.tools?.length ?? 0) > 0;
  const requiresWhenConditions = value.event === 'PreToolUse' || value.event === 'PostToolUse';

  if (requiresWhenConditions && !hasWhenConditions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['when'],
      message: 'At least one of when.commands, when.paths, or when.tools must be provided for tool hooks',
    });
  }

  if (value.mode === 'decide' && value.decision === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['decision'],
      message: 'decision is required when mode is decide',
    });
  }

  if (value.mode !== 'decide' && value.decision !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['decision'],
      message: 'decision is only valid when mode is decide',
    });
  }

  if (value.mode === 'decide' && value.event === 'PreToolUse' && value.decision !== undefined) {
    if (!['allow', 'deny', 'ask'].includes(value.decision)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decision'],
        message: 'PreToolUse decisions must be allow, deny, or ask',
      });
    }
  }

  if (value.mode === 'decide' && (value.event === 'Stop' || value.event === 'SubagentStop') && value.decision !== undefined) {
    if (!['approve', 'block'].includes(value.decision)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decision'],
        message: 'Stop and SubagentStop decisions must be approve or block',
      });
    }
  }

  if (value.mode === 'decide' && !['PreToolUse', 'Stop', 'SubagentStop'].includes(value.event)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mode'],
      message: 'Only PreToolUse, Stop, and SubagentStop support mode=decide in policy v1',
    });
  }
});

export const EngineManifestSchema = z.object({
  version: z.literal(1),
  governance: PolicyGovernanceSchema.default({}),
  rulepacks: z.array(PolicyRulepackSchema).default([]),
  rules: z.array(EngineRuleSchema).default([]),
  hooks: z.array(PolicyHookSchema).default([]),
});

export const PartialEngineManifestSchema = z.object({
  version: z.literal(1).optional(),
  governance: PolicyGovernanceSchema.partial().optional(),
  rulepacks: z.array(PolicyRulepackSchema).optional(),
  rules: z.array(EngineRuleSchema).optional(),
  hooks: z.array(PolicyHookSchema).optional(),
});

export type PartialEngineManifest = z.infer<typeof PartialEngineManifestSchema>;

// === Layered Config Types ===

export type LayerSource = 'user' | 'project';

export const LAYER_PRECEDENCE: Record<LayerSource, number> = {
  user: 0,
  project: 1,
};

export type MergeMode = 'defaults' | 'enforced';

export interface ConfigLayer {
  source: LayerSource;
  sourcePath: string;
  precedence: number;
  mergeMode: MergeMode;
  manifest: Partial<EngineManifest>;
  hash: string;
}

export interface ConfigLayerPath {
  source: LayerSource;
  path: string;
  precedence: number;
  mergeMode: MergeMode;
}

export interface SuppressedItem {
  id: string;
  source: LayerSource;
  type: 'rule' | 'hook' | 'rulepack';
}

export type PolicyHookEvent = z.infer<typeof PolicyHookEventSchema>;
export type PolicyRuleLevel = z.infer<typeof PolicyRuleLevelSchema>;
export type PolicyHookMode = z.infer<typeof PolicyHookModeSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type PolicyGovernance = z.infer<typeof PolicyGovernanceSchema>;
export type EngineRulepack = z.infer<typeof PolicyRulepackSchema>;
export type EngineRule = z.infer<typeof EngineRuleSchema>;
export type PolicyHook = z.infer<typeof PolicyHookSchema>;
export type EngineManifest = z.infer<typeof EngineManifestSchema>;
export type PolicyHookWhen = z.infer<typeof PolicyHookWhenSchema>;
