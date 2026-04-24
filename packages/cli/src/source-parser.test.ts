import { describe, it, expect } from 'vitest';
import { parseSource } from './source-parser.js';

describe('parseSource', () => {
  it('returns type github with ref=main for plain owner/repo', () => {
    const result = parseSource('owner/repo');
    expect(result.type).toBe('github');
    if (result.type !== 'github') return;
    expect(result.source).toBe('owner/repo');
    expect(result.ref).toBe('main');
  });

  it('parses ref from owner/repo#ref syntax', () => {
    const result = parseSource('owner/repo#v1.0');
    expect(result.type).toBe('github');
    if (result.type !== 'github') return;
    expect(result.source).toBe('owner/repo');
    expect(result.ref).toBe('v1.0');
  });

  it('handles branch refs with slashes', () => {
    const result = parseSource('owner/repo#feature/branch');
    expect(result.type).toBe('github');
    if (result.type !== 'github') return;
    expect(result.source).toBe('owner/repo');
    expect(result.ref).toBe('feature/branch');
  });

  it('handles sha refs', () => {
    const result = parseSource('kgentic/policies#abc1234');
    expect(result.type).toBe('github');
    if (result.type !== 'github') return;
    expect(result.source).toBe('kgentic/policies');
    expect(result.ref).toBe('abc1234');
  });

  it('uses first hash only — rest goes into ref', () => {
    const result = parseSource('owner/repo#release#candidate');
    if (result.type !== 'github') return;
    expect(result.source).toBe('owner/repo');
    expect(result.ref).toBe('release#candidate');
  });

  it('detects absolute path as local source', () => {
    const result = parseSource('/Users/dev/policies');
    expect(result.type).toBe('local');
    if (result.type === 'local') {
      expect(result.path).toBe('/Users/dev/policies');
    }
  });

  it('detects relative path with ./ as local source', () => {
    const result = parseSource('./my-policies');
    expect(result.type).toBe('local');
    if (result.type === 'local') {
      expect(result.path).toBe('./my-policies');
    }
  });

  it('detects parent path with ../ as local source', () => {
    const result = parseSource('../policies');
    expect(result.type).toBe('local');
    if (result.type === 'local') {
      expect(result.path).toBe('../policies');
    }
  });

  it('detects home dir path with ~ as local source', () => {
    const result = parseSource('~/projects/policies');
    expect(result.type).toBe('local');
    if (result.type === 'local') {
      expect(result.path).toBe('~/projects/policies');
    }
  });
});
