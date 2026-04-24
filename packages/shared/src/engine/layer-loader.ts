import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { ConfigLayer, LayerSource, MergeMode, SuppressedItem } from './engine-schema.js';
import { PartialEngineManifestSchema } from './engine-schema.js';
import type { PartialEngineManifest } from './engine-schema.js';
import { mergeManifests, filterDisabled } from './layer-merge.js';

// ─── MergeResult ─────────────────────────────────────────────────────────────

export interface MergeResult {
  merged: Record<string, unknown>;
  suppressedItems: SuppressedItem[];
}

// ─── loadConfigLayer ──────────────────────────────────────────────────────────

/**
 * Load a single YAML config file as a ConfigLayer.
 * Applies partial validation: top-level fields are optional, but individual
 * elements (rules, hooks, rulepacks) are fully validated if present.
 */
export async function loadConfigLayer(
  filePath: string,
  source: LayerSource,
  precedence: number,
  mergeMode: MergeMode,
): Promise<ConfigLayer> {
  const rawYaml = await fs.readFile(filePath, 'utf8');
  const parsed = parseYaml(rawYaml) as unknown;

  let manifest: PartialEngineManifest;
  try {
    manifest = PartialEngineManifestSchema.parse(parsed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Policy config at ${filePath} (${source} layer) is invalid: ${msg}. Fix or remove this file to proceed.`,
    );
  }

  const hash = createHash('sha256').update(rawYaml).digest('hex');

  return {
    source,
    sourcePath: filePath,
    precedence,
    mergeMode,
    // PartialEngineManifest has governance fields all-optional (via .partial()),
    // while Partial<EngineManifest>['governance'] keeps inner fields required.
    // The value is structurally compatible at runtime; cast is necessary here.
    manifest: manifest as ConfigLayer['manifest'],
    hash,
  };
}

// ─── assertEnforcedLayerIntegrity ─────────────────────────────────────────────

/**
 * Stub guard for enforced layer validation. Throws immediately if any layer
 * has mergeMode 'enforced' — not supported in v1.
 */
function assertEnforcedLayerIntegrity(
  enforcedLayer: ConfigLayer,
  _mergedManifest: Record<string, unknown>,
  _allLayers: ConfigLayer[],
): void {
  throw new Error(
    `Enforced layer validation not yet implemented. ` +
    `Layer: ${enforcedLayer.sourcePath} (${enforcedLayer.source}). ` +
    `No layer should have mergeMode 'enforced' in v1.`,
  );
}

// ─── mergeLayers ──────────────────────────────────────────────────────────────

/**
 * Merge an array of ConfigLayers into a single MergeResult following the
 * 5-step invariant:
 *   1. Sort by precedence ascending
 *   2-3. deepmerge left-to-right (higher precedence wins)
 *   3.5. Assert no enforced layers exist (v1 stub)
 *   4. Filter enabled: false → collect suppressedItems
 */
export function mergeLayers(layers: ConfigLayer[]): MergeResult {
  if (layers.length === 0) {
    return { merged: {}, suppressedItems: [] };
  }

  if (layers.length === 1) {
    // Safe: length guard above guarantees index 0 exists.
    const layer = layers[0] as ConfigLayer;
    const { filtered, suppressedItems } = filterDisabled(
      layer.manifest as Record<string, unknown>,
      layers,
    );
    return { merged: filtered, suppressedItems };
  }

  // Step 1: Sort by precedence ascending (lower number = lower precedence)
  const sorted = [...layers].sort((a, b) => a.precedence - b.precedence);

  // Steps 2-3: deepmerge left-to-right; higher-precedence layer (rightmost) wins
  // Safe: sorted derives from layers which has length >= 2 at this point.
  let merged: Record<string, unknown> = (sorted[0] as ConfigLayer).manifest as Record<string, unknown>;
  for (let i = 1; i < sorted.length; i++) {
    merged = mergeManifests(merged, (sorted[i] as ConfigLayer).manifest as Record<string, unknown>);
  }

  // Step 3.5: Enforce that no layer uses mergeMode 'enforced' (v1 not supported)
  const enforcedLayers = sorted.filter(l => l.mergeMode === 'enforced');
  for (const enforcedLayer of enforcedLayers) {
    assertEnforcedLayerIntegrity(enforcedLayer, merged, sorted);
  }

  // Step 4: Filter disabled items and collect suppressedItems side-channel
  const { filtered, suppressedItems } = filterDisabled(merged, sorted);

  return { merged: filtered, suppressedItems };
}
