---
name: policy-explain
description: "Explain why a policy decision was reached for a given hook event. Shows hook ID, matched files, approval status, and full decision chain. Usage: /policy-explain <event> [--tool <name>]"
argument-hint: "<event> [--tool <name>]"
---

# /policy-explain — Explain a Policy Decision

Explain why a specific action would be allowed, denied, or prompted by the policy engine. Shows the full decision chain including hook ID, matched rule files, and approval status.

## Steps

### Step 1: Parse the user's query

Extract from the user's request:
- **event** — hook event: `PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit`
- **toolName** — which tool (e.g., `Bash`, `Write`, `Edit`)
- **command** — specific command string (e.g., `git push --force`)
- **path** — file path being operated on (e.g., `.env`)

### Step 2: Call `evaluate_policy` with verbose mode

```
evaluate_policy({
  event: "<event>",
  toolName: "<tool>",
  command: "<command>",
  path: "<path>",
  verbose: true
})
```

The `verbose: true` flag returns the full explanation including hook ID, matched files, action hash, and approval details.

### Step 3: Present the explanation

Show the full decision chain:
- **Decision**: allow / deny / ask
- **Hook ID**: which hook matched
- **Matched files**: which rule files contributed to the decision
- **Approval**: whether a prior approval record was reused
- **Explanation**: human-readable reason for the decision

Format: "Hook `{hookId}` matched because {explanation}. Decision: **{decision}**."

### When to trigger

- User asks "why was this blocked", "explain policy", "why can't I...", "what rules apply"
- User wants to understand the full decision chain for a specific action
- Debugging unexpected policy enforcement behavior
