import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  PolicyGovernanceSchema,
  PolicyHookSchema,
  EngineManifestSchema,
  PolicyRuleLevelSchema,
  EngineRuleSchema,
  type PolicyDecision,
  type PolicyHookEvent,
  type PolicyHook,
  type PolicyHookMode,
  type EngineManifest,
  type EngineRule,
} from './engine-schema.js';
import { loadPolicyManifest, validatePolicyManifest } from './loader.js';

export const CLAUDE_NATIVE_TOOL_NAMES = [
  'Task',
  'Bash',
  'Glob',
  'Grep',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
] as const;

export const POLICY_MCP_TOOL_NAMES = [
  'validate_policy_pack',
  'evaluate_policy',
  'search_policies',
  'list_policy_assets',
  'explain_policy_decision',
  'list_approvals',
  'list_governable_tools',
  'get_policy_manifest',
  'list_policy_templates',
  'propose_policy_rule',
  'create_rule_file',
  'apply_policy_change',
  'format_policy_yaml',
] as const;

export const GovernableToolSchema = z.object({
  name: z.string().min(1),
  source: z.enum(['claude', 'mcp', 'mcp-pattern']),
  category: z.string().min(1),
  pattern: z.boolean().default(false),
  discovered: z.boolean().default(true),
  server: z.string().optional(),
  notes: z.string().optional(),
});

export const PolicyChangeDirectionSchema = z.enum([
  'neutral',
  'tightening',
  'weakening',
  'mixed',
]);

export const PolicyChangeClassificationSchema = z.object({
  direction: PolicyChangeDirectionSchema,
  approvalRequired: z.boolean(),
  changedRules: z.array(z.string()),
  changedHooks: z.array(z.string()),
  reasons: z.array(z.string()),
});

export const ProposedPolicyRuleSchema = z.object({
  rule: EngineRuleSchema,
  hook: PolicyHookSchema,
});

export type GovernableTool = z.infer<typeof GovernableToolSchema>;
export type PolicyChangeClassification = z.infer<typeof PolicyChangeClassificationSchema>;
export type ProposedPolicyRule = z.infer<typeof ProposedPolicyRuleSchema>;

const ROOT_MCP_CONFIG = '.mcp.json';

function templatesRoot(): string {
  return fileURLToPath(new URL('../../templates', import.meta.url));
}

function workspaceRootFromManifestPath(manifestPath: string): string {
  return path.dirname(path.resolve(manifestPath));
}

async function readJsonFileIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function classifyToolCategory(name: string): string {
  if (name.startsWith('mcp__')) {
    return 'mcp';
  }
  if (name === 'Bash') {
    return 'shell';
  }
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    return 'write';
  }
  if (['Read', 'Grep', 'Glob'].includes(name)) {
    return 'read';
  }
  if (name.startsWith('Web')) {
    return 'web';
  }
  if (name === 'Task') {
    return 'agent';
  }
  return 'general';
}

export async function listGovernableTools(workspaceRoot: string): Promise<GovernableTool[]> {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
  const tools: GovernableTool[] = [
    ...CLAUDE_NATIVE_TOOL_NAMES.map((name) => ({
      name,
      source: 'claude' as const,
      category: classifyToolCategory(name),
      pattern: false,
      discovered: true,
    })),
    ...POLICY_MCP_TOOL_NAMES.map((name) => ({
      name: `mcp__policy__${name}`,
      source: 'mcp' as const,
      category: 'mcp',
      pattern: false,
      discovered: true,
      server: 'policy',
    })),
  ];

  const mcpConfig = await readJsonFileIfExists(path.join(normalizedWorkspaceRoot, ROOT_MCP_CONFIG));
  const parsed = z.object({
    mcpServers: z.record(z.object({}).passthrough()).default({}),
  }).safeParse(mcpConfig);

  if (parsed.success) {
    for (const serverName of Object.keys(parsed.data.mcpServers)) {
      if (serverName === 'policy') {
        continue;
      }
      tools.push({
        name: `mcp__${serverName}__*`,
        source: 'mcp-pattern',
        category: 'mcp',
        pattern: true,
        discovered: false,
        server: serverName,
        notes: 'Server discovered from .mcp.json; exact tool names not introspected in v1',
      });
    }
  }

  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return listFilesRecursive(absolutePath);
    }
    return [absolutePath];
  }));
  return files.flat();
}

