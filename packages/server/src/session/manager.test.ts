import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentProvider, SpawnOptions, TerminalReplayResult } from '@cubby/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../db/index.js';
import { readGitHead } from '../git/git-service.js';
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

function createLiveOutputProvider(name: string, output = 'hello from live'): AgentProvider {
  return {
    name,
    async spawn(
      _sessionId: string,
      _options: SpawnOptions,
      onOutput: (data: string) => void = () => {},
    ) {
      setTimeout(() => onOutput(output), 0);
      return {
        pid: 32_100,
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

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function createCommittedRepo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(root, 'README.md'), '# test\n');
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'cubby@example.test']);
  runGit(root, ['config', 'user.name', 'Cubby Test']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'initial']);
  return root;
}

async function waitForSessionStatus(
  manager: SessionManager,
  sessionId: string,
  status: string,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (manager.getSession(sessionId)?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for session ${sessionId} to become ${status}`);
}

async function waitForOutputReplay(
  manager: SessionManager,
  sessionId: string,
  timeoutMs = 1_000,
): Promise<Extract<TerminalReplayResult, { status: 'ok' }>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const replay = manager.getOutputReplay(sessionId, 0);
    if (replay.status === 'ok' && replay.chunks.length > 0) return replay;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for output replay for session ${sessionId}`);
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

  it('renames a session with a trimmed title', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

    const updated = manager.renameSession(session.id, '  Customer rollout plan  ');

    expect(updated.title).toBe('Customer rollout plan');
    expect(manager.getSession(session.id)?.title).toBe('Customer rollout plan');
  });

  it('rejects renaming a session to an empty title', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

    expect(() => manager.renameSession(session.id, '   ')).toThrow('Session title is required');
  });

  it('rejects renaming a missing session', () => {
    expect(() => manager.renameSession('missing-session', 'New title')).toThrow(
      'Session not found',
    );
  });

  it('deletes an ended session and removes persisted output', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    store.appendTerminalOutput(session.id, { data: 'saved output', seqStart: 0, seq: 12 });
    store.updateStatus(session.id, 'ended', { exitCode: 0 });

    await expect(manager.deleteSession(session.id)).resolves.toBe(true);

    expect(store.get(session.id)).toBeNull();
    expect(store.getTerminalOutputHistory(session.id, 10)).toEqual([]);
    expect(manager.getOutputHistory(session.id)).toEqual([]);
  });

  it('stops a live process before deleting a session', async () => {
    const killed: string[] = [];
    const provider: AgentProvider = {
      name: 'delete-live',
      async spawn(sessionId: string) {
        return {
          pid: 32_000,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {
            killed.push(sessionId);
          },
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'delete-live' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    const updateStatus = vi.spyOn(store, 'updateStatus');
    const statuses: string[] = [];
    manager.onStatusChange((sessionId, status) => {
      if (sessionId === session.id) statuses.push(status);
    });

    await expect(manager.deleteSession(session.id)).resolves.toBe(true);

    expect(killed).toEqual([session.id]);
    expect(manager.getProcess(session.id)).toBeUndefined();
    expect(updateStatus).toHaveBeenCalledWith(session.id, 'ended', { pid: 32_000 });
    expect(statuses).toContain('ended');
    expect(store.get(session.id)).toBeNull();
  });

  it('clears live state and preserves the session when delete kill throws', async () => {
    const killError = new Error('delete kill failed');
    const provider: AgentProvider = {
      name: 'delete-throwing-kill',
      async spawn() {
        return {
          pid: 32_001,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {
            throw killError;
          },
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'delete-throwing-kill',
    });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    const deleteSession = vi.spyOn(store, 'delete');

    await expect(() => manager.deleteSession(session.id)).rejects.toThrow('delete kill failed');

    expect(manager.getProcess(session.id)).toBeUndefined();
    expect(store.get(session.id)).toMatchObject({ status: 'ended', pid: 32_001 });
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('ignores late output after a session is deleted', async () => {
    let capturedOutput: ((data: string) => void) | undefined;
    const provider: AgentProvider = {
      name: 'late-output-after-delete',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        capturedOutput = onOutput;
        return {
          pid: 32_002,
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
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'late-output-after-delete',
    });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await manager.deleteSession(session.id);

    expect(() => capturedOutput?.('late output')).not.toThrow();
    expect(manager.getOutputHistory(session.id)).toEqual([]);
  });

  it('starts a session', async () => {
    const outputs: string[] = [];
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }, (chunk) =>
      outputs.push(chunk.data),
    );
    const updated = store.get(session.id);
    expect(updated?.status).toBe('running');
    await new Promise((r) => setTimeout(r, 100));
    expect(outputs.length).toBeGreaterThan(0);
  });

  it('generates and persists a session review', async () => {
    const workspace = createCommittedRepo('cubby-session-review-');
    const baseline = await readGitHead(workspace);
    const session = manager.createSession({
      workspaceId: workspace,
      provider: 'mock',
      baselineGitHead: baseline,
    });
    store.appendTerminalOutput(session.id, { data: 'first output\n', seqStart: 0, seq: 13 });
    store.appendTerminalOutput(session.id, { data: 'final output\n', seqStart: 13, seq: 26 });
    store.updateStatus(session.id, 'ended', { exitCode: 2 });
    writeFileSync(join(workspace, 'notes.txt'), 'review me\n');

    const review = await manager.generateSessionReview(session.id);

    expect(review).toMatchObject({
      sessionId: session.id,
      workspaceId: workspace,
      baselineGitHead: baseline,
      changedFiles: [{ path: 'notes.txt', status: 'untracked' }],
      summary: { total: 1, untracked: 1 },
      lastOutput: 'first output\nfinal output\n',
      exitCode: 2,
    });
    expect(store.getSessionReview(session.id)).toEqual(review);
  });

  it('passes persisted yolo mode into provider spawn options when starting', async () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      yolo: false,
    });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    expect(mockProvider.spawnOptions[0]).toMatchObject({ yolo: false });
  });

  it('passes persisted yolo mode into provider spawn options when resuming', async () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      yolo: false,
    });
    store.updateStatus(session.id, 'ended', { exitCode: 0 });

    await manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    expect(mockProvider.spawnOptions[0]).toMatchObject({
      resume: true,
      yolo: false,
    });
  });

  it('returns sequenced live replay chunks after a rendered seq', async () => {
    const provider = createLiveOutputProvider('live-replay');
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    const fullReplay = await waitForOutputReplay(manager, session.id);

    const firstSeq = fullReplay.chunks[0]?.seq ?? 0;
    const partialReplay = manager.getOutputReplay(session.id, firstSeq);

    expect(partialReplay).toMatchObject({
      status: 'ok',
      sessionId: session.id,
      seq: fullReplay.seq,
    });
    if (partialReplay.status !== 'ok') throw new Error('expected ok partial replay');
    expect(partialReplay.chunks.every((chunk) => chunk.seq > firstSeq)).toBe(true);
  });

  it('reconciles a caught-up live session as noop', async () => {
    const provider = createLiveOutputProvider('live-noop');
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    const replay = await waitForOutputReplay(manager, session.id);

    expect(manager.reconcileTerminalRecovery(session.id, replay.seq)).toEqual({
      action: 'noop',
      sessionId: session.id,
      headSeq: replay.seq,
    });
  });

  it('reconciles cold live recovery as snapshot when a checkpoint is available', async () => {
    const provider = createLiveOutputProvider('live-snapshot');
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    const replay = await waitForOutputReplay(manager, session.id);

    expect(manager.reconcileTerminalRecovery(session.id, 0)).toEqual({
      action: 'snapshot',
      sessionId: session.id,
      headSeq: replay.seq,
    });
  });

  it('reconciles an ended caught-up session as closed', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 100));

    const replay = manager.getOutputReplay(session.id, 0);
    if (replay.status !== 'ok') throw new Error('expected ok replay');

    expect(manager.reconcileTerminalRecovery(session.id, replay.seq)).toEqual({
      action: 'closed',
      sessionId: session.id,
      headSeq: replay.seq,
      exitCode: 0,
    });
  });

  it('reconciles evicted live output as snapshot when a checkpoint is available', async () => {
    const provider: AgentProvider = {
      name: 'evicting',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        for (const output of ['one', 'two', 'three']) onOutput(output);
        return {
          pid: 40_000,
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
    manager = new SessionManager(store, { outputHistoryLimit: 2 });
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'evicting' });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    expect(manager.reconcileTerminalRecovery(session.id, 0)).toEqual({
      action: 'snapshot',
      sessionId: session.id,
      headSeq: 11,
    });
  });

  it('returns a live terminal snapshot and replays only output after the snapshot seq', async () => {
    const firstOutput = 'before clear';
    const secondOutput = '\x1b[2J\x1b[Hafter clear';
    const expectedSeq = Buffer.byteLength(`${firstOutput}${secondOutput}`, 'utf8');
    const provider: AgentProvider = {
      name: 'snapshot',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        onOutput(firstOutput);
        onOutput(secondOutput);
        return {
          pid: 40_001,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'snapshot' });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    const snapshot = await manager.getTerminalSnapshot(session.id);

    expect(snapshot).toMatchObject({
      status: 'ok',
      sessionId: session.id,
      seq: expectedSeq,
      cols: 80,
      rows: 24,
    });
    if (snapshot.status !== 'ok') throw new Error('expected ok snapshot');
    expect(snapshot.data).toContain('after clear');
    expect(snapshot.data).not.toContain('before clear');
    expect(manager.getOutputReplay(session.id, snapshot.seq)).toEqual({
      status: 'ok',
      sessionId: session.id,
      chunks: [],
      seq: snapshot.seq,
    });
  });

  it('returns canonical live terminal snapshot geometry when dimensions are requested', async () => {
    const output = 'desktop sized output before mobile rejoin\r\n';
    const provider: AgentProvider = {
      name: 'sized-snapshot',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        onOutput(output);
        return {
          pid: 40_002,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'sized-snapshot' });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 120, rows: 40 });
    const snapshot = await manager.getTerminalSnapshot(session.id, { cols: 44, rows: 18 });

    expect(snapshot).toMatchObject({
      status: 'ok',
      sessionId: session.id,
      seq: Buffer.byteLength(output, 'utf8'),
      cols: 120,
      rows: 40,
    });
    expect(snapshot.status === 'ok' ? snapshot.data : '').toContain('mobile rejoin');
  });

  it('uses persisted sequence metadata when replaying retained ended output', () => {
    manager = new SessionManager(store, { outputHistoryLimit: 2 });
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    store.appendTerminalOutput(session.id, { data: 'one', seqStart: 0, seq: 3 }, 2);
    store.appendTerminalOutput(session.id, { data: 'two', seqStart: 3, seq: 6 }, 2);
    store.appendTerminalOutput(session.id, { data: 'three', seqStart: 6, seq: 11 }, 2);
    store.updateStatus(session.id, 'ended', { exitCode: 0 });

    expect(manager.getOutputReplay(session.id, 6)).toEqual({
      status: 'ok',
      sessionId: session.id,
      chunks: [{ data: 'three', seqStart: 6, seq: 11 }],
      seq: 11,
    });
    expect(manager.getOutputReplay(session.id, 1)).toEqual({
      status: 'too_old',
      sessionId: session.id,
      oldestSeq: 3,
      seq: 11,
    });
    expect(manager.reconcileTerminalRecovery(session.id, 6)).toEqual({
      action: 'replay',
      sessionId: session.id,
      fromSeq: 6,
      headSeq: 11,
    });
    expect(manager.reconcileTerminalRecovery(session.id, 1)).toEqual({
      action: 'unrecoverable',
      sessionId: session.id,
      reason: 'too_old_no_snapshot',
    });
  });

  it('keeps output history available after a session exits', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await waitForSessionStatus(manager, session.id, 'ended');

    expect(manager.getOutputHistory(session.id)).toContain('hello from mock');
    expect(manager.getSession(session.id)?.status).toBe('ended');
    expect(manager.getOutputHistory(session.id)).toContain('hello from mock');
  });

  it('keeps ended session output history available after manager restart', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await waitForSessionStatus(manager, session.id, 'ended');

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

  it('filters ended sessions when the provider conversation does not exist', () => {
    const provider = {
      name: 'conversation-aware',
      hasConversation: () => false,
      async spawn() {
        return {
          pid: 30_010,
          onData: (_callback: (data: string) => void) => {},
          onExit: (_callback: (code: number) => void) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const ended = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    store.updateStatus(ended.id, 'ended');

    expect(manager.listSessions().map((session) => session.id)).not.toContain(ended.id);
  });

  it('lists ended sessions with captured terminal history even when resume is unsupported', () => {
    const provider: AgentProvider = {
      name: 'history-only',
      supportsResume: false,
      hasConversation: () => false,
      async spawn() {
        return {
          pid: 30_014,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    store.appendTerminalOutput(session.id, { data: 'codex output', seqStart: 0, seq: 12 });
    store.updateStatus(session.id, 'ended');

    expect(manager.listSessions().map((item) => item.id)).toContain(session.id);
  });

  it('marks history-only ended sessions as not resumable', () => {
    const provider: AgentProvider = {
      name: 'history-without-conversation',
      hasConversation: () => false,
      async spawn() {
        return {
          pid: 30_015,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    store.appendTerminalOutput(session.id, { data: 'saved terminal output', seqStart: 0, seq: 21 });
    store.updateStatus(session.id, 'ended');

    expect(manager.listSessions().find((item) => item.id === session.id)).toMatchObject({
      id: session.id,
      resumable: false,
      resumeUnavailableReason: 'Provider conversation not found',
    });
    expect(manager.getSession(session.id)).toMatchObject({
      id: session.id,
      resumable: false,
      resumeUnavailableReason: 'Provider conversation not found',
    });
  });

  it('lists draft sessions before the provider conversation exists', () => {
    const provider: AgentProvider = {
      name: 'new-only-draft',
      supportsResume: true,
      hasConversation: () => false,
      async spawn() {
        throw new Error('spawn should not be called');
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });

    expect(manager.listSessions().map((item) => item.id)).toContain(session.id);
  });

  it('lists live sessions before the provider conversation exists', () => {
    const provider = {
      name: 'live-before-conversation',
      hasConversation: () => false,
      async spawn() {
        return {
          pid: 30_013,
          onData: (_callback: (data: string) => void) => {},
          onExit: (_callback: (code: number) => void) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const starting = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    const running = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    store.updateStatus(starting.id, 'starting');
    store.updateStatus(running.id, 'running', { pid: 30_013 });

    expect(manager.listSessions().map((session) => session.id)).toEqual(
      expect.arrayContaining([starting.id, running.id]),
    );
  });

  it('keeps failed starts visible with error output', async () => {
    const provider: AgentProvider = {
      name: 'failing-start',
      hasConversation: () => false,
      async spawn() {
        throw new Error('provider command not found');
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });

    await expect(() =>
      manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }),
    ).rejects.toThrow('provider command not found');

    expect(manager.listSessions().map((item) => item.id)).toContain(session.id);
    expect(manager.getOutputHistory(session.id).join('')).toContain('provider command not found');
  });

  it('lists sessions when the provider conversation exists', () => {
    const provider = {
      name: 'existing-conversation',
      hasConversation: () => true,
      async spawn() {
        return {
          pid: 30_012,
          onData: (_callback: (data: string) => void) => {},
          onExit: (_callback: (code: number) => void) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });

    expect(manager.listSessions().map((item) => item.id)).toContain(session.id);
  });

  it('rejects resuming ended sessions when the provider conversation does not exist', async () => {
    let spawnCount = 0;
    const provider = {
      name: 'missing-conversation',
      hasConversation: () => false,
      async spawn() {
        spawnCount += 1;
        return {
          pid: 30_011,
          onData: (_callback: (data: string) => void) => {},
          onExit: (_callback: (code: number) => void) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    store.updateStatus(session.id, 'ended');

    await expect(() =>
      manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }),
    ).rejects.toThrow('Session is not resumable');
    expect(spawnCount).toBe(0);
    expect(store.get(session.id)?.status).toBe('ended');
  });

  it('rejects resuming sessions when the provider does not support resume', async () => {
    const provider: AgentProvider = {
      name: 'new-only',
      supportsResume: false,
      hasConversation: () => true,
      async spawn() {
        throw new Error('spawn should not be called');
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    store.updateStatus(session.id, 'ended');

    await expect(() =>
      manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }),
    ).rejects.toThrow('provider does not support resume');
  });

  it('persists provider session ids and passes them back when resuming', async () => {
    const spawnOptions: SpawnOptions[] = [];
    const providerSessionIds: Array<string | undefined> = [];
    const provider: AgentProvider = {
      name: 'resumable-provider-id',
      supportsResume: true,
      hasConversation: (_sessionId, _cwd, providerSessionId) => providerSessionId === 'provider-1',
      async spawn(
        _sessionId,
        opts,
        _onOutput = () => {},
        _onExit = () => {},
        onProviderSessionId = () => {},
      ) {
        spawnOptions.push(opts);
        providerSessionIds.push(opts.providerSessionId);
        if (!opts.resume) onProviderSessionId('provider-1');
        return {
          pid: opts.resume ? 33_002 : 33_001,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await manager.killSession(session.id);
    await manager.resumeSession(session.id, { cwd: '/tmp', cols: 100, rows: 30 });

    expect(store.get(session.id)?.providerSessionId).toBe('provider-1');
    expect(spawnOptions).toHaveLength(2);
    expect(spawnOptions[1]).toMatchObject({
      resume: true,
      providerSessionId: 'provider-1',
      cols: 100,
      rows: 30,
    });
    expect(providerSessionIds).toEqual([undefined, 'provider-1']);
  });

  it('notifies listeners when a provider session id is captured', async () => {
    const updates: string[] = [];
    const provider: AgentProvider = {
      name: 'provider-id-update',
      supportsResume: true,
      hasConversation: (_sessionId, _cwd, providerSessionId) => providerSessionId === 'provider-2',
      async spawn(
        _sessionId,
        _opts,
        _onOutput = () => {},
        _onExit = () => {},
        onProviderSessionId = () => {},
      ) {
        onProviderSessionId('provider-2');
        return {
          pid: 33_003,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
    manager.onSessionUpdate((updated) => {
      if (updated.id === session.id && updated.providerSessionId) {
        updates.push(updated.providerSessionId);
      }
    });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    expect(updates).toEqual(['provider-2']);
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
