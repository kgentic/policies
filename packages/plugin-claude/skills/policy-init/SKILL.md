---
name: policy-init
description: "Scaffold a starter policy.yaml in .claude/ using the default template. Usage: /policy-init"
argument-hint: ""
---

# /policy-init — Initialize Policy

Scaffold a starter policy.yaml file using the bundled default template. Creates `.claude/policy.yaml` if it doesn't already exist.

## Steps

### Step 1: Call `init_policy` MCP tool

```
init_policy({})
```

The tool:
1. Checks if a policy manifest already exists (returns error if so)
2. Loads the default policy.yaml template from bundled templates
3. Creates `.claude/policy.yaml` with the template content

### Step 2: Present the result

- **Success**: "Created policy manifest at {path}. Edit it to add rules and hooks, or use `/policy-author` to create rules interactively."
- **Already exists**: "Policy manifest already exists at {path}. Use `/policy-list` to see current policies."

### When to trigger

- User says "init policy", "setup policy", "create policy", "initialize policy", "start with policy"
- User wants to set up policy governance for the first time in their project
- No policy.yaml exists yet and user wants to create one
