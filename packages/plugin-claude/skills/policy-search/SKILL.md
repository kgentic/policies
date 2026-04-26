---
name: policy-search
description: "Search policy rule files for relevant governance guidance before taking action. Usage: /policy-search <query>"
argument-hint: "<query>"
---

# /policy-search — Search Policy Rules

Search policy rule files for relevant constraints before taking an action. Use this proactively to check what governance applies to a task.

## Steps

### Step 1: Call `search_policies` MCP tool

```
search_policies({
  query: "<user's search query>",
  topK: 3
})
```

Adjust `topK` if the user wants more or fewer results.

### Step 2: Present the results

The tool returns an array of results, each with:
- Rule ID and file path
- Relevance score
- Content snippet

Present the most relevant rules with their descriptions and key constraints.

### Step 3: Follow the guidance

If matched rules contain actionable constraints:
- **Advisory rules** — mention the guidance but proceed
- **Guardrail rules** — warn the user and ask for confirmation
- **Enforcement rules** — do not proceed without explicit approval

### When to trigger

- User asks "what policies apply", "search rules", "are there constraints on..."
- Before taking an action that might be governed by policy
- When the user wants to understand what rules exist in their project
