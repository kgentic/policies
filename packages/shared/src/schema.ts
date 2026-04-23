import { z } from 'zod';

export const policyRuleSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  path: z.string(),
});

export const policyAdapterSchema = z.object({
  claude: z.record(z.unknown()).optional(),
  cursor: z.record(z.unknown()).optional(),
  windsurf: z.record(z.unknown()).optional(),
});

export const policyManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  rules: z.array(policyRuleSchema),
  adapters: policyAdapterSchema.optional(),
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
