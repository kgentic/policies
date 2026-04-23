#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'add':
    console.log('TODO: add policy', args.join(' '));
    break;
  case 'list':
    console.log('TODO: list policies');
    break;
  case 'remove':
    console.log('TODO: remove policy', args.join(' '));
    break;
  default:
    console.log('Usage: policies <add|list|remove> [args]');
    break;
}
