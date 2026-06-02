import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from './db/index.js';
import { SessionManager } from './session/manager.js';
import { SessionStore } from './session/store.js';

describe('Integration: SessionManager + SessionStore + Database', () => {
  let db: Database;
  let store: SessionStore;
  let manager: SessionManager;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-integration-${Date.now()}.db`);
    db = new Database(dbPath);
    store = new SessionStore(db);
    manager = new SessionManager(store);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {}
  });

  it('full lifecycle: create → start → output → kill', async () => {
    // Register mock provider
    manager.registerProvider({
      name: 'mock',
      async spawn(
        _sid: string,
        _opts: unknown,
        onOutput: (d: string) => void,
        onExit: (c: number) => void,
      ) {
        setTimeout(() => onOutput('hello'), 10);
        setTimeout(() => onExit(0), 100);
        return {
          pid: 999,
          onData: () => {},
          onExit: () => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    } as any);

    // Create
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    expect(session.status).toBe('draft');

    // Start
    const outputs: string[] = [];
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }, (d) =>
      outputs.push(d),
    );

    const running = manager.getSession(session.id);
    expect(running?.status).toBe('running');

    // Wait for output
    await new Promise((r) => setTimeout(r, 50));
    expect(outputs).toContain('hello');

    // Kill
    await manager.killSession(session.id);
    const ended = manager.getSession(session.id);
    expect(ended?.status).toBe('ended');
  });

  it('persists sessions across store instances', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    const store2 = new SessionStore(db);
    const found = store2.get(session.id);
    expect(found?.id).toBe(session.id);
  });
});
