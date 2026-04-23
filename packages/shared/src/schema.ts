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
  rules: z.array(policyRuleSchema),
  adapters: policyAdapterSchema.optional(),
});

export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicyAdapter = z.infer<typeof policyAdapterSchema>;
export type PolicyManifest = z.infer<typeof policyManifestSchema>;
