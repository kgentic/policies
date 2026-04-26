#!/usr/bin/env node

/**
 * Syncs plugin versions from package.json → plugin.json + marketplace.json.
 *
 * Run after `pnpm changeset version` to keep all version sources in sync.
 * Usage: node scripts/sync-plugin-versions.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const PLUGINS = [
  { name: 'policy', pkgDir: 'packages/plugin-claude' },
];

const MARKETPLACE_PATH = join(ROOT, 'marketplace.json');

let changed = false;

for (const plugin of PLUGINS) {
  const pkgPath = join(ROOT, plugin.pkgDir, 'package.json');
  const pluginJsonPath = join(ROOT, plugin.pkgDir, '.claude-plugin', 'plugin.json');

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));

  if (pkg.version !== pluginJson.version) {
    console.log(`${plugin.name}: plugin.json ${pluginJson.version} → ${pkg.version}`);
    pluginJson.version = pkg.version;
    writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2) + '\n');
    changed = true;
  }
}

// Sync marketplace.json plugin entries
const marketplace = JSON.parse(readFileSync(MARKETPLACE_PATH, 'utf-8'));

for (const plugin of PLUGINS) {
  const pkgPath = join(ROOT, plugin.pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  const entry = marketplace.plugins.find((p) => p.name === plugin.name);
  if (entry && entry.version !== pkg.version) {
    console.log(`marketplace.json[${plugin.name}]: ${entry.version} → ${pkg.version}`);
    entry.version = pkg.version;
    changed = true;
  }
}

if (changed) {
  writeFileSync(MARKETPLACE_PATH, JSON.stringify(marketplace, null, 2) + '\n');
  console.log('Done — versions synced.');
} else {
  console.log('All versions already in sync.');
}
