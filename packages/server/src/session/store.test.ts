import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../db/index.js';
import { SessionStore } from './store.js';

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

  it('returns null for non-existent session', () => {
    expect(store.get('nonexistent')).toBeNull();
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
});
