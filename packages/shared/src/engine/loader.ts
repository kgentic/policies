import { createHash } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { PolicyHook, EngineManifest, EngineRule, EngineRulepack, ConfigLayer, LayerSource, SuppressedItem } from './engine-schema.js';
import { EngineManifestSchema } from './engine-schema.js';
import { discoverConfigLayers } from './config-discovery.js';
import { loadConfigLayer, mergeLayers } from './layer-loader.js';

export interface LoadedPolicyAsset {
  id: string;
  kind: 'rule' | 'rulepack';
  files: string[];
  tags: string[];
}

export interface LoadedPolicyManifest {
  manifestPath: string;
  manifest: EngineManifest;
  hash: string;
  assets: Map<string, LoadedPolicyAsset>;
  ruleContents: Map<string, string>;
}

export interface ResolvedManifest extends LoadedPolicyManifest {
  layers: ConfigLayer[];
  effectiveSource: Map<string, LayerSource>;
  suppressedItems: SuppressedItem[];
}

export interface PolicyValidationWarning {
  code: string;
  message: string;
}

export interface PolicyValidationResult {
  ok: boolean;
  manifestPath: string;
  hash?: string;
  warnings: PolicyValidationWarning[];
  manifest?: EngineManifest;
  error?: string;
}

function resolveAssetFiles(manifestDir: string, files: string[]): string[] {
  return files.map((file) => path.resolve(manifestDir, file));
}

function toAssetFromRulepack(manifestDir: string, rulepack: EngineRulepack): LoadedPolicyAsset {
  return {
    id: rulepack.id,
    kind: 'rulepack',
    files: resolveAssetFiles(manifestDir, rulepack.files),
    tags: rulepack.tags,
  };
}

function toAssetFromRule(manifestDir: string, rule: EngineRule): LoadedPolicyAsset {
  return {
    id: rule.id,
    kind: 'rule',
    files: resolveAssetFiles(manifestDir, [rule.file]),
    tags: rule.tags,
  };
}

function ensureUniqueIds(manifest: EngineManifest): void {
  const seen = new Set<string>();
  for (const id of [
    ...manifest.rulepacks.map((rulepack) => rulepack.id),
    ...manifest.rules.map((rule) => rule.id),
  ]) {
    if (seen.has(id)) {
      throw new Error(`Duplicate policy asset id: ${id}`);
    }
    seen.add(id);
  }
}

function buildAssets(manifestDir: string, manifest: EngineManifest): Map<string, LoadedPolicyAsset> {
  const assets = new Map<string, LoadedPolicyAsset>();
  for (const rulepack of manifest.rulepacks) {
    assets.set(rulepack.id, toAssetFromRulepack(manifestDir, rulepack));
  }
  for (const rule of manifest.rules) {
    assets.set(rule.id, toAssetFromRule(manifestDir, rule));
  }
  return assets;
}

async function collectReferencedRuleFiles(
  manifest: EngineManifest,
  assets: Map<string, LoadedPolicyAsset>,
): Promise<string[]> {
  const files = new Set<string>();
  for (const hook of manifest.hooks) {
    for (const assetId of hook.use) {
      const asset = assets.get(assetId);
      if (asset === undefined) {
        throw new Error(`Hook ${hook.id} references unknown asset: ${assetId}`);
      }
      for (const file of asset.files) {
        files.add(file);
      }
    }
  }
  return [...files].sort();
}

function hashStrings(chunks: string[]): string {
  const hash = createHash('sha256');
  for (const chunk of chunks) {
    hash.update(chunk);
    hash.update('\n');
  }
  return hash.digest('hex');
}

// Tools that receive only a command input (no file path)
const COMMAND_ONLY_TOOLS = new Set(['Bash']);
// Tools that receive only a file path input (no command)
const PATH_ONLY_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function checkUnreachableWhen(
  hookId: string,
  matcher: string,
  when: { commands?: string[]; paths?: string[] },
): PolicyValidationWarning | null {
  const parts = matcher.split('|').map((p) => p.trim());
  const hasCommands = (when.commands?.length ?? 0) > 0;
  const hasPaths = (when.paths?.length ?? 0) > 0;

  if (hasCommands && parts.length > 0 && parts.every((p) => PATH_ONLY_TOOLS.has(p))) {
    return {
      code: 'UNREACHABLE_WHEN',
      message: `Hook ${hookId}: matcher '${matcher}' does not receive commands — this condition will never match.`,
    };
  }

  if (hasPaths && parts.length > 0 && parts.every((p) => COMMAND_ONLY_TOOLS.has(p))) {
    return {
      code: 'UNREACHABLE_WHEN',
      message: `Hook ${hookId}: matcher '${matcher}' does not receive paths — this condition will never match.`,
    };
  }

  return null;
}

