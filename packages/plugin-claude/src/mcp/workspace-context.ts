import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export class WorkspaceContext {
  private root: string;

  constructor(fallback: string) {
    this.root = fallback;
  }

  get workspaceRoot(): string {
    return this.root;
  }

  async resolveFromMcpRoots(server: Server): Promise<void> {
    try {
      // Short timeout: Claude Code advertises roots capability but doesn't
      // implement roots/list (anthropics/claude-code#3315). Without a timeout
      // the call hangs ~5 s before the SDK's default timeout fires.
      const { roots } = await server.listRoots(undefined, {
        signal: AbortSignal.timeout(1000),
      });
      const first = roots[0];
      if (first !== undefined && first.uri.startsWith('file://')) {
        this.root = decodeURIComponent(new URL(first.uri).pathname);
      }
    } catch {
      // Client doesn't support listRoots or timed out — keep fallback
    }
  }
}
