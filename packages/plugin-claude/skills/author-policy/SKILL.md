# /author-policy — Create or Extend a Policy

Guided policy authoring workflow. Creates `policy.yaml` manifests and rule `.md` files using the policy MCP tools.

## Triggers

Use when the user says: "create a policy", "add a rule", "author policy", "new policy pack", "add guardrail", "write a policy rule", "enforce X", "block X", "require approval for X", or `/author-policy`.

## Workflow

### Step 1: Understand Intent

Ask the user what behavior they want to govern. Examples:
- "Block force pushes to main"
- "Require approval before deleting files"
- "Inject security guidelines on every session"

If the user gives a vague request, ask: **"What specific action should be controlled, and should it be blocked, require approval, or just advise?"**

### Step 2: Check Existing State

```
get_policy_manifest       → Is there already a policy.yaml?
list_governable_tools     → What tools/events can be governed?
search_policies           → Any existing rules that overlap?
```

If a policy exists, we're **extending** it. If not, we're **creating** from scratch.

### Step 3: Propose the Rule

```
propose_policy_rule(
  ruleId: "<kebab-case-id>",
  description: "<what the rule does>",
  level: "advisory" | "guardrail" | "enforcement",
  hookEvent: "PreToolUse" | "PostToolUse" | "Stop" | ...,
  matcher: "<tool name or *>",
  mode: "inject" | "decide" | "audit",
  decision: "allow" | "deny" | "ask",
  whenCommands: ["<glob patterns>"],
  whenPaths: ["<glob patterns>"],
  whenTools: ["<tool names>"]
)
```

Present the proposal to the user. Explain:
- **Level**: advisory (suggestion) → guardrail (approval required) → enforcement (hard block)
- **Mode**: inject (add context) → decide (allow/deny/ask) → audit (log only)
- **Decision**: what happens when the rule triggers

### Step 4: Create Rule Content

```
create_rule_file(
  ruleId: "<id>",
  content: "<markdown rule content>"
)
```

Rule content is markdown that gets injected into the agent's context. Write it as clear behavioral instructions:

```markdown
# No Force Push

Never use `git push --force`. Use `--force-with-lease` as a safer alternative.

If force push is truly needed, ask the user to run it manually.
```

### Step 5: Apply to Manifest

```
apply_policy_change(
  rules: [{ id, level, file }],
  hooks: [{ id, event, matcher, mode, decision, use, when }]
)
```

### Step 6: Validate

```
validate_policy_pack      → Confirm manifest + files are valid
format_policy_yaml        → Normalize YAML formatting
```

### Step 7: Summary

Report what was created:
```
✓ Created rule: no-force-push (enforcement)
  File: rules/no-force-push.md
  Hook: PreToolUse on Bash — blocks `git push --force`
  
  To test: try running `git push --force` in Claude Code
```

## Rules

- ALWAYS use `propose_policy_rule` before `apply_policy_change` — show the user what will be created
- ALWAYS validate after applying changes
- Use `search_policies` to avoid duplicate rules
- Prefer `guardrail` level (approval-based) over `enforcement` (hard block) unless the user explicitly wants blocking
- Rule file content should be concise, actionable instructions — not essays
- One rule per concern — don't bundle unrelated behaviors

## Examples

**User**: "Block any rm -rf commands"
```
propose_policy_rule(
  ruleId: "no-recursive-delete",
  level: "enforcement",
  hookEvent: "PreToolUse",
  matcher: "Bash",
  mode: "decide",
  decision: "deny",
  whenCommands: ["rm -rf *", "rm -r *"]
)
```

**User**: "Remind about testing before commits"
```
propose_policy_rule(
  ruleId: "test-before-commit",
  level: "advisory",
  hookEvent: "PreToolUse",
  matcher: "Bash",
  mode: "inject",
  whenCommands: ["git commit *"]
)
```

**User**: "Require approval before modifying package.json"
```
propose_policy_rule(
  ruleId: "protect-package-json",
  level: "guardrail",
  hookEvent: "PreToolUse",
  matcher: "Write",
  mode: "decide",
  decision: "ask",
  whenPaths: ["package.json", "*/package.json"]
)
```
