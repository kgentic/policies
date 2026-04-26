---
name: policy-add
description: "Install a policy pack into the current project or user scope. Lists available packs if no ID given. Usage: /policy-add [pack-id]"
argument-hint: "[pack-id]"
---

# /policy-add — Install Policy Pack

Install a bundled policy pack into the project or user-scope policy. Packs are pre-authored bundles of policies + hooks that enforce a governance concern (e.g., `swe-essentials`, `security-baseline`).

## Steps

### Step 1: Call `add_policy` MCP tool

Use the `add_policy` MCP tool. It supports elicitation — if no `packId` is provided, it presents a selection list. After selection, it asks for confirmation before installing.

**If the user provided a pack-id argument:**
```
add_policy({ packId: "<pack-id>", scope: "project" })
```

**If no pack-id argument:**
```
add_policy({ scope: "project" })
```
The tool will elicit pack selection and confirmation interactively.

Use `scope: "user"` if the user wants the pack applied globally to all their projects.

### Step 2: Present the result

The tool returns JSON with `ok`, `packId`, scope, and install details. Present a summary:
- Pack name installed
- Scope (project or user)
- Number of policy files and hooks added

### When to trigger

- User says "install rulepack", "add policy pack", "install swe-essentials", "install security-baseline", "add policy"
- User wants to add pre-built governance rules to their project
