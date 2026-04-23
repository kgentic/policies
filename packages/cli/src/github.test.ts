import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildRawUrl, fetchPolicyManifest, fetchPolicy } from './github.js';

const validManifestYaml = `
name: swe-essentials
version: 1.0.0
description: Core software engineering rules
rules:
  - id: no-console
    path: rules/no-console.md
  - id: strict-types
    path: rules/strict-types.md
`;

function makeResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildRawUrl', () => {
  it('produces correct URL with default ref=main', () => {
    const url = buildRawUrl('owner/repo', 'swe-essentials', 'policy.yaml');
    expect(url).toBe(
      'https://raw.githubusercontent.com/owner/repo/main/policies/swe-essentials/policy.yaml',
    );
  });

  it('produces correct URL with custom ref', () => {
    const url = buildRawUrl('owner/repo', 'swe-essentials', 'policy.yaml', 'v2.0.0');
    expect(url).toBe(
      'https://raw.githubusercontent.com/owner/repo/v2.0.0/policies/swe-essentials/policy.yaml',
    );
  });

  it('handles nested file paths', () => {
    const url = buildRawUrl('owner/repo', 'my-policy', 'rules/strict-types.md');
    expect(url).toBe(
      'https://raw.githubusercontent.com/owner/repo/main/policies/my-policy/rules/strict-types.md',
    );
  });
});

describe('fetchPolicyManifest', () => {
  it('parses valid YAML response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(validManifestYaml));
    vi.stubGlobal('fetch', mockFetch);

    const manifest = await fetchPolicyManifest('owner/repo', 'swe-essentials');

    expect(manifest.name).toBe('swe-essentials');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.description).toBe('Core software engineering rules');
    expect(manifest.rules).toHaveLength(2);
    expect(manifest.rules[0]).toEqual({ id: 'no-console', path: 'rules/no-console.md' });
    expect(manifest.rules[1]).toEqual({ id: 'strict-types', path: 'rules/strict-types.md' });
  });

  it('calls the correct URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(validManifestYaml));
    vi.stubGlobal('fetch', mockFetch);

    await fetchPolicyManifest('myorg/policies', 'swe-essentials', 'v1.2.3');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/myorg/policies/v1.2.3/policies/swe-essentials/policy.yaml',
    );
  });

  it('throws on 404 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse('Not Found', 404));
    vi.stubGlobal('fetch', mockFetch);

    await expect(fetchPolicyManifest('owner/repo', 'missing-policy')).rejects.toThrow(
      'Failed to fetch policy manifest: 404 Not Found',
    );
  });

  it('throws on invalid YAML that fails schema validation', async () => {
    const invalidYaml = `
name: bad-policy
version: 1.0.0
rules: not-an-array
`;
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(invalidYaml));
    vi.stubGlobal('fetch', mockFetch);

    await expect(fetchPolicyManifest('owner/repo', 'bad-policy')).rejects.toThrow();
  });

  it('throws on YAML missing required fields', async () => {
    const incompleteYaml = `
description: missing name and version
rules: []
`;
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(incompleteYaml));
    vi.stubGlobal('fetch', mockFetch);

    await expect(fetchPolicyManifest('owner/repo', 'incomplete')).rejects.toThrow();
  });
});

describe('fetchPolicy', () => {
  it('fetches manifest and all referenced rule files', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).endsWith('policy.yaml')) {
        return Promise.resolve(makeResponse(validManifestYaml));
      }
      if ((url as string).endsWith('no-console.md')) {
        return Promise.resolve(makeResponse('# No Console\nDo not use console.log'));
      }
      if ((url as string).endsWith('strict-types.md')) {
        return Promise.resolve(makeResponse('# Strict Types\nNo any type'));
      }
      return Promise.resolve(makeResponse('', 404));
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPolicy('owner/repo', 'swe-essentials');

    expect(result.manifest.name).toBe('swe-essentials');
    expect(result.files.size).toBe(2);
    expect(result.files.get('rules/no-console.md')).toBe('# No Console\nDo not use console.log');
    expect(result.files.get('rules/strict-types.md')).toBe('# Strict Types\nNo any type');
  });

  it('fetches manifest and rule files concurrently', async () => {
    const callOrder: string[] = [];
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callOrder.push(url as string);
      if ((url as string).endsWith('policy.yaml')) {
        return Promise.resolve(makeResponse(validManifestYaml));
      }
      return Promise.resolve(makeResponse(`content for ${url}`));
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchPolicy('owner/repo', 'swe-essentials');

    // Manifest must be first, then rule files (order among rule files is concurrent)
    expect(callOrder[0]).toContain('policy.yaml');
    // Both rule files are fetched (total 3 calls: 1 manifest + 2 rules)
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('propagates errors when a rule file fetch fails', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).endsWith('policy.yaml')) {
        return Promise.resolve(makeResponse(validManifestYaml));
      }
      return Promise.resolve(makeResponse('', 404));
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(fetchPolicy('owner/repo', 'swe-essentials')).rejects.toThrow(
      'Failed to fetch rule file: 404 Not Found',
    );
  });

  it('returns empty files map when manifest has no rules', async () => {
    const emptyManifestYaml = `
name: empty-policy
version: 0.1.0
rules: []
`;
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(emptyManifestYaml));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPolicy('owner/repo', 'empty-policy');

    expect(result.manifest.name).toBe('empty-policy');
    expect(result.files.size).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
