import { describe, it, expect } from 'vitest';
import { parseSource } from './source-parser.js';

describe('parseSource', () => {
  it('returns type github with ref=main for plain owner/repo', () => {
    const result = parseSource('owner/repo');
    expect(result.type).toBe('github');
    expect(result.source).toBe('owner/repo');
    expect(result.ref).toBe('main');
  });

  it('parses ref from owner/repo#ref syntax', () => {
    const result = parseSource('owner/repo#v1.0');
    expect(result.type).toBe('github');
    expect(result.source).toBe('owner/repo');
    expect(result.ref).toBe('v1.0');
  });

  it('handles branch refs with slashes', () => {
    const result = parseSource('owner/repo#feature/branch');
    expect(result.type).toBe('github');
    expect(result.source).toBe('owner/repo');
    expect(result.ref).toBe('feature/branch');
  });

  it('handles sha refs', () => {
    const result = parseSource('kgentic/policies#abc1234');
    expect(result.type).toBe('github');
    expect(result.source).toBe('kgentic/policies');
    expect(result.ref).toBe('abc1234');
  });

  it('uses first hash only — rest goes into ref', () => {
    // e.g. owner/repo#release#candidate — unlikely but safe
    const result = parseSource('owner/repo#release#candidate');
    expect(result.source).toBe('owner/repo');
    expect(result.ref).toBe('release#candidate');
  });
});
