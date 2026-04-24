import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  appendApprovalRecord,
  appendApprovalRecordForHook,
  findActiveApproval,
  ClaudeGenericHookResponseSchema,
  ClaudeHookPayloadSchema,
  ClaudePostToolUseResponseSchema,
  ClaudePreToolUsePayloadSchema,
  ClaudePreToolUseResponseSchema,
  ClaudeStopHookResponseSchema,
  loadPolicyManifest,
  discoverPolicyManifestPath,
  evaluatePolicy,
  resolveStopDecision,
  type ResolvedManifest,
} from '@kgentic/policies-shared';

function isMissingPolicyFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function extractPath(toolInput: Record<string, unknown> | undefined): string | undefined {
  if (toolInput === undefined) {
    return undefined;
  }

  const candidates = [
    toolInput['file_path'],
    toolInput['path'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function extractCommand(toolInput: Record<string, unknown> | undefined): string | undefined {
  if (toolInput === undefined) {
    return undefined;
  }
  const candidate = toolInput['command'];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

export async function runHook(
  mode: string,
  payloadText: string,
  preloaded?: ResolvedManifest,
): Promise<string> {
  const payload = payloadText.length > 0
    ? ClaudeHookPayloadSchema.parse(JSON.parse(payloadText) as unknown)
    : ClaudeHookPayloadSchema.parse({ hook_event_name: 'SessionStart' });
  const cwd = payload.cwd ?? process.cwd();

  try {
    let loaded: ResolvedManifest;
    let workspaceRoot: string;

    if (preloaded !== undefined) {
      loaded = preloaded;
      workspaceRoot = path.dirname(loaded.manifestPath);
    } else {
      const manifestPath = await discoverPolicyManifestPath(cwd);
      if (manifestPath === undefined) {
        throw Object.assign(new Error('No policy manifest found'), { code: 'ENOENT' });
      }
      workspaceRoot = path.dirname(manifestPath);
      loaded = await loadPolicyManifest(manifestPath);
    }

    if (mode === 'pre-tool') {
      const preToolPayload = ClaudePreToolUsePayloadSchema.parse(payload);
      const evalInput = {
        event: preToolPayload.hook_event_name,
        toolName: preToolPayload.tool_name,
        command: extractCommand(preToolPayload.tool_input),
        path: extractPath(preToolPayload.tool_input),
      };
      const result = evaluatePolicy(loaded, evalInput);

      // Deny hooks always win immediately — no approval possible
      const denyHook = result.matchedDecideHooks.find((h) => h.decision === 'deny');
      if (denyHook !== undefined) {
        const response = ClaudePreToolUseResponseSchema.parse({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'deny',
            permissionDecisionReason: `Policy hook ${denyHook.hookId}: deny`,
            additionalContext: denyHook.systemMessage || result.systemMessage || undefined,
          },
        });
        return JSON.stringify(response);
      }

      // Build inject-only advisory context (always included regardless of ask approval state)
      const injectOnlyContext = result.matched && result.systemMessage.length > 0 && result.matchedDecideHooks.length === 0
        ? result.systemMessage
        : undefined;

      // Per-hook sequential approval: drain ask hooks one at a time
      const askHooks = result.matchedDecideHooks.filter((h) => h.decision === 'ask');
      for (const askHook of askHooks) {
        const approval = await findActiveApproval(workspaceRoot, askHook.actionHash);
        if (!approval.matched) {
          // This hook is not yet approved — ask for it specifically
          const injectMessages = result.matched
            ? result.systemMessage
                .split('\n\n')
                .filter((segment) => !askHook.systemMessage.includes(segment.slice(0, 40)))
                .join('\n\n')
                .trim()
            : '';
          const additionalContext = [askHook.systemMessage, injectMessages]
            .filter((s) => s.length > 0)
            .join('\n\n') || undefined;
          const response = ClaudePreToolUseResponseSchema.parse({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'ask',
              permissionDecisionReason: `Policy hook ${askHook.hookId}: ask`,
              additionalContext,
            },
          });
          return JSON.stringify(response);
        }
      }

      // All ask hooks approved (or no ask hooks) — allow
      if (askHooks.length > 0) {
        const response = ClaudePreToolUseResponseSchema.parse({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'allow',
            additionalContext: 'Policy approval reused from persisted approval memory.',
          },
        });
        return JSON.stringify(response);
      }

      // No decide hooks matched — return based on overall result (allow or inject advisory)
      const response = ClaudePreToolUseResponseSchema.parse({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: result.decision,
          permissionDecisionReason: result.decision !== 'allow'
            ? `Policy hook ${result.hookId ?? 'unknown'}: ${result.decision}`
            : undefined,
          additionalContext: injectOnlyContext ?? (result.systemMessage || undefined),
        },
      });
      return JSON.stringify(response);
    }

    if (payload.hook_event_name === 'PostToolUse') {
      const evalInput = {
        toolName: payload.tool_name,
        command: extractCommand(payload.tool_input),
        path: extractPath(payload.tool_input),
      };

      const preResult = evaluatePolicy(loaded, { event: 'PreToolUse', ...evalInput });
      const preInput = { event: 'PreToolUse', ...evalInput };
      const ttl = loaded.manifest.governance.approval_ttl_minutes;

      // Per-hook sequential drain: record only the first unapproved ask hook, mirroring
      // exactly which hook prompted the ask in the preceding pre-tool call. This advances
      // the approval queue by exactly one hook per tool execution cycle.
      // Fall back to the legacy single-winner path for non-ask or no-decide-hook scenarios.
      const askHooksForPost = preResult.matchedDecideHooks.filter((h) => h.decision === 'ask');
      if (askHooksForPost.length > 0) {
        let recordedOne = false;
        for (const askHook of askHooksForPost) {
          if (recordedOne) {
            break;
          }
          const existing = await findActiveApproval(workspaceRoot, askHook.actionHash);
          if (!existing.matched) {
            await appendApprovalRecordForHook(workspaceRoot, preInput, askHook.hookId, ttl);
            recordedOne = true;
          }
        }
      } else {
        await appendApprovalRecord(workspaceRoot, preInput, preResult, ttl);
      }

      const postResult = evaluatePolicy(loaded, { event: 'PostToolUse', ...evalInput });
      if (postResult.matched) {
        const isBlock = postResult.mode === 'decide'
          && (postResult.decision === 'deny' || postResult.decision === 'block');

        return JSON.stringify(ClaudePostToolUseResponseSchema.parse({
          decision: isBlock ? 'block' : undefined,
          reason: isBlock
            ? (postResult.systemMessage || `Policy ${postResult.hookId ?? 'unknown'}: blocked`)
            : undefined,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse' as const,
            additionalContext: postResult.systemMessage || undefined,
          },
        }));
      }
    }

    if (payload.hook_event_name === 'Stop' || payload.hook_event_name === 'SubagentStop') {
      const result = evaluatePolicy(loaded, {
        event: payload.hook_event_name,
      });
      const decision = resolveStopDecision(result);
      const isBlock = decision === 'block';
      return JSON.stringify(ClaudeStopHookResponseSchema.parse({
        decision: isBlock ? 'block' : undefined,
        reason: isBlock ? (result.systemMessage || 'Policy blocked stop') : undefined,
      }));
    }

    if (payload.hook_event_name === 'SessionStart' || payload.hook_event_name === 'UserPromptSubmit') {
      const evalResult = evaluatePolicy(loaded, { event: payload.hook_event_name });
      const baseMessage = payload.hook_event_name === 'SessionStart'
        ? 'Policy plugin active. Policy rules will be evaluated on matching hook events.'
        : '';
      const systemMessage = evalResult.matched && evalResult.systemMessage.length > 0
        ? (baseMessage.length > 0 ? `${baseMessage}\n\n${evalResult.systemMessage}` : evalResult.systemMessage)
        : baseMessage;

      const response = ClaudeGenericHookResponseSchema.parse({
        continue: true,
        suppressOutput: false,
        systemMessage,
      });
      return JSON.stringify(response);
    }

    const response = ClaudeGenericHookResponseSchema.parse({
      continue: true,
      suppressOutput: false,
      systemMessage: '',
    });
    return JSON.stringify(response);
  } catch (error) {
    if (isMissingPolicyFile(error)) {
      if (mode === 'pre-tool') {
        return JSON.stringify(ClaudePreToolUseResponseSchema.parse({
          hookSpecificOutput: {
            permissionDecision: 'allow',
          },
        }));
      }

      if (payload.hook_event_name === 'PostToolUse') {
        return JSON.stringify(ClaudePostToolUseResponseSchema.parse({}));
      }

      if (payload.hook_event_name === 'Stop' || payload.hook_event_name === 'SubagentStop') {
        return JSON.stringify(ClaudeStopHookResponseSchema.parse({}));
      }

      return JSON.stringify(ClaudeGenericHookResponseSchema.parse({}));
    }

    const message = error instanceof Error ? error.message : String(error);
    if (mode === 'pre-tool') {
      return JSON.stringify(ClaudePreToolUseResponseSchema.parse({
        hookSpecificOutput: {
          permissionDecision: 'allow',
          additionalContext: `Policy warning: ${message}`,
        },
      }));
    }

    if (payload.hook_event_name === 'PostToolUse') {
      return JSON.stringify(ClaudePostToolUseResponseSchema.parse({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse' as const,
          additionalContext: `Policy warning: ${message}`,
        },
      }));
    }

    if (payload.hook_event_name === 'Stop' || payload.hook_event_name === 'SubagentStop') {
      return JSON.stringify(ClaudeStopHookResponseSchema.parse({
        reason: `Policy warning: ${message}`,
      }));
    }

    return JSON.stringify(ClaudeGenericHookResponseSchema.parse({
      systemMessage: `Policy warning: ${message}`,
    }));
  }
}

