import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WS_EVENTS } from '@cubby/core';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from './db/index.js';
import { registerRoutes } from './http/routes.js';
import { createServer } from './server.js';
import { SessionManager } from './session/manager.js';
import { SessionStore } from './session/store.js';

interface SessionFixture {
  id: string;
}

async function waitForServer(port: number): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become healthy: ${String(lastError)}`);
}

async function postJson<T>(port: number, path: string, payload?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

function waitForExit(
  child: ChildProcess,
  timeoutMs = 5000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out waiting for server process to exit'));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('createServer', () => {
  const previousDataDir = process.env.CUBBY_DATA_DIR;
  const previousMockClaudeProvider = process.env.CUBBY_MOCK_CLAUDE_PROVIDER;
  const previousMockCodexProvider = process.env.CUBBY_MOCK_CODEX_PROVIDER;
  const previousMockOpenCodeProvider = process.env.CUBBY_MOCK_OPENCODE_PROVIDER;
  const dataDirs: string[] = [];

  afterEach(() => {
    if (previousDataDir === undefined) {
      delete process.env.CUBBY_DATA_DIR;
    } else {
      process.env.CUBBY_DATA_DIR = previousDataDir;
    }
    if (previousMockClaudeProvider === undefined) {
      delete process.env.CUBBY_MOCK_CLAUDE_PROVIDER;
    } else {
      process.env.CUBBY_MOCK_CLAUDE_PROVIDER = previousMockClaudeProvider;
    }
    if (previousMockCodexProvider === undefined) {
      delete process.env.CUBBY_MOCK_CODEX_PROVIDER;
    } else {
      process.env.CUBBY_MOCK_CODEX_PROVIDER = previousMockCodexProvider;
    }
    if (previousMockOpenCodeProvider === undefined) {
      delete process.env.CUBBY_MOCK_OPENCODE_PROVIDER;
    } else {
      process.env.CUBBY_MOCK_OPENCODE_PROVIDER = previousMockOpenCodeProvider;
    }

    for (const dataDir of dataDirs.splice(0)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('stores runtime data in CUBBY_DATA_DIR when configured', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-server-'));
    dataDirs.push(dataDir);
    process.env.CUBBY_DATA_DIR = dataDir;

    const { app } = await createServer(0);
    await app.ready();
    await app.close();

    expect(existsSync(join(dataDir, 'cubby.db'))).toBe(true);
  });

  it('defaults workspace browsing to the user home directory', async () => {
    const { app } = await createServer(0);
    const response = await app.inject({ method: 'GET', url: '/api/browse' });
    const body = response.json();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(body.path).toBe(resolve(homedir()));
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('marks persisted live sessions as ended on startup', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-server-'));
    dataDirs.push(dataDir);
    process.env.CUBBY_DATA_DIR = dataDir;
    const db = new Database(join(dataDir, 'cubby.db'));
    const store = new SessionStore(db);
    const session = store.create({ workspaceId: '/tmp', provider: 'claude-code' });
    store.updateStatus(session.id, 'running');
    db.close();

    const { app } = await createServer(0);
    const getResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
    const listResponse = await app.inject({ method: 'GET', url: '/api/sessions' });
    await app.close();

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ id: session.id, status: 'ended' });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([]);
  });

  it('can start sessions with the mock Claude provider for CI E2E', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-server-'));
    dataDirs.push(dataDir);
    process.env.CUBBY_DATA_DIR = dataDir;
    process.env.CUBBY_MOCK_CLAUDE_PROVIDER = '1';

    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'claude-code', title: 'Mock Claude' },
    });
    const session = createResponse.json();

    const startResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/start`,
      payload: { cwd: '/tmp' },
    });
    const getResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });

    await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/kill` });
    await app.close();

    expect(startResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ id: session.id, status: 'running' });
  });

  it('can start sessions with the mock Codex provider for CI E2E', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-server-'));
    dataDirs.push(dataDir);
    process.env.CUBBY_DATA_DIR = dataDir;
    process.env.CUBBY_MOCK_CODEX_PROVIDER = '1';

    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'codex', title: 'Mock Codex' },
    });
    const session = createResponse.json();

    const startResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/start`,
      payload: { cwd: '/tmp' },
    });
    const getResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });

    await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/kill` });
    await app.close();

    expect(startResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ id: session.id, status: 'running' });
  });

  it('can start sessions with the mock OpenCode provider for CI E2E', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-server-'));
    dataDirs.push(dataDir);
    process.env.CUBBY_DATA_DIR = dataDir;
    process.env.CUBBY_MOCK_OPENCODE_PROVIDER = '1';

    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'opencode', title: 'Mock OpenCode' },
    });
    const session = createResponse.json();

    const startResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/start`,
      payload: { cwd: '/tmp' },
    });
    const getResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });

    await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/kill` });
    await app.close();

    expect(startResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ id: session.id, status: 'running' });
  });

  it('creates HTTP sessions with default and explicit yolo modes', async () => {
    const { app } = await createServer(0);

    const defaultResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'claude-code', title: 'Default yolo' },
    });
    const explicitResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        workspaceId: '/tmp',
        provider: 'claude-code',
        title: 'No yolo',
        yolo: false,
      },
    });
    await app.close();

    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toMatchObject({ title: 'Default yolo', yolo: true });
    expect(explicitResponse.statusCode).toBe(200);
    expect(explicitResponse.json()).toMatchObject({ title: 'No yolo', yolo: false });
  });

  it('renames a session through the HTTP API', async () => {
    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'claude-code', title: 'Draft' },
    });
    const session = createResponse.json();

    const renameResponse = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { title: '  Customer rollout  ' },
    });
    const getResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
    await app.close();

    expect(renameResponse.statusCode).toBe(200);
    expect(renameResponse.json()).toMatchObject({ id: session.id, title: 'Customer rollout' });
    expect(getResponse.json()).toMatchObject({ id: session.id, title: 'Customer rollout' });
  });

  it('broadcasts a session update when HTTP PATCH callbacks are passed', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-routes-'));
    dataDirs.push(dataDir);
    const db = new Database(join(dataDir, 'cubby.db'));
    const manager = new SessionManager(new SessionStore(db));
    const clientMessages: unknown[] = [];
    const app = Fastify();
    registerRoutes(app, manager, {
      onSessionUpdated: (session) => {
        clientMessages.push({ evt: WS_EVENTS.SESSION_UPDATED, data: session });
      },
    });
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'claude-code' });

    try {
      const renameResponse = await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${session.id}`,
        payload: { title: 'Broadcast title' },
      });

      expect(renameResponse.statusCode).toBe(200);
      expect(clientMessages).toEqual([
        {
          evt: WS_EVENTS.SESSION_UPDATED,
          data: expect.objectContaining({ id: session.id, title: 'Broadcast title' }),
        },
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('returns 400 when renaming a session to an empty title through the HTTP API', async () => {
    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'claude-code', title: 'Draft' },
    });
    const session = createResponse.json();

    const renameResponse = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { title: '   ' },
    });
    await app.close();

    expect(renameResponse.statusCode).toBe(400);
    expect(renameResponse.json()).toEqual({ error: 'Session title is required' });
  });

  it('deletes a session through the HTTP API', async () => {
    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'claude-code', title: 'Delete me' },
    });
    const session = createResponse.json();

    const beforeDeleteResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}`,
    });
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${session.id}`,
    });
    const afterDeleteResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}`,
    });
    await app.close();

    expect(beforeDeleteResponse.json()).toMatchObject({ id: session.id });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true, sessionId: session.id });
    expect(afterDeleteResponse.json()).toEqual({ error: 'Not found' });
  });

  it('deletes a session and broadcasts deletion when HTTP DELETE callbacks are passed', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-routes-'));
    dataDirs.push(dataDir);
    const db = new Database(join(dataDir, 'cubby.db'));
    const manager = new SessionManager(new SessionStore(db));
    const clientMessages: unknown[] = [];
    const app = Fastify();
    registerRoutes(app, manager, {
      onSessionDeleted: (sessionId) => {
        clientMessages.push({ evt: WS_EVENTS.SESSION_DELETED, data: { sessionId } });
      },
    });
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'claude-code',
      title: 'Delete me',
    });

    try {
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/sessions/${session.id}`,
      });

      expect(deleteResponse.statusCode).toBe(200);
      expect(manager.getSession(session.id)).toBeNull();
      expect(clientMessages).toEqual([
        {
          evt: WS_EVENTS.SESSION_DELETED,
          data: { sessionId: session.id },
        },
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('returns 404 when deleting a missing session through the HTTP API', async () => {
    const { app } = await createServer(0);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/api/sessions/missing-session',
    });
    await app.close();

    expect(deleteResponse.statusCode).toBe(404);
    expect(deleteResponse.json()).toEqual({ error: 'Not found' });
  });

  it('marks active sessions ended when the server closes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-server-'));
    dataDirs.push(dataDir);
    process.env.CUBBY_DATA_DIR = dataDir;
    process.env.CUBBY_MOCK_CLAUDE_PROVIDER = '1';

    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'claude-code', title: 'Close Cleanup' },
    });
    const session = createResponse.json();
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/start`,
      payload: { cwd: '/tmp' },
    });

    await app.close();

    const db = new Database(join(dataDir, 'cubby.db'));
    const store = new SessionStore(db);
    try {
      expect(store.get(session.id)).toMatchObject({ id: session.id, status: 'ended' });
    } finally {
      db.close();
    }
  });

  it('marks active sessions ended on SIGTERM when started from the entrypoint', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-server-'));
    dataDirs.push(dataDir);
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const child = spawn('bun', ['packages/server/src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CUBBY_HOST: '127.0.0.1',
        CUBBY_PORT: String(port),
        CUBBY_DATA_DIR: dataDir,
        CUBBY_MOCK_CLAUDE_PROVIDER: '1',
      },
      stdio: 'ignore',
    });

    try {
      await waitForServer(port);
      const session = await postJson<SessionFixture>(port, '/api/sessions', {
        workspaceId: '/tmp',
        provider: 'claude-code',
        title: 'Signal Cleanup',
      });
      await postJson(port, `/api/sessions/${session.id}/start`, { cwd: '/tmp' });

      const exitPromise = waitForExit(child);
      child.kill('SIGTERM');
      const exit = await exitPromise;

      const db = new Database(join(dataDir, 'cubby.db'));
      const store = new SessionStore(db);
      try {
        expect(exit).toEqual({ code: 0, signal: null });
        expect(store.get(session.id)).toMatchObject({ id: session.id, status: 'ended' });
      } finally {
        db.close();
      }
    } finally {
      if (child.exitCode === null) {
        const exitPromise = waitForExit(child, 1000).catch(() => {});
        child.kill('SIGKILL');
        await exitPromise;
      }
    }
  }, 10000);
});