function collectWarnings(manifest: EngineManifest, assets: Map<string, LoadedPolicyAsset>): PolicyValidationWarning[] {
  const warnings: PolicyValidationWarning[] = [];
  const seenPreToolPatterns = new Set<string>();
  const seenHookIds = new Set<string>();

  for (const hook of manifest.hooks) {
    // DUPLICATE_HOOK_ID: detect hooks sharing the same id
    if (seenHookIds.has(hook.id)) {
      warnings.push({
        code: 'DUPLICATE_HOOK_ID',
        message: `Duplicate hook id: ${hook.id}`,
      });
    } else {
      seenHookIds.add(hook.id);
    }

    for (const assetId of hook.use) {
      if (!assets.has(assetId)) {
        warnings.push({
          code: 'UNKNOWN_ASSET',
          message: `Hook ${hook.id} references unknown asset ${assetId}`,
        });
      }
    }

    // AND_VS_OR_COMPOSITION: both commands and paths set — AND'd so hook can never fire
    const hasCommands = (hook.when.commands?.length ?? 0) > 0;
    const hasPaths = (hook.when.paths?.length ?? 0) > 0;
    if (hasCommands && hasPaths) {
      warnings.push({
        code: 'AND_VS_OR_COMPOSITION',
        message: `Hook ${hook.id} has both when.commands and when.paths — these are AND'd, so the hook can never match (a tool invocation has either a command or a path, not both). Split into separate hooks.`,
      });
    }

    // UNREACHABLE_WHEN: matcher contradicts the when field
    const unreachable = checkUnreachableWhen(hook.id, hook.matcher, hook.when);
    if (unreachable !== null) {
      warnings.push(unreachable);
    }

    if (hook.event === 'PreToolUse') {
      const key = JSON.stringify({
        matcher: hook.matcher,
        commands: hook.when.commands ?? [],
        paths: hook.when.paths ?? [],
        tools: hook.when.tools ?? [],
      });
      if (seenPreToolPatterns.has(key)) {
        warnings.push({
          code: 'POTENTIALLY_UNREACHABLE_HOOK',
          message: `Hook ${hook.id} may be unreachable because an earlier PreToolUse hook covers the same match space`,
        });
      } else {
        seenPreToolPatterns.add(key);
      }
    }
  }

  return warnings;
}

function buildEffectiveSource(layers: ConfigLayer[], manifest: EngineManifest): Map<string, LayerSource> {
  const effectiveSource = new Map<string, LayerSource>();

  // For each rule/hook/rulepack in the merged manifest, determine which layer it came from.
  // Walk layers from lowest precedence to highest — last one with this ID wins.
  for (const rule of manifest.rules) {
    for (const layer of layers) {
      const layerRules = layer.manifest.rules;
      if (layerRules?.some(r => r.id === rule.id)) {
        effectiveSource.set(rule.id, layer.source);
      }
    }
  }
  for (const hook of manifest.hooks) {
    for (const layer of layers) {
      const layerHooks = layer.manifest.hooks;
      if (layerHooks?.some(h => h.id === hook.id)) {
        effectiveSource.set(hook.id, layer.source);
      }
    }
  }
  for (const rulepack of manifest.rulepacks) {
    for (const layer of layers) {
      const layerPacks = layer.manifest.rulepacks;
      if (layerPacks?.some(p => p.id === rulepack.id)) {
        effectiveSource.set(rulepack.id, layer.source);
      }
    }
  }

  return effectiveSource;
}

function identifyLikelySource(layers: ConfigLayer[], _mergeError: unknown): string {
  const candidates: string[] = [];
  for (const layer of layers) {
    try {
      EngineManifestSchema.parse(layer.manifest);
    } catch {
      candidates.push(`${layer.source} layer (${layer.sourcePath})`);
    }
  }
  if (candidates.length === 0) {
    return 'Likely caused by an incompatibility between layers rather than a single malformed layer.';
  }
  return `Likely source: ${candidates.join(', ')}.`;
}

export async function loadPolicyManifestFromPath(manifestPath: string): Promise<ResolvedManifest> {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(resolvedManifestPath);
  const rawManifest = await fs.readFile(resolvedManifestPath, 'utf8');
  const parsedYaml = parseYaml(rawManifest) as unknown;
  const manifest = EngineManifestSchema.parse(parsedYaml);

  ensureUniqueIds(manifest);
  const assets = buildAssets(manifestDir, manifest);
  const referencedRuleFiles = await collectReferencedRuleFiles(manifest, assets);

  const ruleContents = new Map<string, string>();
  for (const file of referencedRuleFiles) {
    const content = await fs.readFile(file, 'utf8');
    ruleContents.set(file, content);
  }

  const hash = hashStrings([rawManifest, ...referencedRuleFiles.map((file) => ruleContents.get(file) ?? '')]);

  const singleLayer: ConfigLayer = {
    source: 'project',
    sourcePath: resolvedManifestPath,
    precedence: 1,
    mergeMode: 'defaults',
    manifest: manifest as Partial<EngineManifest>,
    hash: hashStrings([rawManifest]),
  };

  const effectiveSource = new Map<string, LayerSource>();
  for (const rule of manifest.rules) effectiveSource.set(rule.id, 'project');
  for (const hook of manifest.hooks) effectiveSource.set(hook.id, 'project');
  for (const rulepack of manifest.rulepacks) effectiveSource.set(rulepack.id, 'project');

  return {
    manifestPath: resolvedManifestPath,
    manifest,
    hash,
    assets,
    ruleContents,
    layers: [singleLayer],
    effectiveSource,
    suppressedItems: [],
  };
}

