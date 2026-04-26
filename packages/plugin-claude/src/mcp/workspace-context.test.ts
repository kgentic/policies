import { describe, it, expect, vi } from 'vitest';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WorkspaceContext } from './workspace-context.js';

describe('WorkspaceContext', () => {
  it('stores the fallback root supplied at construction', () => {
    const ctx = new WorkspaceContext('/fallback/dir');
    expect(ctx.workspaceRoot).toBe('/fallback/dir');
  });

  it('resolveFromMcpRoots updates root from a valid file:// URI', async () => {
    const ctx = new WorkspaceContext('/fallback/dir');

    const mockServer = {
      listRoots: vi.fn().mockResolvedValue({
        roots: [{ uri: 'file:///Users/foo/project', name: 'project' }],
      }),
    } as unknown as Server;

    await ctx.resolveFromMcpRoots(mockServer);
    expect(ctx.workspaceRoot).toBe('/Users/foo/project');
  });

  it('keeps fallback when server throws (client does not support listRoots)', async () => {
    const ctx = new WorkspaceContext('/fallback/dir');

    const mockServer = {
      listRoots: vi.fn().mockRejectedValue(new Error('not supported')),
    } as unknown as Server;

    await ctx.resolveFromMcpRoots(mockServer);
    expect(ctx.workspaceRoot).toBe('/fallback/dir');
  });

  it('keeps fallback when server returns an empty roots array', async () => {
    const ctx = new WorkspaceContext('/fallback/dir');

    const mockServer = {
      listRoots: vi.fn().mockResolvedValue({ roots: [] }),
    } as unknown as Server;

    await ctx.resolveFromMcpRoots(mockServer);
    expect(ctx.workspaceRoot).toBe('/fallback/dir');
  });

  it('keeps fallback when URI does not start with file://', async () => {
    const ctx = new WorkspaceContext('/fallback/dir');

    const mockServer = {
      listRoots: vi.fn().mockResolvedValue({
        roots: [{ uri: 'http://example.com/project' }],
      }),
    } as unknown as Server;

    await ctx.resolveFromMcpRoots(mockServer);
    expect(ctx.workspaceRoot).toBe('/fallback/dir');
  });

  it('decodes percent-encoded characters in file:// URI path', async () => {
    const ctx = new WorkspaceContext('/fallback/dir');

    // URI with a space encoded as %20
    const mockServer = {
      listRoots: vi.fn().mockResolvedValue({
        roots: [{ uri: 'file:///Users/foo/my%20project' }],
      }),
    } as unknown as Server;

    await ctx.resolveFromMcpRoots(mockServer);
    expect(ctx.workspaceRoot).toBe('/Users/foo/my project');
  });
});
