import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentProvider, SpawnOptions } from '@cubby/core';
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
      data: { sessionId: session.id, chunks: ['history chunk'] },
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

    expect(response).toEqual({
      id: 'replay-transcript',
      ok: true,
      data: {
        sessionId: session.id,
        chunks: [`transcript for ${session.id} in /tmp/transcript`, '\r\n'],
      },
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
