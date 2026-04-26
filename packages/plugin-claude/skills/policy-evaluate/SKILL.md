---
name: policy-evaluate
description: "Evaluate whether a policy would block, allow, or ask about a specific action. Core diagnostic tool. Usage: /policy-evaluate <event> [--tool <name>] [--command <cmd>]"
argument-hint: "<event> [--tool <name>] [--command <cmd>]"
---

# /policy-evaluate — Evaluate a Policy Decision

Test what a policy would decide for a specific action without actually performing it. Core diagnostic tool for understanding policy behavior.

## Steps

### Step 1: Parse the user's query

Extract from the user's request:
- **event** — hook event: `PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit`
- **toolName** — which tool (e.g., `Bash`, `Write`, `Edit`)
- **command** — specific command string (e.g., `git push --force`)
- **path** — file path being operated on (e.g., `.env`)

### Step 2: Call `evaluate_policy` MCP tool

```
evaluate_policy({
  event: "<event>",
  toolName: "<tool>",
  command: "<command>",
  path: "<path>",
  verbose: false
})
```

### Step 3: Present the result

Show the evaluation result:
- **Decision**: allow / deny / ask
- **Matched**: whether any hook fired
- **Hook ID**: which hook matched (if any)

For more detail, suggest the user try `/policy-explain` which uses verbose mode.

### When to trigger

- User asks "would this be blocked", "test policy", "evaluate policy", "what would happen if"
- User wants to check if an action would be governed before performing it
- Debugging policy behavior for a specific action
