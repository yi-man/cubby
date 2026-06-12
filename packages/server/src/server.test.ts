import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WS_EVENTS } from '@cubby/core';
import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
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

async function postJson<T>(
  port: number,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

async function login(port: number, password: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  expect(response.ok).toBe(true);
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  return cookie ?? '';
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
    });
  });
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

async function waitForPersistedSessionReview(
  dbPath: string,
  sessionId: string,
  timeoutMs = 2000,
): Promise<unknown> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    const db = new Database(dbPath);
    const store = new SessionStore(db);
    try {
      const review = store.getSessionReview(sessionId);
      if (review) return review;
    } catch (err) {
      lastError = err;
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for persisted session review: ${String(lastError)}`);
}

describe('createServer', () => {
  const previousDataDir = process.env.CUBBY_DATA_DIR;
  const previousMockClaudeProvider = process.env.CUBBY_MOCK_CLAUDE_PROVIDER;
  const previousMockCodexProvider = process.env.CUBBY_MOCK_CODEX_PROVIDER;
  const previousMockOpenCodeProvider = process.env.CUBBY_MOCK_OPENCODE_PROVIDER;
  const previousAuthPassword = process.env.CUBBY_AUTH_PASSWORD;
  const previousAuthPasswordHash = process.env.CUBBY_AUTH_PASSWORD_HASH;
  const previousAllowedOrigins = process.env.CUBBY_ALLOWED_ORIGINS;
  const dataDirs: string[] = [];

  function useTempDataDir(prefix = 'cubby-server-'): string {
    const dataDir = mkdtempSync(join(tmpdir(), prefix));
    dataDirs.push(dataDir);
    process.env.CUBBY_DATA_DIR = dataDir;
    return dataDir;
  }

  beforeEach(() => {
    useTempDataDir();
  });

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
    if (previousAuthPassword === undefined) {
      delete process.env.CUBBY_AUTH_PASSWORD;
    } else {
      process.env.CUBBY_AUTH_PASSWORD = previousAuthPassword;
    }
    if (previousAuthPasswordHash === undefined) {
      delete process.env.CUBBY_AUTH_PASSWORD_HASH;
    } else {
      process.env.CUBBY_AUTH_PASSWORD_HASH = previousAuthPasswordHash;
    }
    if (previousAllowedOrigins === undefined) {
      delete process.env.CUBBY_ALLOWED_ORIGINS;
    } else {
      process.env.CUBBY_ALLOWED_ORIGINS = previousAllowedOrigins;
    }

    for (const dataDir of dataDirs.splice(0)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('stores runtime data in CUBBY_DATA_DIR when configured', async () => {
    const dataDir = useTempDataDir();

    const { app } = await createServer(0);
    await app.ready();
    await app.close();

    expect(existsSync(join(dataDir, 'cubby.db'))).toBe(true);
  });

  it('keeps auth disabled when no password is configured', async () => {
    const { app } = await createServer(0);

    const statusResponse = await app.inject({ method: 'GET', url: '/auth/status' });
    const sessionsResponse = await app.inject({ method: 'GET', url: '/api/sessions' });
    await app.close();

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({ enabled: false, authenticated: true });
    expect(sessionsResponse.statusCode).toBe(200);
  });

  it('returns runtime diagnostics through the HTTP API', async () => {
    const { app } = await createServer(0);

    const response = await app.inject({ method: 'GET', url: '/api/diagnostics/runtime' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      server: {
        dataDir: process.env.CUBBY_DATA_DIR,
      },
    });
    expect(response.json().checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining([
        'tool.git',
        'tool.node',
        'tool.bun',
        'dataDir.writable',
        'disk.free',
        'remote.bind',
        'remote.auth',
      ]),
    );
  });

  it('requires login for protected HTTP routes when password auth is configured', async () => {
    process.env.CUBBY_AUTH_PASSWORD = 'correct horse battery staple';
    const { app } = await createServer(0);

    const blockedResponse = await app.inject({ method: 'GET', url: '/api/sessions' });
    const wrongLoginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'wrong' },
    });
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'correct horse battery staple' },
    });
    const cookie = loginResponse.headers['set-cookie'];
    const authenticatedResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) },
    });
    await app.close();

    expect(blockedResponse.statusCode).toBe(401);
    expect(blockedResponse.json()).toEqual({ error: 'Authentication required' });
    expect(wrongLoginResponse.statusCode).toBe(401);
    expect(wrongLoginResponse.json()).toEqual({ error: 'Invalid password' });
    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json()).toEqual({ ok: true });
    expect(cookie).toBeTruthy();
    expect(authenticatedResponse.statusCode).toBe(200);
  });

  it('requires login when password auth is configured in config.json', async () => {
    const dataDir = useTempDataDir();
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({
        auth: { passwordHash: bcrypt.hashSync('config-secret', 10) },
      }),
    );
    const { app } = await createServer(0);

    const blockedResponse = await app.inject({ method: 'GET', url: '/api/sessions' });
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'config-secret' },
    });
    const cookie = loginResponse.headers['set-cookie'];
    const authenticatedResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) },
    });
    await app.close();

    expect(blockedResponse.statusCode).toBe(401);
    expect(loginResponse.statusCode).toBe(200);
    expect(authenticatedResponse.statusCode).toBe(200);
  });

  it('reports authenticated status from the Cubby auth cookie', async () => {
    process.env.CUBBY_AUTH_PASSWORD = 'status-secret';
    const { app } = await createServer(0);

    const beforeLoginResponse = await app.inject({ method: 'GET', url: '/auth/status' });
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'status-secret' },
    });
    const cookie = loginResponse.headers['set-cookie'];
    const afterLoginResponse = await app.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) },
    });
    await app.close();

    expect(beforeLoginResponse.json()).toEqual({ enabled: true, authenticated: false });
    expect(afterLoginResponse.json()).toEqual({ enabled: true, authenticated: true });
  });

  it('temporarily blocks repeated failed login attempts', async () => {
    process.env.CUBBY_AUTH_PASSWORD = 'lockout-secret';
    const { app } = await createServer(0);

    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { password: 'wrong' },
      });
      expect(response.statusCode).toBe(401);
    }

    const blockedResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'lockout-secret' },
    });
    await app.close();

    expect(blockedResponse.statusCode).toBe(429);
    expect(blockedResponse.json()).toEqual({ error: 'Too many failed login attempts' });
  });

  it('rejects requests from origins outside the allowlist', async () => {
    process.env.CUBBY_ALLOWED_ORIGINS = 'https://trusted.example';
    const { app } = await createServer(0);

    const rejectedResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { origin: 'https://untrusted.example' },
    });
    const acceptedResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { origin: 'https://trusted.example' },
    });
    await app.close();

    expect(rejectedResponse.statusCode).toBe(403);
    expect(rejectedResponse.json()).toEqual({ error: 'Origin is not allowed' });
    expect(acceptedResponse.statusCode).toBe(200);
  });

  it('rejects websocket connections without an auth cookie when password auth is configured', async () => {
    process.env.CUBBY_AUTH_PASSWORD = 'websocket-secret';
    const { app } = await createServer(0);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

    const result = await new Promise<{ opened: boolean; statusCode?: number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      ws.once('open', () => {
        ws.close();
        resolve({ opened: true });
      });
      ws.once('unexpected-response', (_request, response) => {
        resolve({ opened: false, statusCode: response.statusCode });
      });
      ws.once('error', () => {
        resolve({ opened: false });
      });
    });
    await app.close();

    expect(result).toEqual({ opened: false, statusCode: 401 });
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

  it('browses directories inside a workspace root', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-workspace-'));
    dataDirs.push(workspaceDir);
    mkdirSync(join(workspaceDir, 'src'));
    writeFileSync(join(workspaceDir, 'README.md'), '# Cubby\n');
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/browse?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        workspaceDir,
      )}`,
    });
    const body = response.json();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(body.path).toBe(realpathSync(workspaceDir));
    expect(body.root).toBe(realpathSync(workspaceDir));
    expect(body.entries).toEqual([
      expect.objectContaining({ name: 'src', isDir: true }),
      expect.objectContaining({ name: 'README.md', isDir: false, previewable: true }),
    ]);
  });

  it('rejects workspace browsing outside the root', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-workspace-'));
    dataDirs.push(workspaceDir);
    const outsideDir = mkdtempSync(join(tmpdir(), 'cubby-outside-'));
    dataDirs.push(outsideDir);
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/browse?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        outsideDir,
      )}`,
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Path is outside workspace root' });
  });

  it('does not expose workspace intelligence', async () => {
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: '/api/workspace/intelligence',
    });
    await app.close();

    expect(response.statusCode).toBe(404);
  });

  it('registers workspace preview port discovery routes', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-preview-workspace-'));
    dataDirs.push(workspaceDir);
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/previews?root=${encodeURIComponent(workspaceDir)}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      root: realpathSync(workspaceDir),
      ports: expect.any(Array),
    });
  });

  it('reads a text file inside a workspace root', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-workspace-'));
    dataDirs.push(workspaceDir);
    const filePath = join(workspaceDir, 'notes.txt');
    writeFileSync(filePath, 'hello workspace\n');
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/file?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        filePath,
      )}`,
    });
    const body = response.json();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      path: realpathSync(filePath),
      content: 'hello workspace\n',
      truncated: false,
    });
  });

  it('searches text files inside a workspace root and reports path matches', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-search-workspace-'));
    dataDirs.push(workspaceDir);
    mkdirSync(join(workspaceDir, 'src'));
    mkdirSync(join(workspaceDir, 'node_modules'));
    writeFileSync(join(workspaceDir, 'README.md'), '# Cubby\n\nSearchable roadmap note.\n');
    writeFileSync(join(workspaceDir, 'src/app.ts'), 'export const marker = "roadmap";\n');
    writeFileSync(join(workspaceDir, 'src/quick-open.ts'), 'export const value = 1;\n');
    writeFileSync(join(workspaceDir, 'node_modules/skip.ts'), 'roadmap should be skipped\n');
    const { app } = await createServer(0);

    const contentResponse = await app.inject({
      method: 'GET',
      url: `/api/workspace/search?root=${encodeURIComponent(workspaceDir)}&query=${encodeURIComponent(
        'roadmap',
      )}`,
    });
    const pathResponse = await app.inject({
      method: 'GET',
      url: `/api/workspace/search?root=${encodeURIComponent(workspaceDir)}&query=${encodeURIComponent(
        'quick',
      )}`,
    });
    await app.close();

    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.json()).toEqual({
      root: realpathSync(workspaceDir),
      query: 'roadmap',
      truncated: false,
      results: [
        {
          path: 'README.md',
          absolutePath: realpathSync(join(workspaceDir, 'README.md')),
          line: 3,
          column: 12,
          excerpt: 'Searchable roadmap note.',
          matchType: 'content',
        },
        {
          path: 'src/app.ts',
          absolutePath: realpathSync(join(workspaceDir, 'src/app.ts')),
          line: 1,
          column: 24,
          excerpt: 'export const marker = "roadmap";',
          matchType: 'content',
        },
      ],
    });
    expect(pathResponse.statusCode).toBe(200);
    expect(pathResponse.json()).toMatchObject({
      root: realpathSync(workspaceDir),
      query: 'quick',
      truncated: false,
      results: [
        {
          path: 'src/quick-open.ts',
          absolutePath: realpathSync(join(workspaceDir, 'src/quick-open.ts')),
          line: 1,
          column: 1,
          excerpt: 'src/quick-open.ts',
          matchType: 'path',
        },
      ],
    });
  });

  it('serves image previews inside a workspace root', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-image-workspace-'));
    dataDirs.push(workspaceDir);
    const filePath = join(workspaceDir, 'logo.png');
    writeFileSync(
      filePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/file/raw?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        filePath,
      )}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(Buffer.from(response.rawPayload).length).toBeGreaterThan(0);
  });

  it('rejects binary file previews', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-workspace-'));
    dataDirs.push(workspaceDir);
    const filePath = join(workspaceDir, 'image.bin');
    writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/file?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        filePath,
      )}`,
    });
    await app.close();

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({ error: 'File is not previewable' });
  });

  it('returns git status for a workspace repository', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-workspace-'));
    dataDirs.push(workspaceDir);
    mkdirSync(join(workspaceDir, 'src'));
    writeFileSync(join(workspaceDir, 'src/app.ts'), 'export const value = 1;\n');
    await runGit(workspaceDir, ['init']);
    await runGit(workspaceDir, ['config', 'user.email', 'cubby@example.test']);
    await runGit(workspaceDir, ['config', 'user.name', 'Cubby Test']);
    await runGit(workspaceDir, ['add', '.']);
    await runGit(workspaceDir, ['commit', '-m', 'initial']);
    writeFileSync(join(workspaceDir, 'src/app.ts'), 'export const value = 2;\n');
    writeFileSync(join(workspaceDir, 'src/new.ts'), 'export const fresh = true;\n');
    mkdirSync(join(workspaceDir, 'scratch'));
    writeFileSync(join(workspaceDir, 'scratch/notes.txt'), 'untracked notes\n');
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/status?root=${encodeURIComponent(workspaceDir)}`,
    });
    const body = response.json();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(body.isRepo).toBe(true);
    expect(body.branch).toBeTruthy();
    expect(body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/app.ts', status: 'M' }),
        expect.objectContaining({ path: 'src/new.ts', status: '??' }),
        expect.objectContaining({ path: 'scratch/notes.txt', status: '??' }),
      ]),
    );
    expect(body.entries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'scratch/' })]),
    );
  });

  it('returns a git diff for tracked workspace changes', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-diff-'));
    dataDirs.push(workspaceDir);
    writeFileSync(join(workspaceDir, 'app.ts'), 'export const value = 1;\n');
    await runGit(workspaceDir, ['init']);
    await runGit(workspaceDir, ['config', 'user.email', 'cubby@example.test']);
    await runGit(workspaceDir, ['config', 'user.name', 'Cubby Test']);
    await runGit(workspaceDir, ['add', '.']);
    await runGit(workspaceDir, ['commit', '-m', 'initial']);
    writeFileSync(join(workspaceDir, 'app.ts'), 'export const value = 2;\n');
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/diff?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        'app.ts',
      )}`,
    });
    const body = response.json();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ path: 'app.ts', mode: 'diff', language: 'diff' });
    expect(body.content).toContain('-export const value = 1;');
    expect(body.content).toContain('+export const value = 2;');
  });

  it('returns content for untracked git files', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-untracked-'));
    dataDirs.push(workspaceDir);
    await runGit(workspaceDir, ['init']);
    writeFileSync(join(workspaceDir, 'notes.txt'), 'untracked notes\n');
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/diff?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        'notes.txt',
      )}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      path: 'notes.txt',
      mode: 'content',
      content: 'untracked notes\n',
      language: 'plaintext',
    });
  });

  it('returns binary metadata for untracked git images', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-image-'));
    dataDirs.push(workspaceDir);
    await runGit(workspaceDir, ['init']);
    writeFileSync(
      join(workspaceDir, 'logo.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/diff?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        'logo.png',
      )}`,
    });
    const body = response.json();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      path: 'logo.png',
      mode: 'binary',
      content: '',
      language: 'plaintext',
      mimeType: 'image/png',
    });
    expect(body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('returns a non-repo git status for ordinary directories', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-non-git-'));
    dataDirs.push(workspaceDir);
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/status?root=${encodeURIComponent(workspaceDir)}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isRepo: false, branch: null, entries: [] });
  });

  it('rejects git diff paths outside the workspace root', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-safe-'));
    dataDirs.push(workspaceDir);
    const outsideDir = mkdtempSync(join(tmpdir(), 'cubby-git-outside-'));
    dataDirs.push(outsideDir);
    writeFileSync(join(outsideDir, 'outside.txt'), 'outside\n');
    await runGit(workspaceDir, ['init']);
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/diff?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        join(outsideDir, 'outside.txt'),
      )}`,
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Path is outside workspace root' });
  });

  it('marks persisted live sessions as ended on startup', async () => {
    const dataDir = useTempDataDir();
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

  it('creates HTTP sessions with a git baseline without exposing review or verification APIs', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-session-route-'));
    dataDirs.push(workspaceDir);
    writeFileSync(join(workspaceDir, 'README.md'), '# session\n');
    await runGit(workspaceDir, ['init']);
    await runGit(workspaceDir, ['config', 'user.email', 'cubby@example.test']);
    await runGit(workspaceDir, ['config', 'user.name', 'Cubby Test']);
    await runGit(workspaceDir, ['add', '.']);
    await runGit(workspaceDir, ['commit', '-m', 'initial']);
    const { app } = await createServer(0);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: workspaceDir, provider: 'claude-code', title: 'Session route' },
    });
    const session = createResponse.json();
    const reviewPostResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/review`,
    });
    const reviewGetResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/review`,
    });
    const verificationPostResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/verification-runs`,
      payload: { command: 'printf "api verification ok\\n"' },
    });
    const verificationGetResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/verification-runs`,
    });
    await app.close();

    expect(createResponse.statusCode).toBe(200);
    expect(session.baselineGitHead).toMatch(/^[0-9a-f]{40}$/);
    expect(reviewPostResponse.statusCode).toBe(404);
    expect(reviewGetResponse.statusCode).toBe(404);
    expect(verificationPostResponse.statusCode).toBe(404);
    expect(verificationGetResponse.statusCode).toBe(404);
  });

  it('generates a persisted session review when a session ends', async () => {
    const dataDir = useTempDataDir('cubby-session-review-ended-');
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-session-review-ended-workspace-'));
    dataDirs.push(workspaceDir);
    process.env.CUBBY_MOCK_CLAUDE_PROVIDER = '1';
    writeFileSync(join(workspaceDir, 'README.md'), '# review\n');
    await runGit(workspaceDir, ['init']);
    await runGit(workspaceDir, ['config', 'user.email', 'cubby@example.test']);
    await runGit(workspaceDir, ['config', 'user.name', 'Cubby Test']);
    await runGit(workspaceDir, ['add', '.']);
    await runGit(workspaceDir, ['commit', '-m', 'initial']);

    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: workspaceDir, provider: 'claude-code', title: 'Auto review' },
    });
    const session = createResponse.json();
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/start`,
      payload: { cwd: workspaceDir },
    });
    writeFileSync(join(workspaceDir, 'README.md'), '# review changed\n');

    const killResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/kill`,
    });
    const review = await waitForPersistedSessionReview(join(dataDir, 'cubby.db'), session.id);
    await app.close();

    expect(killResponse.statusCode).toBe(200);
    expect(review).toMatchObject({
      sessionId: session.id,
      baselineGitHead: session.baselineGitHead,
      changedFiles: [{ path: 'README.md', status: 'modified' }],
      summary: { total: 1, modified: 1 },
    });
  });

  it('manages supervisor objective and manual reviews through the HTTP API', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-supervisor-route-'));
    dataDirs.push(workspaceDir);
    writeFileSync(join(workspaceDir, 'README.md'), '# supervisor\n');
    await runGit(workspaceDir, ['init']);
    await runGit(workspaceDir, ['config', 'user.email', 'cubby@example.test']);
    await runGit(workspaceDir, ['config', 'user.name', 'Cubby Test']);
    await runGit(workspaceDir, ['add', '.']);
    await runGit(workspaceDir, ['commit', '-m', 'initial']);
    const { app } = await createServer(0);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: workspaceDir, provider: 'claude-code', title: 'Supervisor route' },
    });
    const session = createResponse.json();
    writeFileSync(join(workspaceDir, 'todo.txt'), 'review this\n');

    const objectiveResponse = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${session.id}/supervisor/objective`,
      payload: { objective: 'Finish the supervisor workflow' },
    });
    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/supervisor`,
    });
    const reviewResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/supervisor/reviews`,
    });
    const emptyObjectiveResponse = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${session.id}/supervisor/objective`,
      payload: { objective: '   ' },
    });
    await app.close();

    expect(objectiveResponse.statusCode).toBe(200);
    expect(objectiveResponse.json()).toMatchObject({
      sessionId: session.id,
      objective: 'Finish the supervisor workflow',
      status: 'watching',
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      sessionId: session.id,
      objective: 'Finish the supervisor workflow',
      reviews: [],
    });
    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json()).toMatchObject({
      sessionId: session.id,
      objective: 'Finish the supervisor workflow',
    });
    expect(reviewResponse.json().summary).toContain('Finish the supervisor workflow');
    expect(reviewResponse.json().summary).not.toContain('verification');
    expect(reviewResponse.json().suggestions).not.toContain(
      'Run a verification command before accepting the result.',
    );
    expect(
      reviewResponse
        .json()
        .suggestions.some((suggestion: string) => suggestion.includes('verification')),
    ).toBe(false);
    expect(reviewResponse.json().suggestions).toContain(
      'Inspect changed files against the objective before accepting.',
    );
    expect(emptyObjectiveResponse.statusCode).toBe(400);
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
    const dataDir = useTempDataDir();
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

  it('creates a default config and requires login when started from the entrypoint', async () => {
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
      },
      stdio: 'ignore',
    });

    try {
      await waitForServer(port);

      const statusResponse = await fetch(`http://127.0.0.1:${port}/auth/status`);
      const blockedResponse = await fetch(`http://127.0.0.1:${port}/api/sessions`);
      const cookie = await login(port, 'cubby');
      const authenticatedResponse = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        headers: { cookie },
      });

      expect(existsSync(join(dataDir, 'config.json'))).toBe(true);
      expect(existsSync(join(dataDir, 'initial-password.txt'))).toBe(false);
      expect(statusResponse.status).toBe(200);
      expect(await statusResponse.json()).toEqual({ enabled: true, authenticated: false });
      expect(blockedResponse.status).toBe(401);
      expect(authenticatedResponse.status).toBe(200);
    } finally {
      if (child.exitCode === null) {
        const exitPromise = waitForExit(child, 1000).catch(() => {});
        child.kill('SIGKILL');
        await exitPromise;
      }
    }
  }, 10000);

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
      const cookie = await login(port, 'cubby');
      const session = await postJson<SessionFixture>(
        port,
        '/api/sessions',
        {
          workspaceId: '/tmp',
          provider: 'claude-code',
          title: 'Signal Cleanup',
        },
        { cookie },
      );
      await postJson(port, `/api/sessions/${session.id}/start`, { cwd: '/tmp' }, { cookie });

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
