import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './manager.js';
import { SessionStore } from './store.js';
import { Database } from '../db/index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

// Mock provider
function createMockProvider() {
  return {
    name: 'mock',
    async spawn(_sid: string, _opts: unknown, onOutput: (d: string) => void, onExit: (c: number) => void) {
      setTimeout(() => onOutput('hello from mock'), 10);
      setTimeout(() => onExit(0), 50);
      return {
        pid: 12345,
        onData: () => {},
        onExit: () => {},
        write: () => {},
        resize: () => {},
        kill: () => {},
      };
    },
    async kill() {},
  };
}

describe('SessionManager', () => {
  let db: Database;
  let store: SessionStore;
  let manager: SessionManager;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-test-${Date.now()}.db`);
    db = new Database(dbPath);
    store = new SessionStore(db);
    manager = new SessionManager(store);
    manager.registerProvider(createMockProvider() as any);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('creates a session', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    expect(session.status).toBe('draft');
  });

  it('starts a session', async () => {
    const outputs: string[] = [];
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }, (d) => outputs.push(d));
    const updated = store.get(session.id);
    expect(updated?.status).toBe('running');
    await new Promise(r => setTimeout(r, 100));
    expect(outputs.length).toBeGreaterThan(0);
  });

  it('rejects starting a non-draft session', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await expect(() =>
      manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 })
    ).rejects.toThrow('not in draft status');
  });
});
