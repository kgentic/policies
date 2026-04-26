---
name: policy-remove
description: "Remove an installed policy pack by source ID. Requires confirmation (destructive). Usage: /policy-remove <source-id>"
argument-hint: "<source-id>"
---

# /policy-remove — Remove Installed Policy

Remove an installed policy pack by its source ID. This is a destructive operation — it deletes the policy directory and all its rule files from disk.

## Steps

### Step 1: Call `remove_policy` MCP tool

The tool supports elicitation — if no `sourceId` is provided, it asks for one. It always asks for confirmation before deleting.

**If the user provided a source-id:**
```
remove_policy({ sourceId: "<source-id>", scope: "project" })
```

**If no source-id:**
```
remove_policy({ scope: "project" })
```
The tool will elicit the source ID and confirmation interactively.

Use `scope: "user"` if the user wants to remove from global policy.

### Step 2: Present the result

Show what was removed:
- Source ID
- Directory deleted
- Number of policies and hooks removed

### When to trigger

- User says "remove policy", "uninstall policy", "delete policy pack", "remove rulepack"
- User wants to remove a previously installed policy pack
