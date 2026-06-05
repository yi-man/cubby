import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentProvider, SpawnOptions } from '@cubby/core';
import { WS_COMMANDS, WS_EVENTS } from '@cubby/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { Database } from '../db/index.js';
import { SessionManager } from '../session/manager.js';
import { SessionStore } from '../session/store.js';
import { WSCommandHandler } from './handler.js';
import { WebSocketHub } from './hub.js';

describe('WSCommandHandler', () => {
  let db: Database;
  let manager: SessionManager;
  let handler: WSCommandHandler;
  let hub: WebSocketHub;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-ws-handler-${randomUUID()}.db`);
    db = new Database(dbPath);
    manager = new SessionManager(new SessionStore(db));
    hub = new WebSocketHub();
    handler = new WSCommandHandler(manager, hub);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {}
  });

  it('renames a session through websocket command and broadcasts the update', async () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      title: 'Draft',
    });
    const messages: string[] = [];
    const client = {
      readyState: 1,
      send: (message: string) => messages.push(message),
    } as unknown as WebSocket;
    hub.addClient(client);

    const response = await handler.handle(client, {
      id: 'rename-1',
      cmd: WS_COMMANDS.SESSION_RENAME,
      args: { sessionId: session.id, title: '  Customer rollout  ' },
    });

    expect(response).toMatchObject({
      id: 'rename-1',
      ok: true,
      data: { id: session.id, title: 'Customer rollout' },
    });
    expect(manager.getSession(session.id)?.title).toBe('Customer rollout');
    expect(messages.map((message) => JSON.parse(message))).toEqual([
      {
        evt: WS_EVENTS.SESSION_UPDATED,
        data: expect.objectContaining({ id: session.id, title: 'Customer rollout' }),
      },
    ]);
  });

  it('returns not found when renaming a missing session through websocket command', async () => {
    const response = await handler.handle({} as WebSocket, {
      id: 'rename-missing',
      cmd: WS_COMMANDS.SESSION_RENAME,
      args: { sessionId: 'missing-session', title: 'New title' },
    });

    expect(response).toEqual({
      id: 'rename-missing',
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Session not found' },
    });
  });

  it('returns bad request when renaming a session to an empty title through websocket command', async () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      title: 'Draft',
    });

    const response = await handler.handle({} as WebSocket, {
      id: 'rename-empty',
      cmd: WS_COMMANDS.SESSION_RENAME,
      args: { sessionId: session.id, title: '   ' },
    });

    expect(response).toEqual({
      id: 'rename-empty',
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Session title is required' },
    });
  });

  it('deletes a session through websocket command and broadcasts deletion', async () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      title: 'Delete me',
    });
    const messages: string[] = [];
    const client = {
      readyState: 1,
      send: (message: string) => messages.push(message),
    } as unknown as WebSocket;
    hub.addClient(client);

    const response = await handler.handle(client, {
      id: 'delete-1',
      cmd: WS_COMMANDS.SESSION_DELETE,
      args: { sessionId: session.id },
    });

    expect(response).toEqual({
      id: 'delete-1',
      ok: true,
      data: { sessionId: session.id },
    });
    expect(manager.getSession(session.id)).toBeNull();
    expect(messages.map((message) => JSON.parse(message))).toEqual([
      {
        evt: WS_EVENTS.SESSION_DELETED,
        data: { sessionId: session.id },
      },
    ]);
  });

  it('returns not found when deleting a missing session through websocket command', async () => {
    const response = await handler.handle({} as WebSocket, {
      id: 'delete-missing',
      cmd: WS_COMMANDS.SESSION_DELETE,
      args: { sessionId: 'missing-session' },
    });

    expect(response).toEqual({
      id: 'delete-missing',
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Session not found' },
    });
  });

  it('replays buffered terminal output for a session', async () => {
    const provider: AgentProvider = {
      name: 'mock',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        queueMicrotask(() => onOutput('history chunk'));
        return {
          pid: 123,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await handler.handle({} as WebSocket, {
      id: 'replay-1',
      cmd: 'terminal.replay',
      args: { sessionId: session.id },
    });

    expect(response).toEqual({
      id: 'replay-1',
      ok: true,
      data: {
        status: 'ok',
        sessionId: session.id,
        chunks: [{ data: 'history chunk', seqStart: 0, seq: 13 }],
        seq: 13,
      },
    });
  });

  it('replays provider transcript history when terminal output history is empty', async () => {
    const provider: AgentProvider = {
      name: 'mock',
      getTranscriptHistory: (sessionId, cwd) => [`transcript for ${sessionId} in ${cwd}`, '\r\n'],
      async spawn() {
        return {
          pid: 123,
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
    const session = manager.createSession({ workspaceId: '/tmp/transcript', provider: 'mock' });

    const response = await handler.handle({} as WebSocket, {
      id: 'replay-transcript',
      cmd: 'terminal.replay',
      args: { sessionId: session.id },
    });

    const first = `transcript for ${session.id} in /tmp/transcript`;
    expect(response).toEqual({
      id: 'replay-transcript',
      ok: true,
      data: {
        status: 'ok',
        sessionId: session.id,
        chunks: [
          { data: first, seqStart: 0, seq: Buffer.byteLength(first, 'utf8') },
          {
            data: '\r\n',
            seqStart: Buffer.byteLength(first, 'utf8'),
            seq: Buffer.byteLength(first, 'utf8') + 2,
          },
        ],
        seq: Buffer.byteLength(first, 'utf8') + 2,
      },
    });
  });

  it('returns an unknown replay result for an unknown session', async () => {
    const response = await handler.handle({} as WebSocket, {
      id: 'replay-unknown',
      cmd: 'terminal.replay',
      args: { sessionId: 'missing-session' },
    });

    expect(response).toEqual({
      id: 'replay-unknown',
      ok: true,
      data: { status: 'unknown', sessionId: 'missing-session' },
    });
  });

  it('resumes an ended session through websocket command', async () => {
    const spawnOptions: SpawnOptions[] = [];
    const provider: AgentProvider = {
      name: 'mock',
      async spawn(
        _sessionId: string,
        options: SpawnOptions,
        _onOutput: (data: string) => void = () => {},
      ) {
        spawnOptions.push(options);
        return {
          pid: 456,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await manager.killSession(session.id);

    const response = await handler.handle({} as WebSocket, {
      id: 'resume-1',
      cmd: 'session.resume',
      args: { sessionId: session.id, cwd: '/tmp', cols: 132, rows: 41 },
    });

    expect(response).toEqual({
      id: 'resume-1',
      ok: true,
      data: { sessionId: session.id },
    });
    expect(manager.getSession(session.id)?.status).toBe('running');
    expect(spawnOptions.at(-1)).toMatchObject({ cwd: '/tmp', cols: 132, rows: 41, resume: true });
  });

  it('clears stale Claude resume input before the first terminal input', async () => {
    const writes: string[] = [];
    const provider: AgentProvider = {
      name: 'mock',
      async spawn() {
        return {
          pid: 457,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: (data) => writes.push(data),
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await manager.killSession(session.id);
    await manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await handler.handle({} as WebSocket, {
      id: 'resume-input-1',
      cmd: 'terminal.input',
      args: { sessionId: session.id, data: '/' },
    });
    await handler.handle({} as WebSocket, {
      id: 'resume-input-2',
      cmd: 'terminal.input',
      args: { sessionId: session.id, data: 'theme\r' },
    });

    expect(writes).toEqual(['\x15/', 'theme\r']);
  });

  it('does not attach stale Claude resume cleanup to a standalone escape key', async () => {
    const writes: string[] = [];
    const provider: AgentProvider = {
      name: 'mock',
      async spawn() {
        return {
          pid: 458,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: (data) => writes.push(data),
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await manager.killSession(session.id);
    await manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await handler.handle({} as WebSocket, {
      id: 'resume-escape',
      cmd: 'terminal.input',
      args: { sessionId: session.id, data: '\x1b' },
    });
    await handler.handle({} as WebSocket, {
      id: 'resume-slash',
      cmd: 'terminal.input',
      args: { sessionId: session.id, data: '/' },
    });

    expect(writes).toEqual(['\x1b', '\x15/']);
  });

  it('drops xterm focus events before the first real resumed terminal input', async () => {
    const writes: string[] = [];
    const provider: AgentProvider = {
      name: 'mock',
      async spawn() {
        return {
          pid: 459,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: (data) => writes.push(data),
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await manager.killSession(session.id);
    await manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    await handler.handle({} as WebSocket, {
      id: 'resume-focus-in',
      cmd: 'terminal.input',
      args: { sessionId: session.id, data: '\x1b[I' },
    });
    await handler.handle({} as WebSocket, {
      id: 'resume-focus-out-slash',
      cmd: 'terminal.input',
      args: { sessionId: session.id, data: '\x1b[O/' },
    });

    expect(writes).toEqual(['\x15/']);
  });

  it('starts a session with requested terminal dimensions', async () => {
    const spawnOptions: SpawnOptions[] = [];
    const provider: AgentProvider = {
      name: 'mock',
      async spawn(
        _sessionId: string,
        options: SpawnOptions,
        _onOutput: (data: string) => void = () => {},
      ) {
        spawnOptions.push(options);
        return {
          pid: 654,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

    const response = await handler.handle({} as WebSocket, {
      id: 'start-sized',
      cmd: 'session.start',
      args: { sessionId: session.id, cwd: '/tmp', cols: 142, rows: 53 },
    });

    expect(response).toEqual({ id: 'start-sized', ok: true, data: { sessionId: session.id } });
    expect(spawnOptions.at(0)).toMatchObject({ cwd: '/tmp', cols: 142, rows: 53 });
  });

  it('normalizes terminal resize dimensions before resizing the process', async () => {
    const resizes: Array<{ cols: number; rows: number }> = [];
    const provider: AgentProvider = {
      name: 'mock',
      async spawn() {
        return {
          pid: 656,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: (cols, rows) => resizes.push({ cols, rows }),
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    const response = await handler.handle({} as WebSocket, {
      id: 'resize-normalized',
      cmd: 'terminal.resize',
      args: { sessionId: session.id, cols: 8.9, rows: 1.2 },
    });

    expect(response).toEqual({ id: 'resize-normalized', ok: true });
    expect(resizes).toEqual([{ cols: 20, rows: 5 }]);
  });

  it('subscribes the starting websocket before the first terminal output', async () => {
    const sent: unknown[] = [];
    const ws = {
      readyState: 1,
      send: (message: string) => sent.push(JSON.parse(message)),
    } as unknown as WebSocket;
    const provider: AgentProvider = {
      name: 'mock',
      async spawn(
        sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        onOutput(`first output for ${sessionId}`);
        return {
          pid: 655,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    hub.addClient(ws);
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

    const response = await handler.handle(ws, {
      id: 'start-streaming',
      cmd: 'session.start',
      args: { sessionId: session.id, cwd: '/tmp', cols: 80, rows: 24 },
    });

    expect(response).toEqual({ id: 'start-streaming', ok: true, data: { sessionId: session.id } });
    const data = `first output for ${session.id}`;
    expect(sent).toContainEqual({
      evt: 'terminal.output',
      data: { sessionId: session.id, data, seqStart: 0, seq: Buffer.byteLength(data, 'utf8') },
    });
  });

  it('reconciles live terminal recovery over websocket', async () => {
    const provider: AgentProvider = {
      name: 'reconcile',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        queueMicrotask(() => onOutput('abc'));
        return {
          pid: 991,
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
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'reconcile' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await handler.handle({} as WebSocket, {
      id: 'recover-1',
      cmd: 'recovery.reconcile',
      args: { sessionId: session.id, renderedSeq: 0 },
    });

    expect(response).toEqual({
      id: 'recover-1',
      ok: true,
      data: { action: 'snapshot', sessionId: session.id, headSeq: 3 },
    });
  });

  it('returns a live terminal snapshot over websocket', async () => {
    const provider: AgentProvider = {
      name: 'snapshot',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        queueMicrotask(() => onOutput('snapshot payload'));
        return {
          pid: 992,
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
    await manager.startSession(session.id, { cwd: '/tmp', cols: 100, rows: 30 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await handler.handle({} as WebSocket, {
      id: 'snapshot-1',
      cmd: 'terminal.snapshot',
      args: { sessionId: session.id },
    });

    expect(response).toMatchObject({
      id: 'snapshot-1',
      ok: true,
      data: {
        status: 'ok',
        sessionId: session.id,
        seq: Buffer.byteLength('snapshot payload', 'utf8'),
        cols: 100,
        rows: 30,
      },
    });
    expect((response.data as { data?: string }).data).toContain('snapshot payload');
  });

  it('returns canonical live terminal snapshot geometry when websocket dimensions are requested', async () => {
    const provider: AgentProvider = {
      name: 'sized-snapshot',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        queueMicrotask(() => onOutput('mobile snapshot payload'));
        return {
          pid: 993,
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await handler.handle({} as WebSocket, {
      id: 'snapshot-sized',
      cmd: 'terminal.snapshot',
      args: { sessionId: session.id, cols: 44, rows: 18 },
    });

    expect(response).toMatchObject({
      id: 'snapshot-sized',
      ok: true,
      data: {
        status: 'ok',
        sessionId: session.id,
        seq: Buffer.byteLength('mobile snapshot payload', 'utf8'),
        cols: 120,
        rows: 40,
      },
    });
  });

  it('updates session title from the first terminal input and broadcasts it', async () => {
    const writes: string[] = [];
    const provider: AgentProvider = {
      name: 'mock',
      async spawn() {
        return {
          pid: 789,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: (data) => writes.push(data),
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    const sent: unknown[] = [];
    const ws = {
      readyState: 1,
      send: (message: string) => sent.push(JSON.parse(message)),
    } as unknown as WebSocket;
    hub.addClient(ws);
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    const response = await handler.handle(ws, {
      id: 'input-title',
      cmd: 'terminal.input',
      args: { sessionId: session.id, data: 'Build pinyin flashcards\r' },
    });

    expect(response).toEqual({ id: 'input-title', ok: true });
    expect(writes).toEqual(['Build pinyin flashcards\r']);
    expect(manager.getSession(session.id)?.title).toBe('Build pinyin flashcards');
    expect(sent).toContainEqual({
      evt: 'session.updated',
      data: expect.objectContaining({
        id: session.id,
        title: 'Build pinyin flashcards',
      }),
    });
  });
});
