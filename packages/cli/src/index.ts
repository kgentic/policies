#!/usr/bin/env node

import type { ClientName } from './adapters/index.js';

const args = process.argv.slice(2);

// Extract global flags
let client: ClientName = 'claude';
let ref: string | undefined;
let scope: 'global' | 'project' = 'project';
const filteredArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? '';
  if (arg === '--client') {
    const next = args[i + 1];
    if (next === 'claude' || next === 'cursor' || next === 'windsurf') {
      client = next;
      i++; // skip next arg
    } else {
      console.error(`Unknown client: ${String(next)}. Supported: claude, cursor, windsurf`);
      process.exit(1);
    }
  } else if (arg === '--ref') {
    const next = args[i + 1];
    if (next !== undefined && next !== '') {
      ref = next;
      i++; // skip next arg
    } else {
      console.error('--ref requires a value, e.g. --ref v1.0');
      process.exit(1);
    }
  } else if (arg === '--global' || arg === '-g') {
    scope = 'global';
  } else if (arg !== '') {
    filteredArgs.push(arg);
  }
}

const command = filteredArgs[0];
const commandArgs = filteredArgs.slice(1);

async function main(): Promise<void> {
  switch (command) {
    case 'add': {
      const { run } = await import('./commands/add.js');
      await run(commandArgs, { client, ref, scope });
      break;
    }
    case 'list': {
      const { run } = await import('./commands/list.js');
      // --global shows only global, --project shows only project, default shows both
      const listScope =
        scope === 'global' ? 'global' : filteredArgs.includes('--project') ? 'project' : 'both';
      await run({ scope: listScope });
      break;
    }
    case 'remove': {
      const { run } = await import('./commands/remove.js');
      await run(commandArgs, { client, scope });
      break;
    }
    case '--help':
    case '-h':
    case undefined:
      console.log('Usage: policies <command> [options]');
      console.log('');
      console.log('Commands:');
      console.log('  add <source> <policy-name>   Install a policy from a GitHub repo');
      console.log('  list                         List installed policies');
      console.log('  remove <policy-name>         Remove an installed policy');
      console.log('');
      console.log('Options:');
      console.log('  --client <name>              Target client (claude|cursor|windsurf, default: claude)');
      console.log('  --ref <ref>                  Git ref to fetch (branch/tag/sha, overrides #ref in source)');
      console.log('  --global, -g                 Use global scope (~/.config/kgentic/policies.lock.json)');
      console.log('');
      console.log('Examples:');
      console.log('  policies add kgentic/policies swe-essentials');
      console.log('  policies add kgentic/policies#v1.0 swe-essentials');
      console.log('  policies add kgentic/policies swe-essentials --ref v1.0');
      console.log('  policies add --global kgentic/policies swe-essentials');
      console.log('  policies list');
      console.log('  policies list --global');
      console.log('  policies remove swe-essentials');
      console.log('  policies remove --global swe-essentials');
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "policies --help" for usage.');
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
