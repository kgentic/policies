import { z } from 'zod';

export const CLAUDE_HOOK_EVENTS = [
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

export const ClaudeHookEventSchema = z.enum(CLAUDE_HOOK_EVENTS);

const NonEmptyStringSchema = z.string().min(1);

export const ClaudeHookBasePayloadSchema = z.object({
  session_id: z.string().optional(),
  transcript_path: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  hook_event_name: ClaudeHookEventSchema,
}).passthrough();

export const ClaudePreToolUsePayloadSchema = ClaudeHookBasePayloadSchema.extend({
  hook_event_name: z.literal('PreToolUse'),
  tool_name: NonEmptyStringSchema,
  tool_input: z.record(z.unknown()).default({}),
});

export const ClaudePostToolUsePayloadSchema = ClaudeHookBasePayloadSchema.extend({
  hook_event_name: z.literal('PostToolUse'),
  tool_name: NonEmptyStringSchema,
  tool_input: z.record(z.unknown()).default({}),
}).passthrough();

export const ClaudeSessionStartPayloadSchema = ClaudeHookBasePayloadSchema.extend({
  hook_event_name: z.literal('SessionStart'),
}).passthrough();

export const ClaudeHookPayloadSchema = z.discriminatedUnion('hook_event_name', [
  ClaudePreToolUsePayloadSchema,
  ClaudePostToolUsePayloadSchema,
  ClaudeSessionStartPayloadSchema,
  ClaudeHookBasePayloadSchema.extend({ hook_event_name: z.literal('Stop') }),
  ClaudeHookBasePayloadSchema.extend({ hook_event_name: z.literal('SubagentStop') }),
  ClaudeHookBasePayloadSchema.extend({ hook_event_name: z.literal('SessionEnd') }),
  ClaudeHookBasePayloadSchema.extend({ hook_event_name: z.literal('UserPromptSubmit') }),
  ClaudeHookBasePayloadSchema.extend({ hook_event_name: z.literal('PreCompact') }),
  ClaudeHookBasePayloadSchema.extend({ hook_event_name: z.literal('Notification') }),
]);

export const ClaudePreToolUseResponseSchema = z.object({
  hookSpecificOutput: z.object({
    hookEventName: z.literal('PreToolUse').optional(),
    permissionDecision: z.enum(['allow', 'deny', 'ask']),
    permissionDecisionReason: z.string().optional(),
    updatedInput: z.record(z.unknown()).optional(),
    additionalContext: z.string().optional(),
  }),
});

export const ClaudePostToolUseResponseSchema = z.object({
  decision: z.enum(['block']).optional(),
  reason: z.string().optional(),
  hookSpecificOutput: z.object({
    hookEventName: z.literal('PostToolUse').optional(),
    additionalContext: z.string().optional(),
  }).optional(),
});

export const ClaudeGenericHookResponseSchema = z.object({
  continue: z.boolean().optional(),
  suppressOutput: z.boolean().optional(),
  systemMessage: z.string().optional(),
});

export const ClaudeStopHookResponseSchema = z.object({
  decision: z.enum(['block']).optional(),
  reason: z.string().optional(),
});

export type ClaudeHookEvent = z.infer<typeof ClaudeHookEventSchema>;
export type ClaudeHookPayload = z.infer<typeof ClaudeHookPayloadSchema>;
export type ClaudePreToolUsePayload = z.infer<typeof ClaudePreToolUsePayloadSchema>;
export type ClaudePostToolUsePayload = z.infer<typeof ClaudePostToolUsePayloadSchema>;
export type ClaudeSessionStartPayload = z.infer<typeof ClaudeSessionStartPayloadSchema>;
export type ClaudePreToolUseResponse = z.infer<typeof ClaudePreToolUseResponseSchema>;
export type ClaudePostToolUseResponse = z.infer<typeof ClaudePostToolUseResponseSchema>;
export type ClaudeGenericHookResponse = z.infer<typeof ClaudeGenericHookResponseSchema>;
export type ClaudeStopHookResponse = z.infer<typeof ClaudeStopHookResponseSchema>;
