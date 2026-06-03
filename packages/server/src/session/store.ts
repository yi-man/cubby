import { randomUUID } from 'node:crypto';
import type { CreateSessionInput, Session, SessionStatus } from '@cubby/core';
import type { Database } from '../db/index.js';

const TERMINAL_OUTPUT_HISTORY_LIMIT = 5000;

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

  appendTerminalOutput(
    sessionId: string,
    data: string,
    limit = TERMINAL_OUTPUT_HISTORY_LIMIT,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO terminal_outputs (session_id, data, created_at) VALUES (?, ?, ?)')
      .run(sessionId, data, now);

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
    const rows = this.db
      .prepare(
        `SELECT data
         FROM (
           SELECT id, data
           FROM terminal_outputs
           WHERE session_id = ?
           ORDER BY id DESC
           LIMIT ?
         )
         ORDER BY id ASC`,
      )
      .all(sessionId, limit) as Record<string, unknown>[];

    return rows.map((row) => row.data as string);
  }

  private rowToSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      title: row.title as string | null,
      provider: row.provider as string,
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
