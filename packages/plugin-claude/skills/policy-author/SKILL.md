---
name: policy-author
description: "Author a new policy rule with interactive elicitation. Walks through scope, identity, trigger, and action. Usage: /policy-author [rule-id]"
argument-hint: "[rule-id]"
---

# /policy-author — Author a Policy Rule

Create a new policy rule interactively using MCP elicitation. The tool walks through scope, identity, trigger conditions, and action mode — then writes the rule and hook to policy.yaml.

## Steps

### Step 1: Call `propose_policy` MCP tool

Use the `propose_policy` MCP tool. It supports progressive elicitation — any fields you provide are used directly, missing fields are asked interactively.

**If the user provided a rule-id and context:**
```
propose_policy({
  ruleId: "<rule-id>",
  description: "<derived from context>",
  level: "<advisory|guardrail|enforcement>",
  event: "PreToolUse",
  toolMatcher: "<tool-name>",
  scope: "project"
})
```

**If minimal context:**
```
propose_policy({ scope: "project" })
```
The tool elicits all fields: scope, identity (ruleId, description, level), trigger (event, toolMatcher, paths, commands), and action (hookMode, decision).

### Step 2: Present the result

The tool returns the created rule details: ruleId, scope, level, event, toolMatcher, hookMode, and paths to the written files. Present a summary of what was created.

### When to trigger

- User says "create a rule", "add policy rule", "author rule", "make a guardrail", "new policy"
- User wants to define new governance constraints for their project
