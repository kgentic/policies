---
name: policy-update
description: "Check for and apply updates to installed policy packs. Compares installed vs bundled versions. Usage: /policy-update [--dry-run]"
argument-hint: "[--dry-run]"
---

# /policy-update — Update Installed Packs

Check for stale installed packs and update them to the latest bundled version.

## Steps

### Step 1: Check for updates (dry run)

First, show what would be updated:

```
update_policies({ scope: "project", dryRun: true })
```

### Step 2: Present stale packs

If stale packs found, show each one:
- Pack ID
- Installed version vs bundled version

If no stale packs: "All packs are up to date."

### Step 3: Apply updates (if user confirms)

```
update_policies({ scope: "project", dryRun: false })
```

Present the update results: which packs were updated, any errors.

### When to trigger

- User says "update policies", "check for policy updates", "update packs", "refresh policies"
- User wants to ensure installed packs match the latest bundled versions
