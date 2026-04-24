import deepmerge from 'deepmerge';

import type { ConfigLayer, SuppressedItem, LayerSource } from './engine-schema.js';

// ─── Entity array keys ────────────────────────────────────────────────────────

export const ENTITY_ARRAY_KEYS = ['rules', 'hooks', 'rulepacks'] as const;
export type EntityArrayKey = (typeof ENTITY_ARRAY_KEYS)[number];

// ─── dedupeById ───────────────────────────────────────────────────────────────

/**
 * Merge two arrays by deduplicating on `id`. Source (higher-precedence) wins
 * on collision. Walk order: target items (replaced by source version if
 * collision), then remaining source-only items.
 */
export function dedupeById<T extends { id: string }>(target: T[], source: T[]): T[] {
  const sourceMap = new Map(source.map(item => [item.id, item]));
  const seen = new Set<string>();
  const result: T[] = [];

  // Walk target: use source version when IDs collide (source wins).
  for (const item of target) {
    const sourceItem = sourceMap.get(item.id);
    if (sourceItem !== undefined) {
      result.push(sourceItem);
    } else {
      result.push(item);
    }
    seen.add(item.id);
  }

  // Append source items not already seen (new items from higher-precedence layer).
  for (const item of source) {
    if (!seen.has(item.id)) {
      result.push(item);
    }
  }

  return result;
}

// ─── replaceArray ─────────────────────────────────────────────────────────────

/**
 * Higher-precedence array replaces lower entirely when non-empty.
 * Returns a shallow copy to avoid mutating either input.
 */
export function replaceArray<T>(target: T[], source: T[]): T[] {
  return source.length > 0 ? [...source] : [...target];
}

// ─── filterDisabled ───────────────────────────────────────────────────────────

export interface FilterResult {
  filtered: Record<string, unknown>;
  suppressedItems: SuppressedItem[];
}

/**
 * Walk every entity array in `merged`, strip items with `enabled === false`,
 * and record them in the `suppressedItems` side-channel.
 */
export function filterDisabled(
  merged: Record<string, unknown>,
  originalLayers: ConfigLayer[],
): FilterResult {
  const suppressedItems: SuppressedItem[] = [];
  const filtered = { ...merged };

  for (const key of ENTITY_ARRAY_KEYS) {
    const arr = filtered[key];
    if (!Array.isArray(arr)) continue;

    const enabledItems: Array<{ id: string; enabled?: boolean }> = [];
    for (const item of arr as Array<{ id: string; enabled?: boolean }>) {
      if (item.enabled === false) {
        const originLayer = findOriginalSource(item.id, key, originalLayers);
        suppressedItems.push({
          id: item.id,
          source: originLayer,
          type: key === 'rulepacks' ? 'rulepack' : key === 'rules' ? 'rule' : 'hook',
        });
      } else {
        enabledItems.push(item);
      }
    }
    filtered[key] = enabledItems;
  }

  return { filtered, suppressedItems };
}

function findOriginalSource(
  id: string,
  key: string,
  layers: ConfigLayer[],
): LayerSource {
  // Walk layers from lowest precedence to highest.
  // The "original source" is the layer that first declared this ID as enabled.
  for (const layer of layers) {
    const arr = (layer.manifest as Record<string, unknown>)[key];
    if (Array.isArray(arr)) {
      const found = (arr as Array<{ id: string; enabled?: boolean }>).find(
        item => item.id === id && item.enabled !== false,
      );
      if (found !== undefined) return layer.source;
    }
  }
  // Fallback: not found enabled in any layer — return the highest-precedence layer source.
  const last = layers[layers.length - 1];
  return last !== undefined ? last.source : 'project';
}

// ─── policyMergeOptions ───────────────────────────────────────────────────────

/**
 * deepmerge options with key-path discrimination.
 *
 * deepmerge v4 `customMerge(key)` returns either:
 *   - a merge function `(target, source, options) => result` for that key, or
 *   - `undefined` to fall back to deepmerge's default behaviour.
 *
 * Entity arrays (`rules`, `hooks`, `rulepacks`) use dedupeById so that
 * higher-precedence layer items win on ID collision.
 *
 * All other arrays fall back to `replaceArray` via the top-level `arrayMerge`.
 */
export const policyMergeOptions: deepmerge.Options = {
  customMerge: (key: string) => {
    if ((ENTITY_ARRAY_KEYS as readonly string[]).includes(key)) {
      return (target: unknown, source: unknown) =>
        dedupeById(
          target as Array<{ id: string }>,
          source as Array<{ id: string }>,
        );
    }
    // Non-entity keys: use default deepmerge behaviour (objects recursed,
    // plain arrays handled by the top-level arrayMerge below).
    return undefined;
  },
  arrayMerge: replaceArray,
};

// ─── mergeManifests ───────────────────────────────────────────────────────────

/**
 * Convenience wrapper: apply deepmerge with policyMergeOptions.
 * `base` has lower precedence; `override` wins on conflict.
 */
export function mergeManifests(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  return deepmerge(base, override, policyMergeOptions);
}
