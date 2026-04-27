# @kgentic-ai/policies

Policy engine for AI coding agents. Define rules in YAML, enforce via hooks, manage with CLI or MCP tools. Like ESLint for AI behavior.

## What It Does

Policies are YAML-defined rules that govern what an AI coding agent can and can't do. They fire on specific events (before a tool runs, when a session starts, before the agent stops) and either:

- **Inject** advisory guidance into the agent's context
- **Decide** whether to allow, deny, or ask about an action
- **Audit** actions for logging without blocking

Rules are markdown files — the engine evaluates when to fire them, the markdown content tells the agent what to do.

## Quick Start — Claude Code Plugin

### 1. Install the plugin

Add the `kgentic-policies` marketplace to Claude Code, then install the `policy` plugin via `/plugin`.

### 2. Initialize a policy manifest

```
/policy-init
```

Creates `.claude/policy.yaml` with default governance settings.

### 3. Install a policy pack

```
/policy-add
```

Lists available packs. Select one to install. Or install directly:

```
/policy-add code-review
```

### 4. Verify

```
/policy-list
```

Shows installed rules, hooks, and file paths.

## Quick Start — CLI

```bash
# Install a policy pack from GitHub
npx @kgentic-ai/policies add kgentic/policies swe-essentials

# List installed policies
npx @kgentic-ai/policies list

# Remove a policy
npx @kgentic-ai/policies remove swe-essentials
```

The CLI installs rule files into your AI tool's config directory (e.g., `.claude/rules/<pack>/` for Claude Code).

## Available Policy Packs

### code-review

Context-aware review guidance injected before every code edit. Uses FTS retrieve to surface only the most relevant sections based on the file being edited.

**Sections:** naming · error handling · security · testing · API contracts · data & storage · dependencies · performance · complexity

**Hook:** `PreToolUse` on `Edit|Write|MultiEdit` with `retrieve: { enabled: true, top_k: 3 }`

### swe-essentials

Core software engineering principles for AI-assisted development.

**Rules:** design · code-discipline · testing · error-handling · security

### security-baseline

Security fundamentals — injection prevention, secrets handling, auth patterns, dependency hygiene.

**Rules:** injection-prevention · secrets-detection · auth-checks · error-exposure · dependency-hygiene

## How Hooks Work

```yaml
# .claude/policy.yaml
version: 1
rules:
  - id: no-force-push
    level: enforcement
    file: ./rules/no-force-push.md
hooks:
  - id: block-force-push
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: deny
    use: [no-force-push]
    when:
      commands: ["git push --force*", "git push -f*"]
```

When the agent tries `git push --force`, the hook fires, matches the command pattern, and returns a `deny` decision with the rule content as the reason.

### Hook Events

| Event | When it fires |
|-------|--------------|
| `PreToolUse` | Before a tool runs (Edit, Bash, Write, etc.) |
| `PostToolUse` | After a tool completes |
| `Stop` | Before the agent finishes |
| `SubagentStop` | Before a subagent finishes |
| `SessionStart` | When a session begins |
| `SessionEnd` | When a session ends |
| `UserPromptSubmit` | When the user sends a message |
| `PreCompact` | Before context compaction |
| `Notification` | On notification events |

### Hook Modes

| Mode | Behavior |
|------|----------|
| `inject` | Inject rule content as advisory context — agent sees it but isn't blocked |
| `decide` | Make an enforcement decision: `allow`, `deny`, `ask`, or `block` |
| `audit` | Log the action without blocking or injecting |

### Filtering with `when`

```yaml
when:
  tools: ["Bash", "Edit"]              # which tools trigger this hook
  commands: ["rm -rf*", "drop table*"] # shell command patterns (glob)
  paths: ["src/auth/**", ".env*"]      # file path patterns (glob)
```

All conditions are AND'd. Omitted conditions match everything.

### Smart Retrieve

For large rule files, enable FTS retrieve to inject only the most relevant sections:

```yaml
retrieve:
  enabled: true
  strategy: fts
  top_k: 3
```

The engine tokenizes the evaluation context (tool name, file path, command) and scores each section in the rule markdown. Only the top-k highest-scoring sections are injected — not the entire file.

## Governance

Control which rule levels the AI agent can modify without human approval:

```yaml
governance:
  allow_llm_updates: [advisory]           # agent can change advisory rules
  require_approval_for: [guardrail, enforcement]  # these need human approval
  approval_ttl_minutes: 30                # approvals expire after 30 min
```

## Layer Precedence

Policies merge from multiple sources with clear precedence:

1. **User layer** (`~/.claude/policy.yaml`) — baseline defaults
2. **Installed layers** (`.claude/policies/*/policy.yaml`) — pack-specific rules
3. **Project layer** (`.claude/policy.yaml`) — project-specific overrides (wins)

Higher precedence layers override lower ones when rules or hooks share the same ID.

## Plugin Skills

| Skill | Purpose |
|-------|---------|
| `/policy-init` | Scaffold starter policy.yaml |
| `/policy-add` | Install a policy pack |
| `/policy-remove` | Remove an installed pack |
| `/policy-author` | Author a new rule interactively |
| `/policy-evaluate` | Test if an action would be blocked |
| `/policy-explain` | Full decision chain explanation |
| `/policy-search` | Search rules by keyword |
| `/policy-list` | List installed policies |
| `/policy-update` | Check for pack updates |

## MCP Tools

The plugin exposes MCP tools for programmatic access:

| Tool | Purpose |
|------|---------|
| `get_policy_manifest` | Read current policy state |
| `evaluate_policy` | Evaluate a hook decision |
| `apply_policy_change` | Write policy.yaml atomically |
| `create_policy_rule` | Create a rule with elicitation |
| `install_rulepack` | Install a bundled pack |
| `update_rulepacks` | Check for stale packs |

## Creating Your Own Pack

A pack is a directory with `policy.yaml` + markdown rule files:

```
my-pack/
├── policy.yaml
└── review-rules.md
```

### policy.yaml

```yaml
version: 1
rules:
  - id: review-rules
    level: advisory
    file: ./review-rules.md
hooks:
  - id: review-on-edit
    event: PreToolUse
    matcher: "Edit|Write|MultiEdit"
    mode: inject
    use: [review-rules]
    when:
      tools: ["Edit", "Write", "MultiEdit"]
    retrieve:
      enabled: true
      strategy: fts
      top_k: 3
```

### Rule files

Markdown with `## Headings` and `- bullet` rules. When retrieve is enabled, FTS scores individual sections against the evaluation context.

```markdown
## Security
- Never log secrets, tokens, or PII
- Parameterised queries only

## Testing
- Every conditional branch must have test coverage
- Assertions must fail when behaviour is wrong
```

## Packages

| Package | Description |
|---------|-------------|
| `@kgentic-ai/policies` | CLI — add/list/remove policies |
| `@kgentic-ai/policies-shared` | Shared evaluator engine and schemas |
| `@kgentic-ai/policies-plugin-claude` | Claude Code plugin — hooks + MCP tools |
| `@kgentic-ai/policies-mcp` | Standalone MCP server |

## Development

```bash
pnpm install
pnpm build
pnpm test          # 216 tests across 4 packages
pnpm typecheck
pnpm lint
```

## License

MIT
