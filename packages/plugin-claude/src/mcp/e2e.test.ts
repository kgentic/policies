import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const tempDirs: string[] = [];

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-mcp-e2e-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  }

  return dir;
}

function parseTextContent(result: unknown): unknown {
  const parsed = result as { content?: Array<{ type: string; text?: string }> };
  const item = parsed.content?.find((entry) => entry.type === 'text');
  if (item?.text === undefined) {
    throw new Error('Missing text content in MCP tool result');
  }
  return JSON.parse(item.text) as unknown;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe.skipIf(!!process.env['CI'])('policy MCP server e2e', () => {
  it('exercises core tools over stdio transport', async () => {
    const workspace = await makeWorkspace({
      '.claude/policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ../rules/protect-main.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [protect-main]
    when:
      commands: ["git push *"]
`,
      'rules/protect-main.md': 'Do not push directly to main.\n',
    });

    const client = new Client({
      name: 'policy-e2e-test',
      version: '0.1.0',
    });

    const transport = new StdioClientTransport({
      command: 'node',
      args: [path.join(process.cwd(), 'dist/mcp/server.js')],
      cwd: process.cwd(),
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);

      // Verify only core tools are registered
      const listToolsResult = await client.listTools();
      const toolNames = listToolsResult.tools.map((tool) => tool.name).sort();
      expect(toolNames).toEqual([
        'apply_policy_change',
        'create_policy_rule',
        'evaluate_policy',
        'get_policy_manifest',
        'install_rulepack',
        'update_rulepacks',
      ]);

      // get_policy_manifest — read the full state
      const manifestResult = await client.callTool({
        name: 'get_policy_manifest',
        arguments: {
          manifestPath: path.join(workspace, '.claude/policy.yaml'),
        },
      });
      const parsedManifest = parseTextContent(manifestResult) as {
        ok: boolean;
        manifest: { version: number; hooks: Array<{ id: string }> };
      };
      expect(parsedManifest.ok).toBe(true);
      expect(parsedManifest.manifest.version).toBe(1);
      expect(parsedManifest.manifest.hooks[0]?.id).toBe('pretool-git');

      // evaluate_policy — check if a hook would fire
      const evaluateResult = await client.callTool({
        name: 'evaluate_policy',
        arguments: {
          manifestPath: path.join(workspace, '.claude/policy.yaml'),
          event: 'PreToolUse',
          toolName: 'Bash',
          command: 'git push origin main',
        },
      });
      const parsedEvaluate = parseTextContent(evaluateResult) as {
        ok: boolean;
        result: { decision: string; hookId: string };
      };
      expect(parsedEvaluate.ok).toBe(true);
      expect(parsedEvaluate.result.decision).toBe('ask');
      expect(parsedEvaluate.result.hookId).toBe('pretool-git');

      // evaluate_policy with verbose=true — full explanation
      const verboseResult = await client.callTool({
        name: 'evaluate_policy',
        arguments: {
          manifestPath: path.join(workspace, '.claude/policy.yaml'),
          event: 'PreToolUse',
          toolName: 'Bash',
          command: 'git push origin main',
          verbose: true,
        },
      });
      const parsedVerbose = parseTextContent(verboseResult) as {
        ok: boolean;
        decision: string;
        hookId: string;
        explanation: string;
      };
      expect(parsedVerbose.ok).toBe(true);
      expect(parsedVerbose.decision).toBe('ask');
      expect(parsedVerbose.hookId).toBe('pretool-git');

      // apply_policy_change — write changes atomically
      const applyResult = await client.callTool({
        name: 'apply_policy_change',
        arguments: {
          manifestPath: path.join(workspace, '.claude/policy.yaml'),
          manifest: {
            ...parsedManifest.manifest,
            governance: {
              allow_llm_updates: ['advisory'],
              require_approval_for: ['guardrail', 'enforcement'],
              approval_ttl_minutes: 30,
            },
            rules: [
              {
                id: 'protect-main',
                level: 'enforcement',
                file: '../rules/protect-main.md',
                tags: [],
              },
              {
                id: 'no-env-write',
                level: 'guardrail',
                file: './rules/no-env-write.md',
                tags: [],
              },
            ],
            rulepacks: [],
            hooks: [
              ...parsedManifest.manifest.hooks,
              {
                id: 'pretool-env',
                event: 'PreToolUse',
                matcher: 'Write|Edit',
                mode: 'decide',
                decision: 'ask',
                use: ['no-env-write'],
                when: {
                  paths: ['.env*'],
                },
              },
            ],
          },
          ruleFiles: [
            {
              path: './rules/no-env-write.md',
              content: '# No .env writes\n\nDo not write to .env files without approval.\n',
            },
          ],
          approvalConfirmed: true,
        },
      });
      const parsedApply = parseTextContent(applyResult) as {
        ok: boolean;
        validation: { ok: boolean };
      };
      expect(parsedApply.ok).toBe(true);
      expect(parsedApply.validation.ok).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('create_policy_rule completes full elicitation flow', { timeout: 15000 }, async () => {
    const workspace = await makeWorkspace({
      '.claude/policy.yaml': `version: 1\nrules: []\nhooks: []\n`,
    });

    const elicitationCalls: Array<{ message: string; schema: unknown }> = [];

    const client = new Client(
      { name: 'elicitation-e2e-test', version: '0.1.0' },
      { capabilities: { elicitation: { form: {} } } },
    );

    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      // Narrow from the form|url union — all server calls in this flow use form mode
      const params = request.params;
      const schema = params.mode !== 'url' ? params.requestedSchema : undefined;
      elicitationCalls.push({ message: params.message, schema });

      const step = elicitationCalls.length;
      switch (step) {
        case 1: // Scope
          return { action: 'accept', content: { scope: 'project' } };
        case 2: // Identity — advisory so no approval gate fires
          return { action: 'accept', content: { ruleId: 'test-rule', description: 'Test rule for e2e', level: 'advisory' } };
        case 3: // Trigger
          return { action: 'accept', content: { event: 'PreToolUse', toolMatcher: 'Bash', pathPatterns: '', commandPatterns: 'npm publish*' } };
        case 4: // Action — inject mode so no approval gate fires
          return { action: 'accept', content: { hookMode: 'inject', decision: 'ask' } };
        case 5: // Confirm
          return { action: 'accept', content: { confirm: true } };
        default:
          return { action: 'cancel' };
      }
    });

    const transport = new StdioClientTransport({
      command: 'node',
      args: [path.join(process.cwd(), 'dist/mcp/server.js')],
      cwd: process.cwd(),
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);

      const result = await client.callTool({
        name: 'create_policy_rule',
        arguments: {
          manifestPath: path.join(workspace, '.claude/policy.yaml'),
        },
      });

      const parsed = parseTextContent(result) as {
        ok?: boolean;
        ruleId?: string;
        scope?: string;
        cancelled?: boolean;
      };

      expect(parsed.ok).toBe(true);
      expect(parsed.ruleId).toBe('test-rule');
      expect(parsed.scope).toBe('project');

      expect(elicitationCalls).toHaveLength(5);

      const manifestContent = await fs.readFile(path.join(workspace, '.claude/policy.yaml'), 'utf8');
      expect(manifestContent).toContain('test-rule');

      // Rule file is written relative to manifest dir: .claude/rules/test-rule.md
      const ruleContent = await fs.readFile(path.join(workspace, '.claude/rules/test-rule.md'), 'utf8');
      expect(ruleContent).toContain('Test rule for e2e');
    } finally {
      await client.close();
    }
  });

  it('create_policy_rule preserves existing rules in manifest', { timeout: 15000 }, async () => {
    // Workspace has a pre-existing shell-safety rule at enforcement level.
    // After adding a second rule via create_policy_rule the existing rule must
    // still be present in the written manifest.
    const workspace = await makeWorkspace({
      '.claude/policy.yaml': `version: 1
governance:
  allow_llm_updates: [advisory]
  require_approval_for: [guardrail, enforcement]
  approval_ttl_minutes: 30
rules:
  - id: shell-safety
    level: enforcement
    file: ../rules/shell-safety.md
    tags: []
    enabled: true
hooks:
  - id: pretool-shell-safety
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [shell-safety]
    when:
      tools: [Bash]
    enabled: true
`,
      'rules/shell-safety.md': '# Shell Safety\n\nApprove dangerous shell commands.\n',
    });

    const client = new Client(
      { name: 'preserve-rules-e2e-test', version: '0.1.0' },
      { capabilities: { elicitation: { form: {} } } },
    );

    // No elicitation expected — all fields are provided as args
    client.setRequestHandler(ElicitRequestSchema, async () => {
      throw new Error('Unexpected elicitation call — all args should have been provided');
    });

    const transport = new StdioClientTransport({
      command: 'node',
      args: [path.join(process.cwd(), 'dist/mcp/server.js')],
      cwd: process.cwd(),
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);

      const result = await client.callTool({
        name: 'create_policy_rule',
        arguments: {
          manifestPath: path.join(workspace, '.claude/policy.yaml'),
          scope: 'project',
          ruleId: 'no-force-push',
          description: 'Prevent force pushes to remote branches',
          level: 'advisory',
          event: 'PreToolUse',
          toolMatcher: 'Bash',
          hookMode: 'inject',
          confirm: true,
        },
      });

      const parsed = parseTextContent(result) as {
        ok?: boolean;
        ruleId?: string;
        cancelled?: boolean;
      };

      expect(parsed.ok).toBe(true);
      expect(parsed.ruleId).toBe('no-force-push');

      // Read the written manifest and verify BOTH rules are present
      const manifestContent = await fs.readFile(path.join(workspace, '.claude/policy.yaml'), 'utf8');

      // The new rule must be present
      expect(manifestContent).toContain('no-force-push');

      // The pre-existing rule must be PRESERVED
      expect(manifestContent).toContain('shell-safety');
    } finally {
      await client.close();
    }
  });

  it('create_policy_rule returns cancelled when user declines at scope step', { timeout: 15000 }, async () => {
    const workspace = await makeWorkspace({
      '.claude/policy.yaml': `version: 1\nrules: []\nhooks: []\n`,
    });

    const elicitationCalls: Array<{ message: string }> = [];

    const client = new Client(
      { name: 'elicitation-cancel-test', version: '0.1.0' },
      { capabilities: { elicitation: { form: {} } } },
    );

    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      elicitationCalls.push({ message: request.params.message });
      // Decline immediately at step 1 (scope)
      return { action: 'decline' };
    });

    const transport = new StdioClientTransport({
      command: 'node',
      args: [path.join(process.cwd(), 'dist/mcp/server.js')],
      cwd: process.cwd(),
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);

      const result = await client.callTool({
        name: 'create_policy_rule',
        arguments: {
          manifestPath: path.join(workspace, '.claude/policy.yaml'),
        },
      });

      const parsed = parseTextContent(result) as {
        cancelled?: boolean;
        stage?: string;
      };

      expect(parsed.cancelled).toBe(true);
      expect(parsed.stage).toBe('scope');

      // Only one elicitation call was made (scope step)
      expect(elicitationCalls).toHaveLength(1);

      // Manifest is unchanged — no rules written
      const manifestContent = await fs.readFile(path.join(workspace, '.claude/policy.yaml'), 'utf8');
      expect(manifestContent).toBe('version: 1\nrules: []\nhooks: []\n');
    } finally {
      await client.close();
    }
  });
});
