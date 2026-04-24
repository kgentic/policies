import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { runHook } from './runner.js';
import { loadPolicyManifestFromDir } from '@kgentic-ai/policies-shared';

const tempDirs: string[] = [];

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-runner-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  }

  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('hook runner contract', () => {
  it('fails open when no policy.yaml exists', async () => {
    const workspace = await makeWorkspace({});
    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    }))) as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('returns ask for a matching policy hook', async () => {
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
      'rules/protect-main.md': 'Do not push directly to main.\n',
    });

    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
    }))) as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput.additionalContext).toContain('Do not push directly to main.');
  });

  it('discovers policy config using project-style search from a nested cwd', async () => {
    const workspace = await makeWorkspace({
      '.policyrc.yaml': `version: 1
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
      'rules/protect-main.md': 'Do not push directly to main.\n',
      'packages/app/src/placeholder.txt': '',
    });

    const nestedCwd = path.join(workspace, 'packages/app/src');
    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: nestedCwd,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
    }))) as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput.additionalContext).toContain('Do not push directly to main.');
  });

  it('discovers policy config from the .claude directory', async () => {
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

    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
    }))) as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput.additionalContext).toContain('Do not push directly to main.');
  });

  it('reuses a persisted approval on the next PreToolUse', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
governance:
  approval_ttl_minutes: 30
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
      'rules/protect-main.md': 'Do not push directly to main.\n',
    });

    await runHook('post-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
    }));

    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
    }))) as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(result.hookSpecificOutput.additionalContext).toContain('approval');
  });

  it('evaluates inject hooks on SessionStart and includes systemMessage', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: swe-principles
    level: advisory
    file: ./rules/swe-principles.md
hooks:
  - id: inject-session-start
    event: SessionStart
    matcher: "*"
    mode: inject
    use: [swe-principles]
    when: {}
`,
      'rules/swe-principles.md': 'Always write tests before code.\n',
    });

    const result = JSON.parse(await runHook('session', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'SessionStart',
    }))) as { continue: boolean; systemMessage?: string };

    expect(result.continue).toBe(true);
    expect(result.systemMessage).toContain('Policy plugin active.');
    expect(result.systemMessage).toContain('Always write tests before code.');
  });

  it('returns Stop block decision for blocking Stop hooks', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: stop-check
    level: guardrail
    file: ./rules/stop-check.md
hooks:
  - id: stop-validation
    event: Stop
    matcher: "*"
    mode: decide
    decision: block
    use: [stop-check]
    when: {}
`,
      'rules/stop-check.md': 'Tests have not been run.\n',
    });

    const result = JSON.parse(await runHook('stop', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'Stop',
    }))) as { decision?: string; reason?: string };

    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Tests have not been run.');
  });

  it('drains two ask hooks one at a time across multiple tool calls', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
governance:
  approval_ttl_minutes: 30
rules:
  - id: protected-files
    level: enforcement
    file: ./rules/protected-files.md
  - id: migration-review
    level: enforcement
    file: ./rules/migration-review.md
hooks:
  - id: hook-a
    event: PreToolUse
    matcher: Edit
    mode: decide
    decision: ask
    use: [protected-files]
    when:
      paths: ["src/**"]
  - id: hook-b
    event: PreToolUse
    matcher: Edit
    mode: decide
    decision: ask
    use: [migration-review]
    when:
      paths: ["src/**"]
`,
      'rules/protected-files.md': 'Protected files require review.\n',
      'rules/migration-review.md': 'Migration files require extra care.\n',
    });

    const toolCall = JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(workspace, 'src/migration.ts') },
    });

    type PreToolResult = { hookSpecificOutput: { permissionDecision: string; additionalContext?: string; permissionDecisionReason?: string } };

    // Attempt 1: hook-a not approved → returns ask for hook-a only
    const attempt1 = JSON.parse(await runHook('pre-tool', toolCall)) as PreToolResult;
    expect(attempt1.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(attempt1.hookSpecificOutput.permissionDecisionReason).toContain('hook-a');
    expect(attempt1.hookSpecificOutput.additionalContext).toContain('Protected files require review.');

    // Simulate PostToolUse (user approved hook-a, tool ran)
    await runHook('post-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(workspace, 'src/migration.ts') },
    }));

    // Attempt 2: hook-a approved (cached), hook-b not yet → returns ask for hook-b only
    const attempt2 = JSON.parse(await runHook('pre-tool', toolCall)) as PreToolResult;
    expect(attempt2.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(attempt2.hookSpecificOutput.permissionDecisionReason).toContain('hook-b');
    expect(attempt2.hookSpecificOutput.additionalContext).toContain('Migration files require extra care.');

    // Simulate PostToolUse again (user approved hook-b, tool ran)
    await runHook('post-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(workspace, 'src/migration.ts') },
    }));

    // Attempt 3: both hooks approved → allow silently
    const attempt3 = JSON.parse(await runHook('pre-tool', toolCall)) as PreToolResult;
    expect(attempt3.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(attempt3.hookSpecificOutput.additionalContext).toContain('approval');
  });

  it('deny hook wins immediately even when an ask hook also matches', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
governance:
  approval_ttl_minutes: 30
rules:
  - id: no-force-push
    level: enforcement
    file: ./rules/no-force-push.md
  - id: shell-safety
    level: guardrail
    file: ./rules/shell-safety.md
hooks:
  - id: shell-ask
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [shell-safety]
    when:
      commands: ["git push *"]
  - id: force-deny
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [no-force-push]
    when:
      commands: ["git push --force*"]
`,
      'rules/no-force-push.md': 'Force push is forbidden.\n',
      'rules/shell-safety.md': 'Shell safety reminder.\n',
    });

    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push --force origin main' },
    }))) as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput.additionalContext).toContain('Force push is forbidden.');
  });

  it('ask hook additionalContext includes inject content alongside the ask rule', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
governance:
  approval_ttl_minutes: 30
rules:
  - id: protected-files
    level: enforcement
    file: ./rules/protected-files.md
  - id: typecheck-reminder
    level: advisory
    file: ./rules/typecheck-reminder.md
hooks:
  - id: hook-ask
    event: PreToolUse
    matcher: Edit
    mode: decide
    decision: ask
    use: [protected-files]
    when:
      paths: ["src/**"]
  - id: hook-inject
    event: PreToolUse
    matcher: Edit
    mode: inject
    use: [typecheck-reminder]
    when:
      paths: ["src/**"]
`,
      'rules/protected-files.md': 'Protected files require review.\n',
      'rules/typecheck-reminder.md': 'Run typecheck after editing TypeScript.\n',
    });

    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(workspace, 'src/foo.ts') },
    }))) as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput.additionalContext).toContain('Protected files require review.');
    expect(result.hookSpecificOutput.additionalContext).toContain('Run typecheck after editing TypeScript.');
  });

  it('returns allow when all ask hooks are pre-approved', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
governance:
  approval_ttl_minutes: 30
rules:
  - id: protected-files
    level: enforcement
    file: ./rules/protected-files.md
  - id: migration-review
    level: enforcement
    file: ./rules/migration-review.md
hooks:
  - id: hook-a
    event: PreToolUse
    matcher: Edit
    mode: decide
    decision: ask
    use: [protected-files]
    when:
      paths: ["src/**"]
  - id: hook-b
    event: PreToolUse
    matcher: Edit
    mode: decide
    decision: ask
    use: [migration-review]
    when:
      paths: ["src/**"]
`,
      'rules/protected-files.md': 'Protected files require review.\n',
      'rules/migration-review.md': 'Migration files require extra care.\n',
    });

    const toolInput = { file_path: path.join(workspace, 'src/migration.ts') };
    const postToolPayload = JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: toolInput,
    });

    // Drain advances one hook per PostToolUse — two calls to seed both hook-a and hook-b
    await runHook('post-tool', postToolPayload); // records hook-a (first unapproved)
    await runHook('post-tool', postToolPayload); // records hook-b (now first unapproved)

    type PreToolResult = { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    // Both hooks now approved → allow
    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: workspace,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: toolInput,
    }))) as PreToolResult;

    expect(result.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(result.hookSpecificOutput.additionalContext).toContain('approval');
  });

  it('uses preloaded manifest instead of discovering from cwd', async () => {
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
      'rules/protect-main.md': 'Do not push directly to main.\n',
    });

    const preloaded = await loadPolicyManifestFromDir({ startDir: workspace });

    // Use a cwd that has NO policy file — preloaded should be used instead
    const emptyCwd = await makeWorkspace({});
    const result = JSON.parse(await runHook('pre-tool', JSON.stringify({
      cwd: emptyCwd,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
    }), preloaded)) as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput.additionalContext).toContain('Do not push directly to main.');
  });
});
