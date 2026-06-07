import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { CreateSessionInput, Session, SessionStatus, TerminalOutputChunk } from '@cubby/core';
import type { Database } from '../db/index.js';

const TERMINAL_OUTPUT_HISTORY_LIMIT = 5000;

interface TerminalOutputRow {
  id: number;
  data: string;
  seq_start: number | null;
  seq_end: number | null;
}

export interface StoredTerminalSnapshot {
  data: string;
  seq: number;
  cols: number;
  rows: number;
}

interface TerminalSnapshotRow {
  data: string;
  seq: number;
  cols: number;
  rows: number;
}

export class SessionStore {
  constructor(private db: Database) {}

  create(input: CreateSessionInput): Session {
    const id = randomUUID();
    const now = new Date().toISOString();
    const session: Session = {
      id,
      workspaceId: input.workspaceId,
      title: input.title ?? null,
      provider: input.provider,
      providerSessionId: null,
      model: input.model ?? null,
      status: 'draft',
      pid: null,
      exitCode: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };

    this.db
      .prepare(
        'INSERT INTO sessions (id, workspace_id, title, provider, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        session.workspaceId,
        session.title,
        session.provider,
        session.model,
        session.status,
        session.createdAt,
        session.updatedAt,
      );

    return session;
  }

  get(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToSession(row);
  }

  list(): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToSession(r));
  }

  updateStatus(
    id: string,
    status: SessionStatus,
    extra?: { pid?: number; exitCode?: number },
  ): void {
    const now = new Date().toISOString();
    if (status === 'ended') {
      this.db
        .prepare(
          'UPDATE sessions SET status = ?, pid = ?, exit_code = ?, updated_at = ?, ended_at = ? WHERE id = ?',
        )
        .run(status, extra?.pid ?? null, extra?.exitCode ?? null, now, now, id);
    } else {
      this.db
        .prepare(
          'UPDATE sessions SET status = ?, pid = ?, exit_code = NULL, updated_at = ?, ended_at = NULL WHERE id = ?',
        )
        .run(status, extra?.pid ?? null, now, id);
    }
  }

  updateTitle(id: string, title: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now, id);
  }

  updateProviderSessionId(id: string, providerSessionId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE sessions SET provider_session_id = ?, updated_at = ? WHERE id = ?')
      .run(providerSessionId, now, id);
  }

  delete(id: string): boolean {
    this.db.prepare('DELETE FROM terminal_snapshots WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM terminal_outputs WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM terminals WHERE session_id = ?').run(id);
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id) as {
      changes: number;
    };

    return result.changes > 0;
  }

  appendTerminalOutput(
    sessionId: string,
    output: string | TerminalOutputChunk,
    limit = TERMINAL_OUTPUT_HISTORY_LIMIT,
  ): void {
    const now = new Date().toISOString();
    const data = typeof output === 'string' ? output : output.data;
    const seqStart = typeof output === 'string' ? null : output.seqStart;
    const seqEnd = typeof output === 'string' ? null : output.seq;

    this.db
      .prepare(
        'INSERT INTO terminal_outputs (session_id, data, seq_start, seq_end, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(sessionId, data, seqStart, seqEnd, now);

    this.db
      .prepare(
        `DELETE FROM terminal_outputs
         WHERE session_id = ?
           AND id NOT IN (
             SELECT id
             FROM terminal_outputs
             WHERE session_id = ?
             ORDER BY id DESC
             LIMIT ?
           )`,
      )
      .run(sessionId, sessionId, limit);
  }

  getTerminalOutputHistory(sessionId: string, limit = TERMINAL_OUTPUT_HISTORY_LIMIT): string[] {
    const rows = this.getTerminalOutputRows(sessionId, limit);

    return latestTerminalRunRecords(rows).map((row) => row.data);
  }

  getTerminalOutputChunks(
    sessionId: string,
    limit = TERMINAL_OUTPUT_HISTORY_LIMIT,
  ): TerminalOutputChunk[] {
    const rows = latestTerminalRunRecords(this.getTerminalOutputRows(sessionId, limit));
    if (rows.length === 0) return [];
    if (rows.every(hasStoredSequence)) {
      return rows.map((row) => ({
        data: row.data,
        seqStart: row.seq_start,
        seq: row.seq_end,
      }));
    }
    return synthesizeTerminalOutputChunks(rows.map((row) => row.data));
  }

  upsertTerminalSnapshot(sessionId: string, snapshot: StoredTerminalSnapshot): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO terminal_snapshots (session_id, data, seq, cols, rows, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           data = excluded.data,
           seq = excluded.seq,
           cols = excluded.cols,
           rows = excluded.rows,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, snapshot.data, snapshot.seq, snapshot.cols, snapshot.rows, now);
  }

  getTerminalSnapshot(sessionId: string): StoredTerminalSnapshot | null {
    const row = this.db
      .prepare('SELECT data, seq, cols, rows FROM terminal_snapshots WHERE session_id = ?')
      .get(sessionId) as TerminalSnapshotRow | undefined;
    if (!row) return null;
    return {
      data: row.data,
      seq: row.seq,
      cols: row.cols,
      rows: row.rows,
    };
  }

  clearTerminalSnapshot(sessionId: string): void {
    this.db.prepare('DELETE FROM terminal_snapshots WHERE session_id = ?').run(sessionId);
  }

  private getTerminalOutputRows(
    sessionId: string,
    limit = TERMINAL_OUTPUT_HISTORY_LIMIT,
  ): TerminalOutputRow[] {
    return this.db
      .prepare(
        `SELECT id, data, seq_start, seq_end
         FROM (
           SELECT id, data, seq_start, seq_end
           FROM terminal_outputs
           WHERE session_id = ?
           ORDER BY id DESC
           LIMIT ?
         )
         ORDER BY id ASC`,
      )
      .all(sessionId, limit) as TerminalOutputRow[];
  }

  private rowToSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      title: row.title as string | null,
      provider: row.provider as string,
      providerSessionId: (row.provider_session_id as string | null) ?? null,
      model: row.model as string | null,
      status: row.status as SessionStatus,
      pid: row.pid as number | null,
      exitCode: row.exit_code as number | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      endedAt: row.ended_at as string | null,
    };
  }
}

function latestTerminalRunRecords<T extends { data: string }>(history: T[]): T[] {
  for (let index = history.length - 1; index >= 0; index--) {
    if (isTerminalRunInitialization(history[index].data)) return history.slice(index);
  }
  return history;
}

function hasStoredSequence(
  row: TerminalOutputRow,
): row is TerminalOutputRow & { seq_start: number; seq_end: number } {
  return typeof row.seq_start === 'number' && typeof row.seq_end === 'number';
}

function synthesizeTerminalOutputChunks(history: string[]): TerminalOutputChunk[] {
  let seq = 0;
  return history.map((data) => {
    const seqStart = seq;
    seq += Buffer.byteLength(data, 'utf8');
    return { data, seqStart, seq };
  });
}

function isTerminalRunInitialization(data: string): boolean {
  return (
    data.includes('\x1b[?2004h') &&
    (data.includes('\x1b[?1004h') || data.includes('\x1b[?2031h') || data.includes('\x1b[<u'))
  );
}