export async function listPolicyTemplates(): Promise<Array<{ path: string; content: string }>> {
  const root = templatesRoot();
  const files = await listFilesRecursive(root);
  const contents = await Promise.all(files.map(async (filePath) => ({
    path: path.relative(root, filePath).replace(/\\/g, '/'),
    content: await fs.readFile(filePath, 'utf8'),
  })));
  return contents.sort((a, b) => a.path.localeCompare(b.path));
}

export async function getPolicyManifestState(manifestPath: string): Promise<{
  manifestPath: string;
  hash: string;
  manifest: EngineManifest;
  warnings: Awaited<ReturnType<typeof validatePolicyManifest>>['warnings'];
  ruleFiles: Array<{ path: string; content: string }>;
}> {
  const loaded = await loadPolicyManifest(manifestPath);
  const validation = await validatePolicyManifest(manifestPath);
  return {
    manifestPath: loaded.manifestPath,
    hash: loaded.hash,
    manifest: loaded.manifest,
    warnings: validation.warnings,
    ruleFiles: [...loaded.ruleContents.entries()].map(([filePath, content]) => ({
      path: filePath,
      content,
    })),
  };
}

function levelWeight(level: z.infer<typeof PolicyRuleLevelSchema>): number {
  if (level === 'enforcement') {
    return 3;
  }
  if (level === 'guardrail') {
    return 2;
  }
  return 1;
}

function decisionWeight(hook: PolicyHook | undefined): number {
  if (hook?.mode !== 'decide' || hook.decision === undefined) {
    return 0;
  }
  if (hook.decision === 'deny' || hook.decision === 'block') {
    return 3;
  }
  if (hook.decision === 'ask' || hook.decision === 'approve') {
    return 2;
  }
  return 1;
}

function hasRestrictedRuleLevel(rule: EngineRule, governance: z.infer<typeof PolicyGovernanceSchema>): boolean {
  return governance.require_approval_for.includes(rule.level);
}

export function classifyPolicyChange(
  previousManifest: EngineManifest | undefined,
  nextManifest: EngineManifest,
): PolicyChangeClassification {
  const oldRules = new Map((previousManifest?.rules ?? []).map((rule) => [rule.id, rule]));
  const newRules = new Map(nextManifest.rules.map((rule) => [rule.id, rule]));
  const oldHooks = new Map((previousManifest?.hooks ?? []).map((hook) => [hook.id, hook]));
  const newHooks = new Map(nextManifest.hooks.map((hook) => [hook.id, hook]));

  const changedRules = new Set<string>();
  const changedHooks = new Set<string>();
  const reasons = new Set<string>();
  let sawTightening = false;
  let sawWeakening = false;
  let approvalRequired = false;

  for (const id of new Set([...oldRules.keys(), ...newRules.keys()])) {
    const before = oldRules.get(id);
    const after = newRules.get(id);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      continue;
    }
    changedRules.add(id);
    if (before === undefined && after !== undefined) {
      sawTightening = sawTightening || levelWeight(after.level) > 1;
      if (hasRestrictedRuleLevel(after, nextManifest.governance)) {
        approvalRequired = true;
        reasons.add(`Rule ${id} introduces ${after.level} policy`);
      }
      continue;
    }
    if (before !== undefined && after === undefined) {
      sawWeakening = true;
      if (hasRestrictedRuleLevel(before, nextManifest.governance)) {
        approvalRequired = true;
        reasons.add(`Rule ${id} removes ${before.level} policy`);
      }
      continue;
    }
    if (before !== undefined && after !== undefined) {
      if (levelWeight(after.level) > levelWeight(before.level)) {
        sawTightening = true;
      }
      if (levelWeight(after.level) < levelWeight(before.level)) {
        sawWeakening = true;
      }
      if (hasRestrictedRuleLevel(before, nextManifest.governance) || hasRestrictedRuleLevel(after, nextManifest.governance)) {
        approvalRequired = true;
        reasons.add(`Rule ${id} updates restricted level policy`);
      }
    }
  }

  for (const id of new Set([...oldHooks.keys(), ...newHooks.keys()])) {
    const before = oldHooks.get(id);
    const after = newHooks.get(id);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      continue;
    }
    changedHooks.add(id);
    const beforeWeight = decisionWeight(before);
    const afterWeight = decisionWeight(after);
    if (afterWeight > beforeWeight) {
      sawTightening = true;
    }
    if (afterWeight < beforeWeight) {
      sawWeakening = true;
    }
    if ((before?.mode === 'decide') || (after?.mode === 'decide')) {
      approvalRequired = true;
      reasons.add(`Hook ${id} changes enforcement behavior`);
    }
  }

  const direction = sawTightening && sawWeakening
    ? 'mixed'
    : sawTightening
      ? 'tightening'
      : sawWeakening
        ? 'weakening'
        : 'neutral';

  return {
    direction,
    approvalRequired,
    changedRules: [...changedRules].sort(),
    changedHooks: [...changedHooks].sort(),
    reasons: [...reasons].sort(),
  };
}