export async function loadPolicyManifestFromDir(input: { startDir: string }): Promise<ResolvedManifest> {
  const layerPaths = await discoverConfigLayers(input.startDir);

  if (layerPaths.length === 0) {
    throw new Error(
      `No policy manifest found. Searched from: ${input.startDir}. ` +
      `Create a .claude/policy.yaml to get started.`,
    );
  }

  // If only one layer, use the direct path loader (preserves exact existing behavior)
  if (layerPaths.length === 1) {
    const singleLayer = layerPaths[0];
    if (!singleLayer) {
      throw new Error('Expected at least one layer path');
    }
    return loadPolicyManifestFromPath(singleLayer.path);
  }

  // Multi-layer: load all layers, merge, validate
  const layers: ConfigLayer[] = [];
  for (const layerPath of layerPaths) {
    const layer = await loadConfigLayer(
      layerPath.path,
      layerPath.source,
      layerPath.precedence,
      layerPath.mergeMode,
    );
    layers.push(layer);
  }

  // Merge layers per 5-step invariant
  const { merged, suppressedItems } = mergeLayers(layers);

  // Full validation on merged result (Step 5 of invariant)
  let manifest: EngineManifest;
  try {
    manifest = EngineManifestSchema.parse(merged);
  } catch (error) {
    // Bisect: identify which layer likely caused the failure
    const diagnosis = identifyLikelySource(layers, error);
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Merged policy manifest failed validation. ${diagnosis} Original error: ${msg}`,
    );
  }

  // Use project layer dir for asset resolution (or user layer if no project)
  const projectLayer = layers.find(l => l.source === 'project');
  const lastLayer = layers[layers.length - 1];
  const primaryLayer = projectLayer ?? lastLayer;
  if (!primaryLayer) {
    throw new Error('No layers available for asset resolution');
  }
  const manifestDir = path.dirname(primaryLayer.sourcePath);
  const manifestPath = primaryLayer.sourcePath;

  ensureUniqueIds(manifest);
  const assets = buildAssets(manifestDir, manifest);
  const referencedRuleFiles = await collectReferencedRuleFiles(manifest, assets);

  const ruleContents = new Map<string, string>();
  for (const file of referencedRuleFiles) {
    const content = await fs.readFile(file, 'utf8');
    ruleContents.set(file, content);
  }

  const hash = hashStrings([
    ...layers.map(l => l.hash),
    ...referencedRuleFiles.map((file) => ruleContents.get(file) ?? ''),
  ]);

  const effectiveSource = buildEffectiveSource(layers, manifest);

  return {
    manifestPath,
    manifest,
    hash,
    assets,
    ruleContents,
    layers,
    effectiveSource,
    suppressedItems,
  };
}

/**
 * @deprecated Use loadPolicyManifestFromPath (direct) or loadPolicyManifestFromDir (discovery).
 * Preserved for backward compatibility until callers are updated.
 */
export async function loadPolicyManifest(manifestPath: string): Promise<ResolvedManifest> {
  return loadPolicyManifestFromPath(manifestPath);
}

export async function validatePolicyManifest(manifestPath: string): Promise<PolicyValidationResult> {
  const resolvedManifestPath = path.resolve(manifestPath);
  try {
    const loaded = await loadPolicyManifestFromPath(resolvedManifestPath);
    return {
      ok: true,
      manifestPath: loaded.manifestPath,
      hash: loaded.hash,
      warnings: collectWarnings(loaded.manifest, loaded.assets),
      manifest: loaded.manifest,
    };
  } catch (error) {
    return {
      ok: false,
      manifestPath: resolvedManifestPath,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getAssetFilesForHook(
  hook: PolicyHook,
  assets: Map<string, LoadedPolicyAsset>,
): string[] {
  const files = new Set<string>();
  for (const assetId of hook.use) {
    const asset = assets.get(assetId);
    if (asset === undefined) {
      continue;
    }
    for (const file of asset.files) {
      files.add(file);
    }
  }
  return [...files];
}
