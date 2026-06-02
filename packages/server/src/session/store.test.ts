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
    dbPath = join(tmpdir(), `cubby-test-${Date.now()}.db`);
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

  it('returns null for non-existent session', () => {
    expect(store.get('nonexistent')).toBeNull();
  });
});
