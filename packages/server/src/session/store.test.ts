import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WS_COMMANDS, WS_EVENTS } from '@cubby/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../db/index.js';
import { SessionStore } from './store.js';

describe('protocol session commands and events', () => {
  it('exposes session rename and delete protocol constants', () => {
    expect(WS_COMMANDS.SESSION_RENAME).toBe('session.rename');
    expect(WS_COMMANDS.SESSION_DELETE).toBe('session.delete');
    expect(WS_EVENTS.SESSION_DELETED).toBe('session.deleted');
  });
});

describe('SessionStore', () => {
  let db: Database;
  let store: SessionStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-test-${randomUUID()}.db`);
    db = new Database(dbPath);
    store = new SessionStore(db);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {}
  });

  it('creates a session', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    expect(session.id).toBeTruthy();
    expect(session.status).toBe('draft');
    expect(session.provider).toBe('claude-code');
  });

  it('persists the baseline git head for a session', () => {
    const session = store.create({
      workspaceId: '/tmp/test',
      provider: 'claude-code',
      baselineGitHead: 'abc123',
    });

    expect(session.baselineGitHead).toBe('abc123');
    expect(store.get(session.id)?.baselineGitHead).toBe('abc123');
  });

  it('defaults new sessions to yolo mode', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });

    expect(session.yolo).toBe(true);
    expect(store.get(session.id)?.yolo).toBe(true);
  });

  it('persists explicit non-yolo sessions', () => {
    const session = store.create({
      workspaceId: '/tmp/test',
      provider: 'claude-code',
      yolo: false,
    });

    expect(session.yolo).toBe(false);
    expect(store.get(session.id)?.yolo).toBe(false);
  });

  it('migrates existing session rows to yolo mode by default', async () => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {}

    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const legacyDb = new BetterSqlite3(dbPath);
    legacyDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        pid INTEGER,
        exit_code INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT
      );
      INSERT INTO sessions (
        id,
        workspace_id,
        title,
        provider,
        model,
        status,
        created_at,
        updated_at
      ) VALUES (
        'legacy-session',
        '/tmp/legacy',
        'Legacy session',
        'claude-code',
        NULL,
        'draft',
        '2026-06-10T00:00:00.000Z',
        '2026-06-10T00:00:00.000Z'
      );
    `);
    legacyDb.close();

    db = new Database(dbPath);
    store = new SessionStore(db);

    expect(store.get('legacy-session')).toMatchObject({
      id: 'legacy-session',
      yolo: true,
    });
  });

  it('gets a session by id', () => {
    const created = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    const found = store.get(created.id);
    expect(found?.id).toBe(created.id);
  });

  it('lists sessions', () => {
    store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    store.create({ workspaceId: '/tmp/test', provider: 'codex' });
    const list = store.list();
    expect(list.length).toBe(2);
  });

  it('updates session status', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    store.updateStatus(session.id, 'running');
    const updated = store.get(session.id);
    expect(updated?.status).toBe('running');
  });

  it('updates session title', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    store.updateTitle(session.id, 'Build pinyin drills');
    const updated = store.get(session.id);
    expect(updated?.title).toBe('Build pinyin drills');
  });

  it('updates provider session id', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'codex' });

    store.updateProviderSessionId(session.id, 'provider-session-1');

    const updated = store.get(session.id);
    expect(updated?.providerSessionId).toBe('provider-session-1');
  });

  it('returns null for non-existent session', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  it('deletes a session and related terminal records', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    const terminalId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      'INSERT INTO terminals (id, session_id, title, pid, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(terminalId, session.id, 'main', 123, 120, 40, now);
    store.appendTerminalOutput(session.id, { data: 'hello', seqStart: 0, seq: 5 });
    store.upsertTerminalSnapshot(session.id, {
      data: 'snapshot',
      seq: 5,
      cols: 120,
      rows: 40,
    });

    expect(store.delete(session.id)).toBe(true);
    expect(store.get(session.id)).toBeNull();
    expect(store.getTerminalOutputHistory(session.id)).toEqual([]);
    expect(store.getTerminalSnapshot(session.id)).toBeNull();
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM terminals WHERE session_id = ?')
        .get(session.id) as Record<string, number>,
    ).toEqual({ count: 0 });
    expect(store.delete(session.id)).toBe(false);
  });

  it('upserts, loads, and deletes session reviews', () => {
    const session = store.create({
      workspaceId: '/tmp/test',
      provider: 'claude-code',
      baselineGitHead: 'base',
    });

    store.upsertSessionReview({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      generatedAt: '2026-06-11T10:00:00.000Z',
      baselineGitHead: 'base',
      currentGitHead: 'head',
      changedFiles: [{ path: 'README.md', status: 'modified' }],
      summary: {
        total: 1,
        added: 0,
        modified: 1,
        deleted: 0,
        renamed: 0,
        untracked: 0,
      },
      lastOutput: 'finished',
      exitCode: 0,
    });

    expect(store.getSessionReview(session.id)).toMatchObject({
      sessionId: session.id,
      baselineGitHead: 'base',
      currentGitHead: 'head',
      changedFiles: [{ path: 'README.md', status: 'modified' }],
      lastOutput: 'finished',
      exitCode: 0,
    });

    expect(store.delete(session.id)).toBe(true);
    expect(store.getSessionReview(session.id)).toBeNull();
  });

  it('returns only the latest terminal run when history contains shell initialization markers', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });

    store.appendTerminalOutput(session.id, 'old run output');
    store.appendTerminalOutput(session.id, '\x1b[?25l\x1b[?2004h\x1b[?1004h\x1b[?2031h');
    store.appendTerminalOutput(session.id, 'latest run output');

    expect(store.getTerminalOutputHistory(session.id)).toEqual([
      '\x1b[?25l\x1b[?2004h\x1b[?1004h\x1b[?2031h',
      'latest run output',
    ]);
  });

  it('persists terminal output sequence metadata when provided', () => {
    const session = store.create({ workspaceId: '/tmp', provider: 'mock' });

    store.appendTerminalOutput(session.id, { data: 'abc', seqStart: 0, seq: 3 });

    const rows = db
      .prepare('SELECT data, seq_start, seq_end FROM terminal_outputs WHERE session_id = ?')
      .all(session.id) as Array<Record<string, unknown>>;

    expect(rows).toEqual([{ data: 'abc', seq_start: 0, seq_end: 3 }]);
    expect(store.getTerminalOutputHistory(session.id)).toEqual(['abc']);
  });

  it('returns retained terminal output chunks with their persisted sequence metadata', () => {
    const session = store.create({ workspaceId: '/tmp', provider: 'mock' });

    store.appendTerminalOutput(session.id, { data: 'one', seqStart: 0, seq: 3 }, 2);
    store.appendTerminalOutput(session.id, { data: 'two', seqStart: 3, seq: 6 }, 2);
    store.appendTerminalOutput(session.id, { data: 'three', seqStart: 6, seq: 11 }, 2);

    expect(store.getTerminalOutputChunks(session.id, 2)).toEqual([
      { data: 'two', seqStart: 3, seq: 6 },
      { data: 'three', seqStart: 6, seq: 11 },
    ]);
  });

  it('upserts, loads, and clears terminal snapshots', () => {
    const session = store.create({ workspaceId: '/tmp', provider: 'mock' });

    store.upsertTerminalSnapshot(session.id, {
      data: 'first snapshot',
      seq: 14,
      cols: 100,
      rows: 30,
    });
    store.upsertTerminalSnapshot(session.id, {
      data: 'second snapshot',
      seq: 29,
      cols: 120,
      rows: 40,
    });

    expect(store.getTerminalSnapshot(session.id)).toEqual({
      data: 'second snapshot',
      seq: 29,
      cols: 120,
      rows: 40,
    });

    store.clearTerminalSnapshot(session.id);
    expect(store.getTerminalSnapshot(session.id)).toBeNull();
  });
});
