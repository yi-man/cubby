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

  it('keeps ended session output history available after manager restart', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 100));

    expect(manager.getSession(session.id)?.status).toBe('ended');

    const restartedManager = new SessionManager(store);

    expect(restartedManager.getOutputHistory(session.id)).toContain('hello from mock');
  });

  it('prefers captured terminal history over provider transcript history for ended sessions', async () => {
    const provider: AgentProvider = {
      name: 'transcript',
      getTranscriptHistory: () => ['> clean transcript\r\n'],
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        queueMicrotask(() => onOutput('\x1b[?2026hraw tui redraw'));
        return {
          pid: 30_000,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'transcript' });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await manager.killSession(session.id);

    expect(manager.getSession(session.id)?.status).toBe('ended');
    expect(manager.getOutputHistory(session.id)).toEqual(['\x1b[?2026hraw tui redraw']);
  });

  it('falls back to provider transcript history when no terminal output was captured', async () => {
    const provider: AgentProvider = {
      name: 'transcript-only',
      getTranscriptHistory: () => ['> clean transcript\r\n'],
      async spawn() {
        return {
          pid: 30_001,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'transcript-only' });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await manager.killSession(session.id);

    expect(manager.getOutputHistory(session.id)).toEqual(['> clean transcript\r\n']);
  });

  it('rejects starting a non-draft session', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await expect(() =>
      manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }),
    ).rejects.toThrow('not in draft status');
  });

  it('keeps a session ended when the provider exits before spawn returns', async () => {
    const provider: AgentProvider = {
      name: 'instant-exit',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        _onOutput: (data: string) => void = () => {},
        onExit: (code: number) => void = () => {},
      ) {
        onExit(7);
        return {
          pid: 30_002,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'instant-exit' });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    expect(manager.getProcess(session.id)).toBeUndefined();
    expect(store.get(session.id)).toMatchObject({ status: 'ended', exitCode: 7 });
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
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.getOutputHistory(session.id)).toContain('hello from mock');
  });

  it('replays only the current live process buffer while a resumed session is running', async () => {
    const outputs = ['first run output', 'second run output'];
    let spawnCount = 0;
    const provider: AgentProvider = {
      name: 'manual',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        const output = outputs[spawnCount++] ?? 'unexpected output';
        queueMicrotask(() => onOutput(output));
        return {
          pid: 20_000 + spawnCount,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'manual' });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(manager.getOutputHistory(session.id)).toEqual(['first run output']);

    await manager.killSession(session.id);
    expect(manager.getOutputHistory(session.id)).toEqual(['first run output']);

    await manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.getOutputHistory(session.id)).toEqual(['second run output']);
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

  it('kills active processes and marks sessions ended on shutdown', async () => {
    const killed: string[] = [];
    const provider: AgentProvider = {
      name: 'shutdown',
      async spawn(sessionId: string) {
        return {
          pid: 31_000,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {
            killed.push(sessionId);
          },
        };
      },
      async kill(process) {
        process.kill();
      },
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'shutdown' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await manager.shutdown();

    expect(killed).toEqual([session.id]);
    expect(manager.getProcess(session.id)).toBeUndefined();
    expect(store.get(session.id)?.status).toBe('ended');
  });

  it('clears process state and marks a session ended when process kill throws', async () => {
    const provider: AgentProvider = {
      name: 'throwing-kill',
      async spawn() {
        return {
          pid: 31_001,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {
            throw new Error('kill failed');
          },
        };
      },
      async kill(process) {
        process.kill();
      },
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'throwing-kill' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await expect(() => manager.killSession(session.id)).rejects.toThrow('kill failed');

    expect(manager.getProcess(session.id)).toBeUndefined();
    expect(store.get(session.id)?.status).toBe('ended');
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