type FileSnapshot = {
  path: string;
  existed: boolean;
  content?: string;
};

async function snapshotFiles(filePaths: string[]): Promise<FileSnapshot[]> {
  return Promise.all(filePaths.map(async (filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return { path: filePath, existed: true, content };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path: filePath, existed: false };
      }
      throw error;
    }
  }));
}

async function restoreSnapshots(snapshots: FileSnapshot[]): Promise<void> {
  await Promise.all(snapshots.map(async (snapshot) => {
    if (snapshot.existed) {
      await fs.mkdir(path.dirname(snapshot.path), { recursive: true });
      await fs.writeFile(snapshot.path, snapshot.content ?? '', 'utf8');
      return;
    }
    await fs.rm(snapshot.path, { force: true });
  }));
}

export async function writePolicyFiles(input: {
  manifestPath: string;
  manifest: EngineManifest;
  ruleFiles?: Array<{ path: string; content: string }>;
  approvalConfirmed?: boolean;
}): Promise<{
  manifestPath: string;
  classification: PolicyChangeClassification;
  validation: Awaited<ReturnType<typeof validatePolicyManifest>>;
  filesTouched: string[];
}> {
  const manifestPath = path.resolve(input.manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const nextManifest = EngineManifestSchema.parse(input.manifest);

  const existing = await readExistingManifest(manifestPath);
  const classification = classifyPolicyChange(existing, nextManifest);
  if (classification.approvalRequired && input.approvalConfirmed !== true) {
    throw new Error(`Policy change requires approval: ${classification.reasons.join('; ')}`);
  }

  const filesToWrite = (input.ruleFiles ?? []).map((file) => ({
    path: path.resolve(manifestDir, file.path),
    content: file.content.endsWith('\n') ? file.content : `${file.content}\n`,
  }));

  const touchedPaths = [manifestPath, ...filesToWrite.map((file) => file.path)];
  const snapshots = await snapshotFiles(touchedPaths);

  try {
    for (const file of filesToWrite) {
      await fs.mkdir(path.dirname(file.path), { recursive: true });
      await fs.writeFile(file.path, file.content, 'utf8');
    }

    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, stringifyYaml(nextManifest), 'utf8');

    const validation = await validatePolicyManifest(manifestPath);
    if (!validation.ok) {
      throw new Error(validation.error ?? 'Policy validation failed');
    }

    return {
      manifestPath,
      classification,
      validation,
      filesTouched: touchedPaths.sort(),
    };
  } catch (error) {
    await restoreSnapshots(snapshots);
    throw error;
  }
}

