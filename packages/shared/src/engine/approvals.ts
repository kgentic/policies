import { createHash } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { PolicyEvaluationInput, PolicyEvaluationResult } from './evaluator.js';

export interface ApprovalRecord {
  type: 'approval';
  actionHash: string;
  hookId: string;
  event: string;
  toolName?: string;
  command?: string;
  path?: string;
  recordedAt: string;
  expiresAt: string;
}

export interface ApprovalLookupResult {
  matched: boolean;
  record?: ApprovalRecord;
}

export function approvalStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.policy', 'approvals.jsonl');
}

export function normalizeActionPath(inputPath: string | undefined): string | undefined {
  if (inputPath === undefined) {
    return undefined;
  }
  return inputPath.replace(/\\/g, '/');
}

export function createActionHash(input: PolicyEvaluationInput, hookId: string): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({
    hookId,
    event: input.event,
    toolName: input.toolName ?? null,
    command: input.command ?? null,
    path: normalizeActionPath(input.path) ?? null,
  }));
  return hash.digest('hex');
}

export async function readApprovals(workspaceRoot: string): Promise<ApprovalRecord[]> {
  const filePath = approvalStorePath(workspaceRoot);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ApprovalRecord)
      .filter((record) => record.type === 'approval');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function findActiveApproval(
  workspaceRoot: string,
  actionHash: string,
  now: Date = new Date(),
): Promise<ApprovalLookupResult> {
  const approvals = await readApprovals(workspaceRoot);
  const nowMs = now.getTime();

  for (let index = approvals.length - 1; index >= 0; index -= 1) {
    const approval = approvals[index];
    if (approval === undefined) {
      continue;
    }
    if (approval.actionHash !== actionHash) {
      continue;
    }
    if (new Date(approval.expiresAt).getTime() < nowMs) {
      continue;
    }
    return { matched: true, record: approval };
  }

  return { matched: false };
}

export async function appendApprovalRecord(
  workspaceRoot: string,
  input: PolicyEvaluationInput,
  result: PolicyEvaluationResult,
  ttlMinutes: number,
  now: Date = new Date(),
): Promise<ApprovalRecord | null> {
  if (!result.matched || result.hookId === undefined || result.decision !== 'ask' || ttlMinutes <= 0) {
    return null;
  }

  return appendApprovalRecordForHook(workspaceRoot, input, result.hookId, ttlMinutes, now);
}

export async function appendApprovalRecordForHook(
  workspaceRoot: string,
  input: PolicyEvaluationInput,
  hookId: string,
  ttlMinutes: number,
  now: Date = new Date(),
): Promise<ApprovalRecord | null> {
  if (ttlMinutes <= 0) {
    return null;
  }

  const recordedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const record: ApprovalRecord = {
    type: 'approval',
    actionHash: createActionHash(input, hookId),
    hookId,
    event: input.event,
    toolName: input.toolName,
    command: input.command,
    path: normalizeActionPath(input.path),
    recordedAt,
    expiresAt,
  };

  const storePath = approvalStorePath(workspaceRoot);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.appendFile(storePath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}
