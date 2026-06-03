import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from './db/index.js';
import { createServer } from './server.js';
import { SessionStore } from './session/store.js';

describe('createServer', () => {
  const previousDataDir = process.env.CUBBY_DATA_DIR;
  const previousMockClaudeProvider = process.env.CUBBY_MOCK_CLAUDE_PROVIDER;
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
    const response = await app.inject({ method: 'GET', url: '/api/sessions' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toContainEqual(
      expect.objectContaining({ id: session.id, status: 'ended' }),
    );
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
});