export function formatPolicyManifest(manifest: EngineManifest): string {
  return stringifyYaml(EngineManifestSchema.parse(manifest));
}

async function readExistingManifest(manifestPath: string): Promise<EngineManifest | undefined> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return EngineManifestSchema.parse(parseYaml(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function createRuleFile(input: {
  manifestPath: string;
  relativePath: string;
  content: string;
  overwrite?: boolean;
  scope?: 'user' | 'project';
}): Promise<{ path: string }> {
  const baseDir = input.scope === 'user'
    ? path.join(os.homedir(), '.claude')
    : workspaceRootFromManifestPath(input.manifestPath);
  const absolutePath = path.resolve(baseDir, input.relativePath);
  try {
    if (input.overwrite !== true) {
      await fs.access(absolutePath);
      throw new Error(`Rule file already exists: ${absolutePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof Error && error.message.startsWith('Rule file already exists')) {
        throw error;
      }
      throw error;
    }
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, input.content.endsWith('\n') ? input.content : `${input.content}\n`, 'utf8');
  return { path: absolutePath };
}

export async function formatPolicyYamlFile(input: {
  manifestPath: string;
  write?: boolean;
}): Promise<{
  manifestPath: string;
  formattedYaml: string;
  validation: Awaited<ReturnType<typeof validatePolicyManifest>>;
}> {
  const manifestPath = path.resolve(input.manifestPath);
  const existing = await readExistingManifest(manifestPath);
  if (existing === undefined) {
    throw new Error(`Policy manifest not found: ${manifestPath}`);
  }

  const formattedYaml = formatPolicyManifest(existing);
  if (input.write === true) {
    await fs.writeFile(manifestPath, formattedYaml, 'utf8');
  }

  const validation = await validatePolicyManifest(manifestPath);
  return {
    manifestPath,
    formattedYaml,
    validation,
  };
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'policy-rule';
}

function defaultHookMatcher(toolName: string): string {
  if (toolName.includes('*')) {
    return '*';
  }
  return toolName;
}

export function proposePolicyRule(input: {
  ruleId?: string;
  level: z.infer<typeof PolicyRuleLevelSchema>;
  description: string;
  toolName: string;
  event?: PolicyHookEvent;
  mode?: PolicyHookMode;
  decision?: PolicyDecision;
  commands?: string[];
  paths?: string[];
  tools?: string[];
  tags?: string[];
  matcher?: string;
  file?: string;
  scope?: 'user' | 'project';
}): ProposedPolicyRule {
  const ruleId = input.ruleId ?? slugify(input.description);
  const event = input.event ?? 'PreToolUse';
  const mode = input.mode ?? 'decide';
  const decision = input.decision ?? (event === 'PreToolUse' ? 'ask' : undefined);
  const defaultFileBase = input.scope === 'user'
    ? path.join(os.homedir(), '.claude', 'policy-rules', `${ruleId}.md`)
    : `./rules/${ruleId}.md`;
  const file = input.file ?? defaultFileBase;
  const tags = input.tags ?? [classifyToolCategory(input.toolName)];

  const rule = EngineRuleSchema.parse({
    id: ruleId,
    level: input.level,
    file,
    tags,
  });

  const hook = PolicyHookSchema.parse({
    id: `${slugify(event)}-${ruleId}`,
    event,
    matcher: input.matcher ?? defaultHookMatcher(input.toolName),
    mode,
    decision,
    use: [rule.id],
    when: {
      commands: input.commands,
      paths: input.paths,
      tools: input.tools ?? [input.toolName],
    },
  });

  return ProposedPolicyRuleSchema.parse({ rule, hook });
}

export async function createScratchWorkspaceFromTemplate(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-template-'));
  const templates = await listPolicyTemplates();
  await Promise.all(templates.map(async (template) => {
    const filePath = path.join(dir, template.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, template.content, 'utf8');
  }));
  return dir;
}
