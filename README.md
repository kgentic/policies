# @kgentic-ai/policies

Policy registry and enforcement engine for AI coding agents. Install curated rule packs into Claude Code, Cursor, Windsurf, or any AI coding tool — like ESLint for AI behavior.

## Quick Start

```bash
# Install a policy pack from a GitHub repo
npx @kgentic-ai/policies add kgentic/policies swe-essentials

# Install from a local directory
npx @kgentic-ai/policies add ./path/to/repo swe-essentials

# List installed policies
npx @kgentic-ai/policies list

# Remove a policy
npx @kgentic-ai/policies remove swe-essentials
```

## How It Works

Policies are collections of rule files (markdown) that get installed into your AI coding tool's configuration directory. For Claude Code, rules go into `.claude/rules/<policy-name>/`.

```
your-project/
├── .claude/
│   └── rules/
│       └── swe-essentials/       ← installed by policies CLI
│           ├── design.md
│           ├── code-discipline.md
│           ├── testing.md
│           ├── error-handling.md
│           └── security.md
└── policies.lock.json            ← tracks what's installed
```

## CLI Reference

```
Usage: policies <command> [options]

Commands:
  add <source> <policy-name>   Install a policy
  list                         List installed policies
  remove <policy-name>         Remove an installed policy

Options:
  --client <name>              Target client (claude|cursor|windsurf, default: claude)
  --ref <ref>                  Git ref (branch/tag/sha, overrides #ref in source)
  --global, -g                 Install to global scope (~/.config/kgentic/)
```

### Sources

The `<source>` argument supports:

| Format | Example | Description |
|--------|---------|-------------|
| `owner/repo` | `kgentic/policies` | GitHub repo (fetches from `main`) |
| `owner/repo#ref` | `kgentic/policies#v1.0` | GitHub repo at specific ref |
| `/path/to/dir` | `/Users/dev/policies` | Local absolute path |
| `./relative/path` | `./my-policies` | Local relative path |

### Scopes

- **Project** (default): installs to `.claude/rules/` in the current directory, lockfile at `./policies.lock.json`
- **Global** (`-g`): installs to `~/.claude/rules/` (user-wide), lockfile at `~/.config/kgentic/policies.lock.json`

## Available Policy Packs

### swe-essentials

Core software engineering principles — design, discipline, testing, error handling, security.

```bash
npx @kgentic-ai/policies add kgentic/policies swe-essentials
```

**Rules:** `design` · `code-discipline` · `testing` · `error-handling` · `security`

### security-baseline

Security fundamentals for AI-assisted development.

```bash
npx @kgentic-ai/policies add kgentic/policies security-baseline
```

**Rules:** `input-validation` · `auth-patterns` · `secrets-handling` · `dependency-security` · `owasp-awareness`

## Creating Your Own Policy Pack

A policy pack is a directory with a `policy.yaml` manifest and rule files:

```
my-policies/
└── policies/
    └── my-pack/
        ├── policy.yaml
        ├── rule-one.md
        └── rule-two.md
```

### policy.yaml

```yaml
name: my-pack
version: 1.0.0
description: My custom policy pack
tags: [custom]
rules:
  - id: rule-one
    path: rule-one.md
    description: First rule
  - id: rule-two
    path: rule-two.md
    description: Second rule
```

### Rule files

Rule files are markdown. Their content is injected into the AI agent's context as behavioral guidelines.

```markdown
# No Force Push

Never use `git push --force`. Use `--force-with-lease` as a safer alternative.

If force push is truly needed, ask the user to run it manually.
```

### Publishing

Host your policy pack in any GitHub repo. Users install with:

```bash
npx @kgentic-ai/policies add your-org/your-repo your-pack-name
```

The CLI fetches `policy.yaml` and rule files from `policies/<pack-name>/` in the repo root.

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@kgentic-ai/policies` | [![npm](https://img.shields.io/npm/v/@kgentic-ai/policies)](https://npmjs.com/package/@kgentic-ai/policies) | CLI — add/list/remove policies |
| `@kgentic-ai/policies-shared` | [![npm](https://img.shields.io/npm/v/@kgentic-ai/policies-shared)](https://npmjs.com/package/@kgentic-ai/policies-shared) | Shared evaluator engine and schemas |
| `@kgentic-ai/policies-plugin-claude` | [![npm](https://img.shields.io/npm/v/@kgentic-ai/policies-plugin-claude)](https://npmjs.com/package/@kgentic-ai/policies-plugin-claude) | Claude Code plugin — hook enforcement |
| `@kgentic-ai/policies-mcp` | [![npm](https://img.shields.io/npm/v/@kgentic-ai/policies-mcp)](https://npmjs.com/package/@kgentic-ai/policies-mcp) | MCP server for policy tools |

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────┐
│  CLI        │     │  Shared Engine   │     │  Plugin       │
│  add/list/  │────▶│  Evaluator       │◀────│  Claude Code  │
│  remove     │     │  Schema/Types    │     │  Cursor       │
│             │     │  Config Loader   │     │  Windsurf     │
└─────────────┘     └──────────────────┘     └───────────────┘
       │                                            │
       ▼                                            ▼
  policies.lock.json                     .claude/rules/<pack>/
  (tracks installed)                     (rule files injected)
```

The evaluator engine is **client-agnostic** — it takes hook events + rules and returns enforcement decisions. Thin client plugins translate client-specific events (e.g., Claude's `PreToolUse`) into the shared evaluator format.

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (203 tests across 4 packages)
pnpm test

# Typecheck
pnpm typecheck

# Lint
pnpm lint

# Run CLI in dev mode (no build required)
cd packages/cli && npx tsx src/index.ts add ./../../ swe-essentials
```

## License

MIT
