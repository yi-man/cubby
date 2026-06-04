import type {
  RecoveryReconcileResult,
  TerminalOutputChunk,
  TerminalReplayResult,
  TerminalSnapshotResult,
} from '@cubby/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isChunk(value: unknown): value is TerminalOutputChunk {
  return (
    isRecord(value) &&
    typeof value.data === 'string' &&
    typeof value.seqStart === 'number' &&
    Number.isFinite(value.seqStart) &&
    typeof value.seq === 'number' &&
    Number.isFinite(value.seq) &&
    value.seq >= value.seqStart
  );
}

export function isTerminalOutputData(
  value: unknown,
  sessionId: string,
): value is TerminalOutputChunk & { sessionId: string } {
  return isRecord(value) && value.sessionId === sessionId && isChunk(value);
}

export function isTerminalReplayData(
  value: unknown,
  sessionId: string,
): value is TerminalReplayResult {
  if (!isRecord(value) || value.sessionId !== sessionId || typeof value.status !== 'string') {
    return false;
  }
  if (value.status === 'unknown') return true;
  if (value.status === 'too_old') {
    return typeof value.oldestSeq === 'number' && typeof value.seq === 'number';
  }
  return (
    value.status === 'ok' &&
    typeof value.seq === 'number' &&
    Array.isArray(value.chunks) &&
    value.chunks.every(isChunk)
  );
}

export function isTerminalSnapshotData(
  value: unknown,
  sessionId: string,
): value is TerminalSnapshotResult {
  if (!isRecord(value) || value.sessionId !== sessionId || typeof value.status !== 'string') {
    return false;
  }
  if (value.status === 'unknown' || value.status === 'unavailable') return true;
  return (
    value.status === 'ok' &&
    typeof value.data === 'string' &&
    typeof value.seq === 'number' &&
    Number.isFinite(value.seq) &&
    value.seq >= 0 &&
    typeof value.cols === 'number' &&
    Number.isFinite(value.cols) &&
    value.cols > 0 &&
    typeof value.rows === 'number' &&
    Number.isFinite(value.rows) &&
    value.rows > 0
  );
}

export function isRecoveryReconcileData(
  value: unknown,
  sessionId: string,
): value is RecoveryReconcileResult {
  if (!isRecord(value) || value.sessionId !== sessionId || typeof value.action !== 'string') {
    return false;
  }
  if (value.action === 'noop') return typeof value.headSeq === 'number';
  if (value.action === 'replay') {
    return typeof value.fromSeq === 'number' && typeof value.headSeq === 'number';
  }
  if (value.action === 'snapshot') return typeof value.headSeq === 'number';
  if (value.action === 'closed') return typeof value.headSeq === 'number';
  if (value.action === 'unrecoverable') {
    return value.reason === 'too_old_no_snapshot' || value.reason === 'unknown_session';
  }
  return false;
}

export function filterRenderableLiveChunks(
  chunks: TerminalOutputChunk[],
  renderedSeq: number,
): TerminalOutputChunk[] {
  return chunks.filter((chunk) => chunk.seq > renderedSeq);
}
