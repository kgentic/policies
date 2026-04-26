# policy — Claude Code Policy Engine

policy is a Claude Code plugin for YAML-defined governance. It combines:

- Claude hooks for enforcement and audit
- MCP tools for validation, search, explanation, and authoring
- reusable `policies/*.md` files for policy content
- append-only approval memory in `.policy/approvals.jsonl`

---

## When to Use policy

Use `policy` when the user wants any of these:

1. Create or update agent guardrails, rules, or governance
2. Validate a `policy.yaml` or explain why a policy decision occurs
3. Search for relevant policies before acting on a task
4. Add approvals around shell commands, file edits, or MCP tool calls
5. Help author reusable policy/rule files through MCP tools

If a policy file exists in the current project, assume it is part of the active
execution environment and should be respected.

---

## Config Discovery

policy discovers config using a project-style search. Preferred location:

- `.claude/policy.yaml`

Also supported:

- `policy.yaml`
- `policy.yml`
- `.policyrc`
- `.policyrc.yaml`
- `.policyrc.yml`
- `.claude/policy.yml`
- `.claude/policyrc`
- `.claude/policyrc.yaml`
- `.claude/policyrc.yml`
- `.config/policy.yaml`
- `.config/policy.yml`
- `.config/policyrc`
- `.config/policyrc.yaml`
- `.config/policyrc.yml`

In addition, installed packs are discovered by scanning `.claude/policies/*/policy.yaml`.
Each subdirectory under `.claude/policies/` is treated as a separate installed layer
(precedence 10–19), sitting between the user layer (0) and project layer (20).

Rule file paths are resolved relative to the policy file directory.

---

## Skills (User-Facing)

All policy skills use the `/policy-*` namespace and invoke MCP tools directly:

| Skill | MCP Tool(s) | Purpose |
|-------|-------------|---------|
| `/policy-init` | `init_policy` | Scaffold starter policy.yaml |
| `/policy-add` | `add_policy` | Install a policy pack (elicitation) |
| `/policy-remove` | `remove_policy` | Remove installed policies (elicitation) |
| `/policy-author` | `propose_policy` | Author a new rule interactively |
| `/policy-evaluate` | `evaluate_policy` | Test if an action would be blocked |
| `/policy-explain` | `evaluate_policy` (verbose) | Full decision chain explanation |
| `/policy-search` | `search_policies` | Semantic search across rules |
| `/policy-list` | `get_policy_manifest` + `list_policy_assets` | List installed policies |
| `/policy-update` | `update_policies` | Check + update stale packs |

## Recommended MCP Flow

When helping a user author policy, prefer this sequence:

1. `get_policy_manifest` — read current state
2. `propose_policy` — create rule interactively (elicitation)
3. `apply_policy_change` — write changes atomically

Use `evaluate_policy` or `evaluate_policy` with `verbose: true` when debugging
an existing policy set.

Use `search_policies` when the user asks what constraints might apply to a task
before taking action.

Use `init_policy` to scaffold a starter policy.yaml for new projects.

Use `add_policy` / `remove_policy` to manage installed policy packs.

---

## State Model

Keep static config and dynamic state separate:

- `policy.yaml` and `policies/*.md` are static authoring inputs
- `.claude/policies/<id>/policy.yaml` are installed source directories (written by `policy add`)
- `.policy/approvals.jsonl` is dynamic runtime approval state

Governance blocks are stripped from installed layers at load time — only the project
layer may specify governance. Do not write approval or execution state back into YAML.

---

## Hook Response Contract

The runner produces event-specific JSON matching the official Claude Code hook
contract. Key points for agents:

- **PreToolUse**: rule content arrives via `hookSpecificOutput.additionalContext`
  (not top-level `systemMessage`). Follow any instructions in `additionalContext`.
- **PostToolUse**: rule content arrives via `hookSpecificOutput.additionalContext`.
  If `decision` is `"block"`, the `reason` field explains what is required before
  proceeding. `inject` mode uses `additionalContext` only (advisory). `decide`
  mode with deny uses `decision: "block"` (enforcement).
- **Stop/SubagentStop**: `decision: "block"` prevents stopping. Omitting
  `decision` allows the stop.

## Plugin Cache

Claude Code caches plugins by version at
`~/.claude/plugins/cache/<project>/<plugin>/<version>/`.

`CLAUDE_PLUGIN_ROOT` points to the **cache directory**, not the source. To pick
up changes to hooks or scripts: bump the version via changeset, then
`/reload-plugins`.

---

## Anti-Patterns

- Do NOT mutate policy by editing `.policy/approvals.jsonl` manually unless the user explicitly wants raw state surgery
- Do NOT store runtime approvals in `policy.yaml`
- Do NOT bypass `format_policy_yaml` / `validate_policy_pack` after changing manifest structure
- Do NOT invent unsupported hook events — use the documented Claude hook contract only
- Do NOT treat semantic policy search as the enforcement decision engine; search narrows context, deterministic evaluation decides
- Do NOT assume hook enforcement is hard security under `dangerously-skip-permissions`
- Do NOT edit plugin hook scripts and expect changes without a version bump — the plugin cache serves the old version