const POLICY_DEBUG = process.env['POLICY_DEBUG'] === '1';
const POLICY_LOG = process.env['POLICY_LOG_FILE'];

async function debugLog(entry: Record<string, unknown>): Promise<void> {
  if (!POLICY_DEBUG && !POLICY_LOG) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  if (POLICY_LOG) {
    await fs.appendFile(POLICY_LOG, line, 'utf8');
  }
  if (POLICY_DEBUG) {
    process.stderr.write(`[policy] ${line}`);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'unknown';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const payloadText = Buffer.concat(chunks).toString('utf8');

  try {
    await debugLog({ event: 'hook-start', mode, payloadLength: payloadText.length, payload: payloadText.slice(0, 500) });

    const result = await runHook(mode, payloadText);
    process.stdout.write(result);

    const parsed = JSON.parse(result) as {
      decision?: string;
      reason?: string;
      hookSpecificOutput?: { permissionDecision?: string; additionalContext?: string };
      systemMessage?: string;
    };
    await debugLog({
      event: 'hook-result',
      mode,
      decision: parsed.decision ?? parsed.hookSpecificOutput?.permissionDecision,
      additionalContext: parsed.hookSpecificOutput?.additionalContext?.slice(0, 100),
      systemMessage: parsed.systemMessage?.slice(0, 100),
    });

    await debugLog({ event: 'hook-exit', exitCode: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    await debugLog({ event: 'hook-error', mode, error: message, stack });
    process.stderr.write(`[policy] ${mode} hook error: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
