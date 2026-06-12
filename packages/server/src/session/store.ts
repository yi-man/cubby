import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type {
  CreateSessionInput,
  CreateSessionSupervisorInput,
  CreateSupervisorReviewInput,
  CreateVerificationRunInput,
  Session,
  SessionReview,
  SessionReviewChange,
  SessionReviewSummary,
  SessionStatus,
  SessionSupervisor,
  SupervisorReview,
  TerminalOutputChunk,
  VerificationRun,
} from '@cubby/core';
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

interface SessionReviewRow {
  session_id: string;
  workspace_id: string;
  generated_at: string;
  baseline_git_head: string | null;
  current_git_head: string | null;
  changed_files_json: string;
  summary_json: string;
  last_output: string;
  exit_code: number | null;
}

interface VerificationRunRow {
  id: string;
  session_id: string;
  workspace_id: string;
  command: string;
  exit_code: number | null;
  duration_ms: number;
  output_summary: string;
  started_at: string;
  completed_at: string;
}

interface SessionSupervisorRow {
  session_id: string;
  workspace_id: string;
  objective: string;
  updated_at: string;
}

interface SupervisorReviewRow {
  id: string;
  session_id: string;
  workspace_id: string;
  objective: string | null;
  created_at: string;
  summary: string;
  suggestions_json: string;
  terminal_tail: string;
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
      yolo: input.yolo ?? true,
      baselineGitHead: input.baselineGitHead ?? null,
      status: 'draft',
      pid: null,
      exitCode: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };

    this.db
      .prepare(
        'INSERT INTO sessions (id, workspace_id, title, provider, model, yolo, baseline_git_head, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        session.workspaceId,
        session.title,
        session.provider,
        session.model,
        session.yolo ? 1 : 0,
        session.baselineGitHead,
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
    this.db.prepare('DELETE FROM supervisor_reviews WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM session_supervisors WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM verification_runs WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM session_reviews WHERE session_id = ?').run(id);
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

  upsertSessionReview(review: SessionReview): void {
    this.db
      .prepare(
        `INSERT INTO session_reviews (
          session_id,
          workspace_id,
          generated_at,
          baseline_git_head,
          current_git_head,
          changed_files_json,
          summary_json,
          last_output,
          exit_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          generated_at = excluded.generated_at,
          baseline_git_head = excluded.baseline_git_head,
          current_git_head = excluded.current_git_head,
          changed_files_json = excluded.changed_files_json,
          summary_json = excluded.summary_json,
          last_output = excluded.last_output,
          exit_code = excluded.exit_code`,
      )
      .run(
        review.sessionId,
        review.workspaceId,
        review.generatedAt,
        review.baselineGitHead,
        review.currentGitHead,
        JSON.stringify(review.changedFiles),
        JSON.stringify(review.summary),
        review.lastOutput,
        review.exitCode,
      );
  }

  getSessionReview(sessionId: string): SessionReview | null {
    const row = this.db
      .prepare('SELECT * FROM session_reviews WHERE session_id = ?')
      .get(sessionId) as SessionReviewRow | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      generatedAt: row.generated_at,
      baselineGitHead: row.baseline_git_head,
      currentGitHead: row.current_git_head,
      changedFiles: parseJson<SessionReviewChange[]>(row.changed_files_json, []),
      summary: parseJson<SessionReviewSummary>(row.summary_json, {
        total: 0,
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 0,
        untracked: 0,
      }),
      verificationRuns: this.listVerificationRuns(sessionId),
      lastOutput: row.last_output,
      exitCode: row.exit_code,
    };
  }

  recordVerificationRun(input: CreateVerificationRunInput): VerificationRun {
    const run: VerificationRun = {
      id: randomUUID(),
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      command: input.command,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      outputSummary: input.outputSummary,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    };

    this.db
      .prepare(
        `INSERT INTO verification_runs (
          id,
          session_id,
          workspace_id,
          command,
          exit_code,
          duration_ms,
          output_summary,
          started_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.sessionId,
        run.workspaceId,
        run.command,
        run.exitCode,
        run.durationMs,
        run.outputSummary,
        run.startedAt,
        run.completedAt,
      );

    return run;
  }

  listVerificationRuns(sessionId: string): VerificationRun[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM verification_runs
         WHERE session_id = ?
         ORDER BY started_at DESC, id DESC`,
      )
      .all(sessionId) as VerificationRunRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      command: row.command,
      exitCode: row.exit_code,
      durationMs: row.duration_ms,
      outputSummary: row.output_summary,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }));
  }

  setSessionObjective(input: CreateSessionSupervisorInput): SessionSupervisor {
    const now = new Date().toISOString();
    const supervisor: SessionSupervisor = {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      objective: input.objective,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO session_supervisors (session_id, workspace_id, objective, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           objective = excluded.objective,
           updated_at = excluded.updated_at`,
      )
      .run(
        supervisor.sessionId,
        supervisor.workspaceId,
        supervisor.objective,
        supervisor.updatedAt,
      );

    return supervisor;
  }

  getSessionSupervisor(sessionId: string): SessionSupervisor | null {
    const row = this.db
      .prepare('SELECT * FROM session_supervisors WHERE session_id = ?')
      .get(sessionId) as SessionSupervisorRow | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      objective: row.objective,
      updatedAt: row.updated_at,
    };
  }

  recordSupervisorReview(input: CreateSupervisorReviewInput): SupervisorReview {
    const review: SupervisorReview = {
      id: randomUUID(),
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      objective: input.objective,
      createdAt: input.createdAt ?? new Date().toISOString(),
      summary: input.summary,
      suggestions: input.suggestions,
      terminalTail: input.terminalTail,
    };

    this.db
      .prepare(
        `INSERT INTO supervisor_reviews (
          id,
          session_id,
          workspace_id,
          objective,
          created_at,
          summary,
          suggestions_json,
          terminal_tail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        review.id,
        review.sessionId,
        review.workspaceId,
        review.objective,
        review.createdAt,
        review.summary,
        JSON.stringify(review.suggestions),
        review.terminalTail,
      );

    return review;
  }

  listSupervisorReviews(sessionId: string): SupervisorReview[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM supervisor_reviews
         WHERE session_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(sessionId) as SupervisorReviewRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      objective: row.objective,
      createdAt: row.created_at,
      summary: row.summary,
      suggestions: parseJson<string[]>(row.suggestions_json, []),
      terminalTail: row.terminal_tail,
    }));
  }

  getLatestTerminalOutputAt(sessionId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT created_at
         FROM terminal_outputs
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(sessionId) as { created_at: string } | undefined;
    return row?.created_at ?? null;
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
      yolo: row.yolo !== 0,
      baselineGitHead: (row.baseline_git_head as string | null) ?? null,
      status: row.status as SessionStatus,
      pid: row.pid as number | null,
      exitCode: row.exit_code as number | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      endedAt: row.ended_at as string | null,
    };
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
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
