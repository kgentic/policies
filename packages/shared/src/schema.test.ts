import { describe, it, expect } from 'vitest';
import { policyManifestSchema, policyLockfileSchema, installedPolicySchema } from './schema.js';

describe('policyManifestSchema', () => {
  it('accepts a valid manifest with tags', () => {
    const result = policyManifestSchema.safeParse({
      name: 'my-policy',
      version: '1.0.0',
      tags: ['security', 'typescript'],
      rules: [{ id: 'rule-1', path: 'rules/rule-1.md' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['security', 'typescript']);
    }
  });

  it('accepts a valid manifest without tags', () => {
    const result = policyManifestSchema.safeParse({
      name: 'my-policy',
      version: '1.0.0',
      rules: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a manifest missing name', () => {
    const result = policyManifestSchema.safeParse({
      version: '1.0.0',
      rules: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a manifest missing version', () => {
    const result = policyManifestSchema.safeParse({
      name: 'my-policy',
      rules: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('policyLockfileSchema', () => {
  it('accepts a valid lockfile', () => {
    const result = policyLockfileSchema.safeParse({
      version: 1,
      policies: [
        {
          name: 'my-policy',
          version: '1.0.0',
          source: 'github:org/repo',
          installedAt: '2026-04-23T00:00:00.000Z',
          client: 'claude',
          rules: [
            { id: 'rule-1', path: 'rules/rule-1.md', installedTo: '.claude/rules/rule-1.md' },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a lockfile with wrong version number', () => {
    const result = policyLockfileSchema.safeParse({
      version: 2,
      policies: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a lockfile with empty policies array', () => {
    const result = policyLockfileSchema.safeParse({
      version: 1,
      policies: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('installedPolicySchema', () => {
  it('accepts a valid installed policy entry', () => {
    const result = installedPolicySchema.safeParse({
      name: 'security-baseline',
      version: '2.1.0',
      source: 'github:kgentic/policies',
      installedAt: '2026-04-23T12:00:00.000Z',
      client: 'cursor',
      rules: [
        { id: 'no-secrets', path: 'rules/no-secrets.md', installedTo: '.cursor/rules/no-secrets.md' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('security-baseline');
      expect(result.data.rules).toHaveLength(1);
    }
  });

  it('rejects an entry missing required fields', () => {
    const result = installedPolicySchema.safeParse({
      name: 'security-baseline',
      version: '2.1.0',
    });
    expect(result.success).toBe(false);
  });
});
