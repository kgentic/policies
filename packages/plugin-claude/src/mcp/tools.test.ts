import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPolicyChangeTool,
  createRuleFileTool,
  evaluatePolicyTool,
  explainPolicyDecisionTool,
  formatPolicyYamlTool,
  getPolicyManifestTool,
  listGovernableToolsTool,
  listPolicyAssetsTool,
  listPolicyTemplatesTool,
  proposePolicyRuleTool,
  searchPoliciesTool,
  setWorkspaceRoot,
  validatePolicyPackTool,
} from './tools.js';

const tempDirs: string[] = [];

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-tools-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  }

  return dir;
}

function parseText(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  const first = result.content[0];
  if (first === undefined) {
    throw new Error('Missing tool output');
  }
  return JSON.parse(first.text) as unknown;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('policy MCP tools', () => {
  it('validate_policy_pack validates a manifest', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/protect-main.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [protect-main]
    when:
      commands: ["git *"]
`,
      'rules/protect-main.md': 'Protect main.\n',
    });

    const result = await validatePolicyPackTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
    });

    const parsed = parseText(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('evaluate_policy returns an evaluated decision', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/protect-main.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-main]
    when:
      commands: ["git push *"]
`,
      'rules/protect-main.md': 'Protect main.\n',
    });

    const result = await evaluatePolicyTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git push origin main',
    });

    const parsed = parseText(result) as { ok: boolean; result: { decision: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.result.decision).toBe('deny');
  });

  it('search_policies returns ranked policy snippets', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/protect-main.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-main]
    when:
      commands: ["git push *"]
