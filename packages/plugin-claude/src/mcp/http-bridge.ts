import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { runHook } from '../runner.js';
import {
  loadPolicyManifestFromDir,
  discoverPolicyManifestPath,
  type ResolvedManifest,
} from '@kgentic-ai/policies-shared';

export interface HttpBridgeOptions {
  workspaceRoot: string;
}

export interface HttpBridge {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

interface ManifestCache {
  /** Content hash of the raw manifest file used to detect staleness cheaply. */
  fileHash: string;
  /** Full resolved manifest (including rule file contents and layers). */
  loaded: ResolvedManifest;
}

interface EvaluateRequestBody {
  mode: string;
  payload: unknown;
}

function portFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.policy', '.port');
}

async function writePortFile(workspaceRoot: string, port: number): Promise<void> {
  const dir = path.join(workspaceRoot, '.policy');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(portFilePath(workspaceRoot), String(port), 'utf8');
}

async function deletePortFile(workspaceRoot: string): Promise<void> {
  try {
    await fs.unlink(portFilePath(workspaceRoot));
  } catch {
    // File may not exist on first boot or after a crash — not an error.
  }
}

/** Compute a SHA-256 hex digest of a file's raw bytes. */
async function hashFile(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, 'utf8');
  return createHash('sha256').update(raw).digest('hex');
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function makeCacheManager(workspaceRoot: string) {
  let cache: ManifestCache | null = null;

  /**
   * Returns the cached manifest if the manifest file on disk is unchanged
   * (cheap single-file read + hash compare). Reloads fully only when the hash
   * differs — or on the very first call.
   */
  async function getOrRefresh(): Promise<ManifestCache> {
    const manifestPath = await discoverPolicyManifestPath(workspaceRoot);

    if (manifestPath === undefined) {
      // No manifest — do a full load so the error message is consistent.
      const loaded = await loadPolicyManifestFromDir({ startDir: workspaceRoot });
      cache = { fileHash: loaded.hash, loaded };
      return cache;
    }

    // Cheap staleness check: read only the manifest file, hash it.
    const currentFileHash = await hashFile(manifestPath);

    if (cache !== null && cache.fileHash === currentFileHash) {
      return cache;
    }

    // Hash changed (or first load) — full reload including rule files.
    const loaded = await loadPolicyManifestFromDir({ startDir: workspaceRoot });
    cache = { fileHash: currentFileHash, loaded };
    return cache;
  }

  return { getOrRefresh };
}

export async function startHttpBridge(options: HttpBridgeOptions): Promise<HttpBridge> {
  const { workspaceRoot } = options;
  const cacheManager = makeCacheManager(workspaceRoot);

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';

    if (req.method === 'GET' && url === '/health') {
      void (async () => {
        try {
          const current = await cacheManager.getOrRefresh();
          sendJson(res, 200, { ok: true, hash: current.loaded.hash, cached: true });
        } catch {
          sendJson(res, 200, { ok: true, hash: null, cached: false });
        }
      })();
      return;
    }

    if (req.method === 'POST' && url === '/evaluate') {
      void (async () => {
        let body: string;
        try {
          body = await readBody(req);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 400, { error: `Failed to read request body: ${message}` });
          return;
        }

        let parsed: EvaluateRequestBody;
        try {
          const raw = JSON.parse(body) as unknown;
          if (
            typeof raw !== 'object' ||
            raw === null ||
            typeof (raw as Record<string, unknown>)['mode'] !== 'string'
          ) {
            sendJson(res, 400, { error: 'Request body must be JSON with {mode: string, payload: object}' });
            return;
          }
          parsed = raw as EvaluateRequestBody;
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON in request body' });
          return;
        }

        const { mode, payload } = parsed;
        const payloadText = payload !== undefined ? JSON.stringify(payload) : '';

        try {
          const cached = await cacheManager.getOrRefresh().catch(() => undefined);
          const result = await runHook(mode, payloadText, cached?.loaded);
          // runHook returns a JSON string — parse before sending so the HTTP
          // response is a JSON object, not a JSON-encoded string.
          const parsedResult = JSON.parse(result) as unknown;
          sendJson(res, 200, parsedResult);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { error: message });
        }
      })();
      return;
    }

    sendJson(res, 404, { error: `Not found: ${req.method ?? 'UNKNOWN'} ${url}` });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('Unexpected server address format'));
        return;
      }
      resolve(addr.port);
    });
    server.on('error', reject);
  });

  await writePortFile(workspaceRoot, port);

  // Register process-level cleanup so .port is removed on any exit path.
  const cleanup = (): void => {
    void deletePortFile(workspaceRoot);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  const close = async (): Promise<void> => {
    await deletePortFile(workspaceRoot);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err !== undefined) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  };

  return { server, port, close };
}
