import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentProvider, SpawnOptions } from '@cubby/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../db/index.js';
import { SessionManager } from './manager.js';
import { SessionStore } from './store.js';

// Mock provider
function createMockProvider(): AgentProvider & {
  spawnOptions: SpawnOptions[];
  timers: ReturnType<typeof setTimeout>[];
} {
  const spawnOptions: SpawnOptions[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  return {
    name: 'mock',
    spawnOptions,
    timers,
    async spawn(
      _sid: string,
      opts: SpawnOptions,
      onOutput: (d: string) => void = () => {},
      onExit: (c: number) => void = () => {},
    ) {
      spawnOptions.push(opts);
      timers.push(setTimeout(() => onOutput('hello from mock'), 10));
      timers.push(setTimeout(() => onExit(0), 50));
      return {
        pid: 12345,
        onData: (_callback) => {},
        onExit: (_callback) => {},
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
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-test-${randomUUID()}.db`);
    db = new Database(dbPath);
    store = new SessionStore(db);
    manager = new SessionManager(store);
    mockProvider = createMockProvider();
    manager.registerProvider(mockProvider);
  });

  afterEach(() => {
    for (const t of mockProvider.timers) clearTimeout(t);
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {}
  });

  it('creates a session', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    expect(session.status).toBe('draft');
  });

  it('starts a session', async () => {
    const outputs: string[] = [];
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }, (d) =>
      outputs.push(d),
    );
    const updated = store.get(session.id);
    expect(updated?.status).toBe('running');
    await new Promise((r) => setTimeout(r, 100));
    expect(outputs.length).toBeGreaterThan(0);
  });

  it('keeps output history available after a session exits', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await new Promise((r) => setTimeout(r, 100));

    expect(manager.getOutputHistory(session.id)).toContain('hello from mock');
    expect(manager.getSession(session.id)?.status).toBe('ended');
    expect(manager.getOutputHistory(session.id)).toContain('hello from mock');
  });

  it('rejects starting a non-draft session', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await expect(() =>
      manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }),
    ).rejects.toThrow('not in draft status');
  });

  it('resumes an ended session and keeps output history', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 100));

    expect(manager.getSession(session.id)?.status).toBe('ended');
    expect(manager.getOutputHistory(session.id)).toContain('hello from mock');

    await manager.resumeSession(session.id, { cwd: '/tmp', cols: 100, rows: 30 });

    expect(manager.getSession(session.id)?.status).toBe('running');
    expect(mockProvider.spawnOptions.at(-1)).toMatchObject({
      cwd: '/tmp',
      cols: 100,
      rows: 30,
      resume: true,
    });
    expect(manager.getOutputHistory(session.id)).toContain('hello from mock');
  });

  it('rejects resuming a running session', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await expect(() =>
      manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }),
    ).rejects.toThrow('not in ended status');
  });

  it('marks persisted running sessions as ended when no process is attached', () => {
    const session = store.create({ workspaceId: '/tmp', provider: 'mock' });
    store.updateStatus(session.id, 'running');

    const restartedManager = new SessionManager(store);
    const reconciled = restartedManager.reconcileDetachedLiveSessions();

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.id).toBe(session.id);
    expect(store.get(session.id)?.status).toBe('ended');
  });

  it('keeps running sessions live when a process is attached', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    const reconciled = manager.reconcileDetachedLiveSessions();

    expect(reconciled).toHaveLength(0);
    expect(store.get(session.id)?.status).toBe('running');
  });

  it('sets a concise title from the first terminal input', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

    const updated = manager.recordTerminalInput(
      session.id,
      'Build a pinyin tone quiz for beginner practice today\r',
    );

    expect(updated?.title).toBe('Build a pinyin tone quiz');
    expect(manager.getSession(session.id)?.title).toBe('Build a pinyin tone quiz');
  });

  it('does not overwrite an explicit session title from terminal input', () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      title: 'Existing title',
    });

    const updated = manager.recordTerminalInput(session.id, 'Build a pinyin tone quiz\r');

    expect(updated).toBeNull();
    expect(manager.getSession(session.id)?.title).toBe('Existing title');
  });

  it('supports backspace while collecting the first terminal input', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

    manager.recordTerminalInput(session.id, 'Buildx');
    const updated = manager.recordTerminalInput(session.id, '\x7f pinyin cards\r');

    expect(updated?.title).toBe('Build pinyin cards');
  });

  it('ignores terminal escape sequences before the first terminal input', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

    const updated = manager.recordTerminalInput(
      session.id,
      '\x1b[O\x1b[?1;2c\x1b[IReply exactly CUBBY_REAL_READY. Do not use tools.\r',
    );

    expect(updated?.title).toBe('Reply exactly CUBBY_REAL_READY.');
  });

  it('does not title a session from a slash command', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

    const slashCommand = manager.recordTerminalInput(session.id, '/theme\r');
    const prompt = manager.recordTerminalInput(session.id, 'Build pinyin flashcards\r');

    expect(slashCommand).toBeNull();
    expect(prompt?.title).toBe('Build pinyin flashcards');
    expect(manager.getSession(session.id)?.title).toBe('Build pinyin flashcards');
  });

  it('replaces an existing slash command title with the next real prompt', () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      title: '/theme',
    });

    const updated = manager.recordTerminalInput(session.id, 'Build pinyin flashcards\r');

    expect(updated?.title).toBe('Build pinyin flashcards');
    expect(manager.getSession(session.id)?.title).toBe('Build pinyin flashcards');
  });
});
