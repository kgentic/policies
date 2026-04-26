---
name: policy-list
description: "List installed policies grouped by source, with hook counts and file paths. Usage: /policy-list"
argument-hint: ""
---

# /policy-list — List Installed Policies

Show all installed policies grouped by source (project, user, installed packs), with hook counts and file paths.

## Steps

### Step 1: Gather policy state

Call both MCP tools to get the full picture:

```
get_policy_manifest()
list_policy_assets()
```

### Step 2: Present the results

Combine the manifest and assets data into a readable overview:

**Manifest summary:**
- Version
- Governance settings (allow_llm_updates, require_approval_for, approval_ttl)

**Policies by source:**
For each policy, show:
- ID, level (advisory/guardrail/enforcement), enabled status
- Rule file path
- Tags
- Associated hooks (from the manifest's hooks array, matched by `use` field)

**Assets:**
For each asset, show:
- ID, kind, tags, referenced files

### When to trigger

- User asks "list policies", "show policies", "what policies are installed", "policy status"
- User wants an overview of all governance rules in their project
