#!/usr/bin/env node

import type { ClientName } from './adapters/index.js';

const args = process.argv.slice(2);

// Extract global flags
let client: ClientName = 'claude';
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
      await run(commandArgs, { client });
      break;
    }
    case 'list': {
      const { run } = await import('./commands/list.js');
      await run();
      break;
    }
    case 'remove': {
      const { run } = await import('./commands/remove.js');
      await run(commandArgs, { client });
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
      console.log('');
      console.log('Examples:');
      console.log('  policies add kgentic/policies swe-essentials');
      console.log('  policies list');
      console.log('  policies remove swe-essentials');
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