`,
      'rules/protect-main.md': 'Do not push directly to main.\n',
    });

    const result = await searchPoliciesTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
      query: 'main push',
      topK: 3,
    });

    const parsed = parseText(result) as { ok: boolean; results: Array<{ assetId: string }> };
    expect(parsed.ok).toBe(true);
    expect(parsed.results[0]?.assetId).toBe('protect-main');
  });

  it('list_policy_assets returns policy assets', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/protect-main.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-main]
    when:
      commands: ["git push *"]
`,
      'rules/protect-main.md': 'Protect main.\n',
    });

    const result = await listPolicyAssetsTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
    });

    const parsed = parseText(result) as { ok: boolean; assets: Array<{ id: string }> };
    expect(parsed.ok).toBe(true);
    expect(parsed.assets[0]?.id).toBe('protect-main');
  });

  it('list_governable_tools returns native and policy MCP tools', async () => {
    const workspace = await makeWorkspace({
      '.mcp.json': JSON.stringify({
        mcpServers: {
          linear: {
            command: 'npx',
            args: ['-y', '@some/linear-server'],
          },
        },
      }),
    });

    const result = await listGovernableToolsTool.execute({ workspaceRoot: workspace });
    const parsed = parseText(result) as {
      ok: boolean;
      tools: Array<{ name: string; source: string; pattern: boolean }>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.tools.some((tool) => tool.name === 'Bash' && tool.source === 'claude')).toBe(true);
    expect(parsed.tools.some((tool) => tool.name === 'mcp__policy__validate_policy_pack' && tool.source === 'mcp')).toBe(true);
    expect(parsed.tools.some((tool) => tool.name === 'mcp__linear__*' && tool.pattern)).toBe(true);
  });

  it('get_policy_manifest returns manifest and resolved rule files', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/protect-main.md
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
      'rules/protect-main.md': 'Protect main.\n',
    });

    const result = await getPolicyManifestTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
    });

    const parsed = parseText(result) as {
      ok: boolean;
      manifest: { version: number };
      ruleFiles: Array<{ path: string; content: string }>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.manifest.version).toBe(1);
    expect(parsed.ruleFiles).toHaveLength(1);
    expect(parsed.ruleFiles[0]?.content).toContain('Protect main.');
  });

  it('list_policy_templates returns bundled starter templates', async () => {
    const result = await listPolicyTemplatesTool.execute({});
    const parsed = parseText(result) as {
      ok: boolean;
      templates: Array<{ path: string }>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.templates.some((template) => template.path === 'policy.yaml')).toBe(true);
    expect(parsed.templates.some((template) => template.path === 'rules/default/shell-safety.md')).toBe(true);
  });

  it('propose_policy_rule creates a valid MCP-targeted proposal', async () => {
    const result = await proposePolicyRuleTool.execute({
      level: 'guardrail',
      description: 'Require approval for Linear writes',
      toolName: 'mcp__linear__save_issue',
      commands: [],
      paths: [],
    });

    const parsed = parseText(result) as {
      ok: boolean;
      proposal: {
        rule: { id: string; file: string };
        hook: { event: string; matcher: string; use: string[]; when: { tools?: string[] } };
      };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.proposal.hook.event).toBe('PreToolUse');
    expect(parsed.proposal.hook.matcher).toBe('mcp__linear__save_issue');
    expect(parsed.proposal.hook.when.tools).toEqual(['mcp__linear__save_issue']);
    expect(parsed.proposal.hook.use).toEqual([parsed.proposal.rule.id]);
  });

  it('create_rule_file writes a reusable markdown file', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': 'version: 1\n',
    });

    const result = await createRuleFileTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
      relativePath: './rules/new-rule.md',
      content: '# New Rule\n\nText',
      overwrite: false,
    });

    const parsed = parseText(result) as { ok: boolean; path: string };
    expect(parsed.ok).toBe(true);
    await expect(fs.readFile(parsed.path, 'utf8')).resolves.toContain('# New Rule');
  });

  it('apply_policy_change allows advisory-only writes without extra approval', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules: []
hooks: []
`,
    });

    const result = await applyPolicyChangeTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
      manifest: {
        version: 1,
        governance: {
          allow_llm_updates: ['advisory'],
          require_approval_for: ['guardrail', 'enforcement'],
          approval_ttl_minutes: 30,
        },
        rules: [
          {
            id: 'docs-advice',
            level: 'advisory',
            file: './rules/docs-advice.md',
            tags: ['docs'],
            enabled: true,
          },
        ],
        rulepacks: [],
        hooks: [
          {
            id: 'session-docs-advice',
            event: 'SessionStart',
            matcher: '*',
            mode: 'inject',
            use: ['docs-advice'],
            when: {},
            enabled: true,
          },
        ],
      },
      ruleFiles: [
        {
          path: './rules/docs-advice.md',
          content: 'Prefer updating docs when behavior changes.\n',
        },
      ],
      approvalConfirmed: false,
    });

    const parsed = parseText(result) as {
      ok: boolean;
      classification: { approvalRequired: boolean; direction: string };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.classification.approvalRequired).toBe(false);
    await expect(fs.readFile(path.join(workspace, 'rules/docs-advice.md'), 'utf8')).resolves.toContain('Prefer updating docs');
  });

  it('apply_policy_change rejects enforcement changes without approval', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules: []
hooks: []
`,
    });

    const result = await applyPolicyChangeTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
      manifest: {
        version: 1,
        governance: {
          allow_llm_updates: ['advisory'],
          require_approval_for: ['guardrail', 'enforcement'],
          approval_ttl_minutes: 30,
        },
        rules: [
          {
            id: 'protect-main',
            level: 'enforcement',
            file: './rules/protect-main.md',
            tags: ['git'],
            enabled: true,
          },
        ],
        rulepacks: [],
        hooks: [
          {
            id: 'pretool-git',
            event: 'PreToolUse',
            matcher: 'Bash',
            mode: 'decide',
            decision: 'ask',
            use: ['protect-main'],
            when: {
              commands: ['git push *'],
            },
            enabled: true,
          },
        ],
      },
      ruleFiles: [
        {
          path: './rules/protect-main.md',
          content: 'Do not push directly to main.\n',
        },
      ],
      approvalConfirmed: false,
    });

    const parsed = parseText(result) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/requires approval/);
  });

  it('apply_policy_change writes enforcement changes when approval is confirmed', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules: []
hooks: []
`,
    });

    const result = await applyPolicyChangeTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
      manifest: {
        version: 1,
        governance: {
          allow_llm_updates: ['advisory'],
          require_approval_for: ['guardrail', 'enforcement'],
          approval_ttl_minutes: 30,
        },
        rules: [
          {
            id: 'protect-main',
            level: 'enforcement',
            file: './rules/protect-main.md',
            tags: ['git'],
            enabled: true,
          },
        ],
        rulepacks: [],
        hooks: [
          {
            id: 'pretool-git',
            event: 'PreToolUse',
            matcher: 'Bash',
            mode: 'decide',
            decision: 'ask',
            use: ['protect-main'],
            when: {
              commands: ['git push *'],
            },
            enabled: true,
          },
        ],
      },
      ruleFiles: [
        {
          path: './rules/protect-main.md',
          content: 'Do not push directly to main.\n',
        },
      ],
      approvalConfirmed: true,
    });

    const parsed = parseText(result) as {
      ok: boolean;
      classification: { approvalRequired: boolean; reasons: string[] };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.classification.approvalRequired).toBe(true);
    expect(parsed.classification.reasons.some((reason) => reason.includes('protect-main'))).toBe(true);
  });

  describe('cosmiconfig auto-discovery', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      setWorkspaceRoot(process.cwd());
    });

    it('read tools auto-discover policy.yaml at project root', async () => {
      const workspace = await makeWorkspace({
        'policy.yaml': `version: 1
rules:
  - id: test-rule
    level: advisory
    file: ./rules/test.md
hooks: []
`,
        'rules/test.md': 'Test rule.\n',
      });

      setWorkspaceRoot(workspace);

      const result = await validatePolicyPackTool.execute({});
      const parsed = parseText(result) as { ok: boolean };
      expect(parsed.ok).toBe(true);
    });

    it('read tools auto-discover .claude/policy.yaml at preferred location', async () => {
      const workspace = await makeWorkspace({
        '.claude/policy.yaml': `version: 1
rules:
  - id: test-rule
    level: advisory
    file: ../rules/test.md
hooks: []
`,
        'rules/test.md': 'Test rule.\n',
      });

      setWorkspaceRoot(workspace);

      const result = await getPolicyManifestTool.execute({});
      const parsed = parseText(result) as { ok: boolean; manifest: { version: number } };
      expect(parsed.ok).toBe(true);
      expect(parsed.manifest.version).toBe(1);
    });

    it('read tools return error when no manifest is found', async () => {
      const workspace = await makeWorkspace({});

      setWorkspaceRoot(workspace);

      const result = await evaluatePolicyTool.execute({
        event: 'PreToolUse',
        toolName: 'Bash',
        command: 'rm -rf /',
      });
      const parsed = parseText(result) as { ok: boolean; error: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toMatch(/No policy manifest found/);
    });

    it('apply_policy_change defaults to .claude/policy.yaml when no manifest exists', async () => {
      const workspace = await makeWorkspace({});

      setWorkspaceRoot(workspace);

      const result = await applyPolicyChangeTool.execute({
        manifest: {
          version: 1,
          governance: {
            allow_llm_updates: ['advisory'],
            require_approval_for: ['guardrail', 'enforcement'],
            approval_ttl_minutes: 30,
          },
          rules: [],
          rulepacks: [],
          hooks: [],
        },
        ruleFiles: [],
        approvalConfirmed: false,
      });

      const parsed = parseText(result) as { ok: boolean; manifestPath: string };
      expect(parsed.ok).toBe(true);
      expect(parsed.manifestPath).toContain('.claude/policy.yaml');
      await expect(
        fs.readFile(path.join(workspace, '.claude/policy.yaml'), 'utf8'),
      ).resolves.toContain('version: 1');
    });

    it('evaluate_policy resolves workspace root correctly for approval lookups', async () => {
      const workspace = await makeWorkspace({
        'policy.yaml': `version: 1
rules:
  - id: shell-safety
    level: guardrail
    file: ./rules/shell-safety.md
hooks:
  - id: pretool-bash
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [shell-safety]
    when:
      commands: ["rm *"]
`,
        'rules/shell-safety.md': 'Review destructive commands.\n',
      });

      setWorkspaceRoot(workspace);

      const result = await evaluatePolicyTool.execute({
        event: 'PreToolUse',
        toolName: 'Bash',
        command: 'rm -rf node_modules',
      });

      const parsed = parseText(result) as {
        ok: boolean;
        result: { decision: string; matched: boolean; hookId: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.result.matched).toBe(true);
      expect(parsed.result.decision).toBe('ask');
      expect(parsed.result.hookId).toBe('pretool-bash');
    });

    it('explain_policy_decision works with auto-discovered manifest', async () => {
      const workspace = await makeWorkspace({
        '.claude/policy.yaml': `version: 1
rules:
  - id: secrets-block
    level: enforcement
    file: ../rules/secrets.md
hooks:
  - id: pretool-secrets
    event: PreToolUse
    matcher: "Write|Edit"
    mode: decide
    decision: deny
    use: [secrets-block]
    when:
      paths: [".env*"]
`,
        'rules/secrets.md': 'Do not write secrets.\n',
      });

      setWorkspaceRoot(workspace);

      const result = await explainPolicyDecisionTool.execute({
        event: 'PreToolUse',
        toolName: 'Write',
        path: '.env.local',
      });

      const parsed = parseText(result) as {
        ok: boolean;
        decision: string;
        hookId: string;
        matched: boolean;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.decision).toBe('deny');
      expect(parsed.hookId).toBe('pretool-secrets');
      expect(parsed.matched).toBe(true);
    });

    it('search_policies works with auto-discovered manifest', async () => {
      const workspace = await makeWorkspace({
        'policy.yaml': `version: 1
rules:
  - id: git-safety
    level: guardrail
    file: ./rules/git.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [git-safety]
    when:
      commands: ["git push *"]
`,
        'rules/git.md': 'Never force push to main branch.\n',
      });

      setWorkspaceRoot(workspace);

      const result = await searchPoliciesTool.execute({
        query: 'force push main',
        topK: 3,
      });

      const parsed = parseText(result) as {
        ok: boolean;
        results: Array<{ assetId: string }>;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.results[0]?.assetId).toBe('git-safety');
    });

    it('explicit manifestPath overrides auto-discovery', async () => {
      const workspace = await makeWorkspace({
        'policy.yaml': `version: 1
rules:
  - id: root-rule
    level: advisory
    file: ./rules/root.md
hooks: []
`,
        'rules/root.md': 'Root rule.\n',
        'custom/my-policy.yaml': `version: 1
rules:
  - id: custom-rule
    level: advisory
    file: ../rules/custom.md
hooks: []
`,
        'rules/custom.md': 'Custom rule.\n',
      });

      setWorkspaceRoot(workspace);

      const result = await listPolicyAssetsTool.execute({
        manifestPath: path.join(workspace, 'custom/my-policy.yaml'),
      });

      const parsed = parseText(result) as {
        ok: boolean;
        assets: Array<{ id: string }>;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.assets[0]?.id).toBe('custom-rule');
    });
  });

  describe('setWorkspaceRoot', () => {
    afterEach(() => {
      // Reset to process.cwd() after each test so other tests aren't affected
      setWorkspaceRoot(process.cwd());
    });

    it('setWorkspaceRoot affects resolveManifestPath auto-discovery', async () => {
      const workspace = await makeWorkspace({
        'policy.yaml': `version: 1
rules:
  - id: workspace-rule
    level: advisory
    file: ./rules/workspace-rule.md
hooks: []
`,
        'rules/workspace-rule.md': 'Workspace rule content.\n',
      });

      setWorkspaceRoot(workspace);

      const result = await validatePolicyPackTool.execute({});
      const parsed = parseText(result) as { ok: boolean };
      expect(parsed.ok).toBe(true);
    });

    it('setWorkspaceRoot affects resolveManifestPathForWrite default path', async () => {
      const workspace = await makeWorkspace({});

      setWorkspaceRoot(workspace);

      const result = await applyPolicyChangeTool.execute({
        manifest: {
          version: 1,
          governance: {
            allow_llm_updates: ['advisory'],
            require_approval_for: ['guardrail', 'enforcement'],
            approval_ttl_minutes: 30,
          },
          rules: [],
          rulepacks: [],
          hooks: [],
        },
        ruleFiles: [],
        approvalConfirmed: false,
      });

      const parsed = parseText(result) as { ok: boolean; manifestPath: string };
      expect(parsed.ok).toBe(true);
      // Written to the injected workspace root, not process.cwd()
      expect(parsed.manifestPath).toContain(workspace);
      expect(parsed.manifestPath).toContain('.claude/policy.yaml');
    });
  });

  it('format_policy_yaml normalizes manifest formatting and validates with zod', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
hooks:
  - when:
      commands: ["git push *"]
    use: [protect-main]
    decision: ask
    mode: decide
    matcher: Bash
    event: PreToolUse
    id: pretool-git
rules:
  - tags: [git]
    file: ./rules/protect-main.md
    level: enforcement
    id: protect-main
`,
      'rules/protect-main.md': 'Do not push directly to main.\n',
    });

    const result = await formatPolicyYamlTool.execute({
      manifestPath: path.join(workspace, 'policy.yaml'),
      write: true,
    });

    const parsed = parseText(result) as {
      ok: boolean;
      formattedYaml: string;
      validation: { ok: boolean };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.validation.ok).toBe(true);
    expect(parsed.formattedYaml).toContain('governance:');
    expect(parsed.formattedYaml).toContain('rules:');
    expect(parsed.formattedYaml).toContain('hooks:');
    await expect(fs.readFile(path.join(workspace, 'policy.yaml'), 'utf8')).resolves.toContain('governance:');
  });
});
