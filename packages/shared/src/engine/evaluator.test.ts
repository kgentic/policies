import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPolicyManifest } from './loader.js';
import type { ResolvedManifest } from './loader.js';
import type { LayerSource, PolicyHookMode, PolicyDecision, PolicyHookEvent } from './engine-schema.js';
import { EngineManifestSchema } from './engine-schema.js';
import { evaluatePolicy } from './evaluator.js';

const tempDirs: string[] = [];

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-evaluator-'));
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

describe('evaluatePolicy', () => {
  it('returns the most restrictive matching PreToolUse decision', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/protect-main.md
  - id: fallback
    level: guardrail
    file: ./rules/fallback.md
hooks:
  - id: first-match
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [protect-main]
    when:
      commands: ["git push *"]
  - id: second-match
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [fallback]
    when:
      commands: ["git *"]
`,
      'rules/protect-main.md': 'Do not push directly.\n',
      'rules/fallback.md': 'Fallback guidance.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git push origin main',
    });

    expect(result.matched).toBe(true);
    expect(result.hookId).toBe('first-match');
    expect(result.decision).toBe('deny');
    expect(result.systemMessage).toContain('Do not push directly.');
  });

  it('matches path-based Write hooks', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protected-files
    level: enforcement
    file: ./rules/protected-files.md
hooks:
  - id: protected-write
    event: PreToolUse
    matcher: Write|Edit|MultiEdit|NotebookEdit
    mode: decide
    decision: ask
    use: [protected-files]
    when:
      paths: ["src/**", "package.json"]
`,
      'rules/protected-files.md': 'Protected files require review.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Write',
      path: 'src/server.ts',
    });

    expect(result.matched).toBe(true);
    expect(result.decision).toBe('ask');
  });

  it('deny wins over ask regardless of hook ordering', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: shell-safety
    level: guardrail
    file: ./rules/shell-safety.md
  - id: no-force-push
    level: enforcement
    file: ./rules/no-force-push.md
hooks:
  - id: bash-ask
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [shell-safety]
    when:
      commands: ["git push *"]
  - id: force-push-deny
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [no-force-push]
    when:
      commands: ["git push --force*"]
`,
      'rules/shell-safety.md': 'Shell safety.\n',
      'rules/no-force-push.md': 'No force push.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git push --force origin main',
    });

    expect(result.matched).toBe(true);
    expect(result.hookId).toBe('force-push-deny');
    expect(result.decision).toBe('deny');
    expect(result.systemMessage).toContain('No force push.');
  });

  it('matches absolute paths against relative glob patterns', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: secrets-block
    level: enforcement
    file: ./rules/secrets.md
hooks:
  - id: pretool-secrets
    event: PreToolUse
    matcher: "Write|Edit"
    mode: decide
    decision: deny
    use: [secrets-block]
    when:
      paths: [".env*", "**/*.pem"]
`,
      'rules/secrets.md': 'Block secrets.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));

    const absoluteEnv = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Write',
      path: path.join(workspace, '.env.local'),
    });
    expect(absoluteEnv.matched).toBe(true);
    expect(absoluteEnv.decision).toBe('deny');

    const absolutePem = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Write',
      path: path.join(workspace, 'certs/server.pem'),
    });
    expect(absolutePem.matched).toBe(true);
    expect(absolutePem.decision).toBe('deny');

    const relativeEnv = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Write',
      path: '.env.production',
    });
    expect(relativeEnv.matched).toBe(true);
    expect(relativeEnv.decision).toBe('deny');
  });

  it('includes inject hook content when decide hook also matches same input', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: typecheck-on-ts-edit
    level: guardrail
    file: ./rules/typecheck.md
  - id: protected-files
    level: enforcement
    file: ./rules/protected.md
hooks:
  - id: inject-typecheck-on-ts-edit
    event: PreToolUse
    matcher: Edit
    mode: inject
    use: [typecheck-on-ts-edit]
    when:
      paths: ["src/**/*.ts"]
  - id: pretool-write-protected
    event: PreToolUse
    matcher: Edit
    mode: decide
    decision: ask
    use: [protected-files]
    when:
      paths: ["src/**"]
`,
      'rules/typecheck.md': 'run typecheck after editing TypeScript files\n',
      'rules/protected.md': 'protected files require review before editing\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Edit',
      path: 'src/foo.ts',
    });

    expect(result.matched).toBe(true);
    expect(result.systemMessage).toContain('run typecheck after editing TypeScript files');
    expect(result.systemMessage).toContain('protected files require review before editing');
  });

  it('retrieves only top_k relevant sections when retrieve.enabled is true', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: error-handling
    level: guardrail
    file: ./rules/error-handling.md
hooks:
  - id: inject-error-handling
    event: PreToolUse
    matcher: Edit
    mode: inject
    use: [error-handling]
    when:
      paths: ["src/**"]
    retrieve:
      enabled: true
      strategy: fts
      top_k: 2
`,
      'rules/error-handling.md': `# Error Handling

- **Fail fast on the critical path** — if it can't recover, don't try.
- **Never swallow errors** — catch {} with no action is a bug.
- **Log every unexpected error** — observability is not optional.
- **Use typed errors** — avoid throwing plain strings.
- **Retry only idempotent operations** — never retry destructive commands.
`,
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));

    // Query with "command" context containing "catch" — should surface the swallow-errors section
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Edit',
      path: 'src/api/handler.ts',
      command: 'catch error swallow',
    });

    expect(result.matched).toBe(true);
    expect(result.systemMessage).toContain('inject-error-handling');

    // Only top_k=2 sections returned — must NOT include all 5 sections
    const bulletCount = (result.systemMessage.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBeLessThanOrEqual(2);

    // The "swallow" token should score the "Never swallow errors" section highly
    expect(result.systemMessage).toContain('Never swallow errors');
  });

  it('returns full content when retrieve is not configured (backward compatible)', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: error-handling
    level: guardrail
    file: ./rules/error-handling.md
hooks:
  - id: inject-error-handling
    event: PreToolUse
    matcher: Edit
    mode: inject
    use: [error-handling]
    when:
      paths: ["src/**"]
`,
      'rules/error-handling.md': `# Error Handling

- **Fail fast on the critical path** — if it can't recover, don't try.
- **Never swallow errors** — catch {} with no action is a bug.
- **Log every unexpected error** — observability is not optional.
`,
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Edit',
      path: 'src/api/handler.ts',
    });

    expect(result.matched).toBe(true);
    // All three sections present — no retrieval filtering
    expect(result.systemMessage).toContain('Fail fast on the critical path');
    expect(result.systemMessage).toContain('Never swallow errors');
    expect(result.systemMessage).toContain('Log every unexpected error');
  });

  it('higher priority hook wins when severity is equal', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: rule-a
    level: guardrail
    file: ./rules/rule-a.md
  - id: rule-b
    level: guardrail
    file: ./rules/rule-b.md
hooks:
  - id: low-priority-ask
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    priority: 1
    use: [rule-a]
    when:
      commands: ["git *"]
  - id: high-priority-ask
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    priority: 10
    use: [rule-b]
    when:
      commands: ["git *"]
`,
      'rules/rule-a.md': 'Rule A content.\n',
      'rules/rule-b.md': 'Rule B content.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git status',
    });

    expect(result.matched).toBe(true);
    expect(result.decision).toBe('ask');
    expect(result.hookId).toBe('high-priority-ask');
    expect(result.explanation?.reason).toContain('priority tiebreaker');
  });

  it('priority breaks ties but severity still wins over priority', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: rule-deny
    level: enforcement
    file: ./rules/rule-deny.md
  - id: rule-ask
    level: guardrail
    file: ./rules/rule-ask.md
hooks:
  - id: high-priority-ask
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    priority: 100
    use: [rule-ask]
    when:
      commands: ["git *"]
  - id: low-priority-deny
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    priority: 1
    use: [rule-deny]
    when:
      commands: ["git push*"]
`,
      'rules/rule-deny.md': 'Deny low priority.\n',
      'rules/rule-ask.md': 'Ask high priority.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git push origin main',
    });

    expect(result.matched).toBe(true);
    expect(result.decision).toBe('deny');
    expect(result.hookId).toBe('low-priority-deny');
  });

  it('hooks without priority default to 0', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: rule-default
    level: guardrail
    file: ./rules/rule-default.md
  - id: rule-explicit
    level: guardrail
    file: ./rules/rule-explicit.md
hooks:
  - id: no-priority-hook
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [rule-default]
    when:
      commands: ["git *"]
  - id: priority-ten-hook
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    priority: 10
    use: [rule-explicit]
    when:
      commands: ["git *"]
`,
      'rules/rule-default.md': 'Default priority content.\n',
      'rules/rule-explicit.md': 'Explicit priority content.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git status',
    });

    expect(result.matched).toBe(true);
    expect(result.decision).toBe('ask');
    expect(result.hookId).toBe('priority-ten-hook');
  });

  it('priority enables exception rules — allow does not override deny because severity still wins', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: org-deny
    level: enforcement
    file: ./rules/org-deny.md
  - id: team-allow
    level: guardrail
    file: ./rules/team-allow.md
hooks:
  - id: org-level-deny
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    priority: 1
    use: [org-deny]
    when:
      commands: ["rm *"]
  - id: team-level-allow
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: allow
    priority: 100
    use: [team-allow]
    when:
      commands: ["rm *"]
`,
      'rules/org-deny.md': 'Org deny rule.\n',
      'rules/team-allow.md': 'Team allow rule.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'rm -rf dist',
    });

    // deny (severity 2) still beats allow (severity 0) regardless of priority
    expect(result.matched).toBe(true);
    expect(result.decision).toBe('deny');
    expect(result.hookId).toBe('org-level-deny');
  });

  it('matchedFiles are relative to options.workspaceRoot when provided', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protected-files
    level: enforcement
    file: ./rules/protected-files.md
hooks:
  - id: protected-write
    event: PreToolUse
    matcher: Write|Edit
    mode: decide
    decision: ask
    use: [protected-files]
    when:
      paths: ["src/**"]
`,
      'rules/protected-files.md': 'Protected files require review.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(
      loaded,
      {
        event: 'PreToolUse',
        toolName: 'Write',
        path: 'src/index.ts',
      },
      { workspaceRoot: workspace },
    );

    expect(result.matched).toBe(true);
    // matchedFiles paths must be relative to the provided workspace root
    for (const file of result.matchedFiles) {
      expect(path.isAbsolute(file)).toBe(false);
    }
  });

  it('defaults to allow when no hook matches', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: shell-safety
    level: guardrail
    file: ./rules/shell-safety.md
hooks:
  - id: shell-only
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [shell-safety]
    when:
      commands: ["git *"]
`,
      'rules/shell-safety.md': 'Shell safety.\n',
    });

    const loaded = await loadPolicyManifest(path.join(workspace, 'policy.yaml'));
    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Write',
      path: 'docs/readme.md',
    });

    expect(result.matched).toBe(false);
    expect(result.decision).toBe('allow');
  });
});

describe('cross-layer resolution', () => {
  // Fake root used as manifestPath so path.dirname() produces a stable directory.
  // File-based asset lookup is bypassed — ruleContents is populated directly.
  const FAKE_ROOT = '/fake/policy-root/.claude/policy.yaml';
  const FAKE_DIR = '/fake/policy-root/.claude';

  interface HookSpec {
    id: string;
    event: PolicyHookEvent;
    matcher: string;
    mode: PolicyHookMode;
    decision?: PolicyDecision;
    priority?: number;
    use: string[];
    when: { commands?: string[]; paths?: string[]; tools?: string[] };
  }

  function makeResolvedManifest(opts: {
    hooks: HookSpec[];
    effectiveSource: Record<string, LayerSource>;
    ruleContents?: Record<string, string>;
  }): ResolvedManifest {
    // Derive a unique rule entry for each `use` id referenced by any hook.
    const usedIds = [...new Set(opts.hooks.flatMap((h) => h.use))];

    // Each rule maps to a fake absolute file path under FAKE_DIR.
    const ruleFileMap = new Map<string, string>(
      usedIds.map((id) => [id, path.join(FAKE_DIR, 'rules', `${id}.md`)]),
    );

    // Build the raw manifest object that will pass EngineManifestSchema.parse().
    const rawManifest = {
      version: 1 as const,
      rules: usedIds.map((id) => ({
        id,
        level: 'guardrail' as const,
        file: `./rules/${id}.md`,
        tags: [],
        enabled: true,
      })),
      hooks: opts.hooks.map((h) => ({
        id: h.id,
        event: h.event,
        matcher: h.matcher,
        mode: h.mode,
        ...(h.decision !== undefined ? { decision: h.decision } : {}),
        ...(h.priority !== undefined ? { priority: h.priority } : {}),
        use: h.use,
        when: h.when,
        enabled: true,
      })),
    };

    const manifest = EngineManifestSchema.parse(rawManifest);

    // Build assets map: each rule id → LoadedPolicyAsset with a single file path.
    const assets = new Map(
      usedIds.map((id) => [
        id,
        {
          id,
          kind: 'rule' as const,
          files: [ruleFileMap.get(id) ?? path.join(FAKE_DIR, 'rules', `${id}.md`)],
          tags: [],
        },
      ]),
    );

    // Build ruleContents map: file path → content string.
    const ruleContents = new Map<string, string>();
    for (const [id, filePath] of ruleFileMap) {
      const supplied = opts.ruleContents?.[id];
      ruleContents.set(filePath, supplied ?? `Rule content for ${id}.\n`);
    }

    const effectiveSource = new Map<string, LayerSource>(
      Object.entries(opts.effectiveSource),
    );

    return {
      manifestPath: FAKE_ROOT,
      manifest,
      hash: 'test-hash',
      assets,
      ruleContents,
      layers: [],
      effectiveSource,
      suppressedItems: [],
    };
  }

  it('project-layer hook wins over user-layer hook at same severity', () => {
    const loaded = makeResolvedManifest({
      hooks: [
        {
          id: 'user-ask',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'ask',
          priority: 0,
          use: ['user-ask-rule'],
          when: { commands: ['git *'] },
        },
        {
          id: 'project-ask',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'ask',
          priority: 0,
          use: ['project-ask-rule'],
          when: { commands: ['git *'] },
        },
      ],
      effectiveSource: { 'user-ask': 'user', 'project-ask': 'project' },
    });

    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git status',
    });

    expect(result.matched).toBe(true);
    expect(result.hookId).toBe('project-ask');
    expect(result.decision).toBe('ask');
    expect(result.explanation?.reason).toContain('layer precedence');
  });

  it('severity still wins over layer precedence', () => {
    const loaded = makeResolvedManifest({
      hooks: [
        {
          id: 'user-deny',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'deny',
          use: ['user-deny-rule'],
          when: { commands: ['rm *'] },
        },
        {
          id: 'project-allow',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'allow',
          use: ['project-allow-rule'],
          when: { commands: ['rm *'] },
        },
      ],
      effectiveSource: { 'user-deny': 'user', 'project-allow': 'project' },
    });

    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'rm -rf dist',
    });

    expect(result.matched).toBe(true);
    expect(result.hookId).toBe('user-deny');
    expect(result.decision).toBe('deny');
  });

  it('layer precedence wins over intra-layer priority', () => {
    const loaded = makeResolvedManifest({
      hooks: [
        {
          id: 'user-high-priority',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'ask',
          priority: 100,
          use: ['user-high-priority-rule'],
          when: { commands: ['git *'] },
        },
        {
          id: 'project-low-priority',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'ask',
          priority: 1,
          use: ['project-low-priority-rule'],
          when: { commands: ['git *'] },
        },
      ],
      effectiveSource: {
        'user-high-priority': 'user',
        'project-low-priority': 'project',
      },
    });

    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git status',
    });

    expect(result.matched).toBe(true);
    expect(result.hookId).toBe('project-low-priority');
    expect(result.decision).toBe('ask');
    expect(result.explanation?.reason).toContain('layer precedence');
  });

  it('same-layer same-severity same-priority — last in array wins', () => {
    const loaded = makeResolvedManifest({
      hooks: [
        {
          id: 'hook-first',
          event: 'PreToolUse',
          matcher: 'Edit',
          mode: 'decide',
          decision: 'ask',
          priority: 5,
          use: ['hook-first-rule'],
          when: { paths: ['src/**'] },
        },
        {
          id: 'hook-second',
          event: 'PreToolUse',
          matcher: 'Edit',
          mode: 'decide',
          decision: 'ask',
          priority: 5,
          use: ['hook-second-rule'],
          when: { paths: ['src/**'] },
        },
      ],
      effectiveSource: { 'hook-first': 'project', 'hook-second': 'project' },
    });

    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Edit',
      path: 'src/foo.ts',
    });

    expect(result.matched).toBe(true);
    expect(result.hookId).toBe('hook-second');
    expect(result.decision).toBe('ask');
    expect(result.explanation?.reason).toContain('source order');
  });

  it('single-layer behavior unchanged — priority still breaks ties', () => {
    const loaded = makeResolvedManifest({
      hooks: [
        {
          id: 'low-pri',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'ask',
          priority: 1,
          use: ['low-pri-rule'],
          when: { commands: ['git *'] },
        },
        {
          id: 'high-pri',
          event: 'PreToolUse',
          matcher: 'Bash',
          mode: 'decide',
          decision: 'ask',
          priority: 10,
          use: ['high-pri-rule'],
          when: { commands: ['git *'] },
        },
      ],
      effectiveSource: { 'low-pri': 'project', 'high-pri': 'project' },
    });

    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Bash',
      command: 'git log',
    });

    expect(result.matched).toBe(true);
    expect(result.hookId).toBe('high-pri');
    expect(result.decision).toBe('ask');
    expect(result.explanation?.reason).toContain('priority tiebreaker');
  });

  it('inject hooks from lower layer still contribute systemMessage', () => {
    const loaded = makeResolvedManifest({
      hooks: [
        {
          id: 'user-inject',
          event: 'PreToolUse',
          matcher: 'Edit',
          mode: 'inject',
          use: ['user-inject-rule'],
          when: { paths: ['src/**'] },
        },
        {
          id: 'project-decide',
          event: 'PreToolUse',
          matcher: 'Edit',
          mode: 'decide',
          decision: 'ask',
          use: ['project-decide-rule'],
          when: { paths: ['src/**'] },
        },
      ],
      effectiveSource: { 'user-inject': 'user', 'project-decide': 'project' },
      ruleContents: {
        'user-inject-rule': 'user guidance text',
        'project-decide-rule': 'project enforcement text',
      },
    });

    const result = evaluatePolicy(loaded, {
      event: 'PreToolUse',
      toolName: 'Edit',
      path: 'src/bar.ts',
    });

    expect(result.matched).toBe(true);
    expect(result.decision).toBe('ask');
    expect(result.systemMessage).toContain('user guidance text');
    expect(result.systemMessage).toContain('project enforcement text');
  });
});
