import type { UserConfig } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(): Promise<UserConfig> {
  vi.resetModules();
  const configModule = await import('../vite.config.js');
  return configModule.default as UserConfig;
}

describe('vite dev server config', () => {
  const previousWebPort = process.env.CUBBY_WEB_PORT;
  const previousBackendPort = process.env.CUBBY_DEV_BACKEND_PORT;

  afterEach(() => {
    if (previousWebPort === undefined) {
      delete process.env.CUBBY_WEB_PORT;
    } else {
      process.env.CUBBY_WEB_PORT = previousWebPort;
    }
    if (previousBackendPort === undefined) {
      delete process.env.CUBBY_DEV_BACKEND_PORT;
    } else {
      process.env.CUBBY_DEV_BACKEND_PORT = previousBackendPort;
    }
  });

  it('keeps the dev browser entrypoint on 6310 by default', async () => {
    delete process.env.CUBBY_WEB_PORT;
    delete process.env.CUBBY_DEV_BACKEND_PORT;

    const config = await loadConfig();

    expect(config.server?.port).toBe(6310);
    expect(config.server?.proxy?.['/api']).toMatchObject({ target: 'http://localhost:6300' });
    expect(config.server?.proxy?.['/ws']).toMatchObject({
      target: 'http://localhost:6300',
      ws: true,
    });
  });

  it('uses explicit dev-only port overrides for the web server and backend proxy', async () => {
    process.env.CUBBY_WEB_PORT = '7310';
    process.env.CUBBY_DEV_BACKEND_PORT = '7300';

    const config = await loadConfig();

    expect(config.server?.port).toBe(7310);
    expect(config.server?.proxy?.['/api']).toMatchObject({ target: 'http://localhost:7300' });
    expect(config.server?.proxy?.['/ws']).toMatchObject({
      target: 'http://localhost:7300',
      ws: true,
    });
  });

  it('falls back to the stable dev defaults when port overrides are invalid', async () => {
    process.env.CUBBY_WEB_PORT = 'not-a-port';
    process.env.CUBBY_DEV_BACKEND_PORT = '99999';

    const config = await loadConfig();

    expect(config.server?.port).toBe(6310);
    expect(config.server?.proxy?.['/api']).toMatchObject({ target: 'http://localhost:6300' });
  });
});
