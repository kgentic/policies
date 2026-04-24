import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { startHttpBridge } from './http-bridge.js';
import type { HttpBridge } from './http-bridge.js';

const tempDirs: string[] = [];
const bridges: HttpBridge[] = [];

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-bridge-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  }

  return dir;
}

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((b) => b.close().catch(() => undefined)));
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** Minimal HTTP GET/POST helper — avoids external deps. */
function httpRequest(options: {
  port: number;
  method: string;
  path: string;
  body?: unknown;
}): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const bodyText = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyText !== undefined ? { 'Content-Length': Buffer.byteLength(bodyText) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ statusCode: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (bodyText !== undefined) {
      req.write(bodyText);
    }
    req.end();
  });
}

describe('startHttpBridge', () => {
  it('starts an HTTP server and writes the port file', async () => {
    const workspace = await makeWorkspace({});
    const bridge = await startHttpBridge({ workspaceRoot: workspace });
    bridges.push(bridge);

    expect(bridge.port).toBeGreaterThan(0);

    const portFileContent = await fs.readFile(
      path.join(workspace, '.policy', '.port'),
      'utf8',
    );
    expect(portFileContent).toBe(String(bridge.port));
  });

  it('/health returns 200 with ok:true when no manifest exists', async () => {
    const workspace = await makeWorkspace({});
    const bridge = await startHttpBridge({ workspaceRoot: workspace });
    bridges.push(bridge);

    const res = await httpRequest({ port: bridge.port, method: 'GET', path: '/health' });

    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it('/health returns manifest hash when a valid manifest exists', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1\nrules: []\nhooks: []\n`,
    });
    const bridge = await startHttpBridge({ workspaceRoot: workspace });
    bridges.push(bridge);

    const res = await httpRequest({ port: bridge.port, method: 'GET', path: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.body as { ok: boolean; hash: string; cached: boolean };
    expect(body.ok).toBe(true);
    expect(typeof body.hash).toBe('string');
    expect(body.hash.length).toBeGreaterThan(0);
    expect(body.cached).toBe(true);
  });

  it('/evaluate fails open when no policy.yaml exists', async () => {
    const workspace = await makeWorkspace({});
    const bridge = await startHttpBridge({ workspaceRoot: workspace });
    bridges.push(bridge);

    const res = await httpRequest({
      port: bridge.port,
      method: 'POST',
      path: '/evaluate',
      body: {
        mode: 'pre-tool',
        payload: {
          cwd: workspace,
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'git status' },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.body as { hookSpecificOutput: { permissionDecision: string } };
    expect(body.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('/evaluate returns the same decision as runHook for a matching policy', async () => {
    const workspace = await makeWorkspace({
      'policy.yaml': `version: 1
rules:
  - id: protect-main
    level: enforcement
    file: ./rules/protect-main.md
hooks:
  - id: pretool-git
    event: PreToolUse
    matcher: Bash
    mode: decide
    decision: ask
    use: [protect-main]
    when:
      commands: ["git push *"]
`,
      'rules/protect-main.md': 'Do not push directly to main.\n',
    });
    const bridge = await startHttpBridge({ workspaceRoot: workspace });
    bridges.push(bridge);

    const res = await httpRequest({
      port: bridge.port,
      method: 'POST',
      path: '/evaluate',
      body: {
        mode: 'pre-tool',
        payload: {
          cwd: workspace,
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'git push origin main' },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.body as { hookSpecificOutput: { permissionDecision: string; additionalContext?: string } };
    expect(body.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(body.hookSpecificOutput.additionalContext).toContain('Do not push directly to main.');
  });

  it('/evaluate returns 400 for malformed JSON body', async () => {
    const workspace = await makeWorkspace({});
    const bridge = await startHttpBridge({ workspaceRoot: workspace });
    bridges.push(bridge);

    const res = await new Promise<{ statusCode: number; body: unknown }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: bridge.port,
          path: '/evaluate',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (httpRes) => {
          const chunks: Buffer[] = [];
          httpRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          httpRes.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({ statusCode: httpRes.statusCode ?? 0, body: JSON.parse(raw) as unknown });
          });
        },
      );
      req.on('error', reject);
      req.write('not-valid-json{{{');
      req.end();
    });

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('Invalid JSON');
  });

  it('/evaluate returns 400 when mode field is missing', async () => {
    const workspace = await makeWorkspace({});
    const bridge = await startHttpBridge({ workspaceRoot: workspace });
    bridges.push(bridge);

    const res = await httpRequest({
      port: bridge.port,
      method: 'POST',
      path: '/evaluate',
      body: { payload: { hook_event_name: 'PreToolUse' } },
    });

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('mode');
  });

  it('unknown routes return 404', async () => {
    const workspace = await makeWorkspace({});
    const bridge = await startHttpBridge({ workspaceRoot: workspace });
    bridges.push(bridge);

    const res = await httpRequest({ port: bridge.port, method: 'GET', path: '/unknown' });

    expect(res.statusCode).toBe(404);
  });

  it('close() removes the port file', async () => {
    const workspace = await makeWorkspace({});
    const bridge = await startHttpBridge({ workspaceRoot: workspace });

    const portFile = path.join(workspace, '.policy', '.port');
    await expect(fs.access(portFile)).resolves.toBeUndefined();

    await bridge.close();

    await expect(fs.access(portFile)).rejects.toThrow();
  });
});
