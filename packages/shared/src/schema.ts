import { z } from 'zod';

// v1 format: rules with path + description
export const policyRuleSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  path: z.string(),
});

// v2 format: policies with file, level, tags, hooks
export const policyV2Schema = z.object({
  id: z.string(),
  file: z.string(),
  level: z.string().optional(),
  tags: z.array(z.string()).optional(),
  hooks: z.array(z.record(z.unknown())).optional(),
});

export const policyAdapterSchema = z.object({
  claude: z.record(z.unknown()).optional(),
  cursor: z.record(z.unknown()).optional(),
  windsurf: z.record(z.unknown()).optional(),
});

// Accept both v1 (rules) and v2 (policies) pack manifests, normalize to common shape
const rawManifestSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  rules: z.array(policyRuleSchema).optional(),
  policies: z.array(policyV2Schema).optional(),
  adapters: policyAdapterSchema.optional(),
}).refine(
  (data) => data.rules !== undefined || data.policies !== undefined,
  { message: 'Manifest must have either "rules" (v1) or "policies" (v2) array' },
);

/** Normalize v2 policies → v1-compatible rules shape so downstream code works unchanged */
export const policyManifestSchema = rawManifestSchema.transform((data) => {
  const rules: Array<{ id: string; description?: string; path: string }> =
    data.rules ?? (data.policies ?? []).map((p) => ({
      id: p.id,
      path: p.file,
    }));
  return {
    name: data.id ?? data.name,
    version: data.version,
    description: data.description,
    tags: data.tags,
    rules,
    adapters: data.adapters,
  };
});

export const installedRuleSchema = z.object({
  id: z.string(),
  path: z.string(),
  installedTo: z.string(),
});

export const installedPolicySchema = z.object({
  name: z.string(),
  version: z.string(),
  source: z.string(),
  installedAt: z.string(),
  client: z.string(),
  rules: z.array(installedRuleSchema),
});

export const policyLockfileSchema = z.object({
  version: z.literal(1),
  policies: z.array(installedPolicySchema),
});

export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicyAdapter = z.infer<typeof policyAdapterSchema>;
export type PolicyManifest = z.infer<typeof policyManifestSchema>;
export type InstalledRule = z.infer<typeof installedRuleSchema>;
export type InstalledPolicy = z.infer<typeof installedPolicySchema>;
export type PolicyLockfile = z.infer<typeof policyLockfileSchema>;
