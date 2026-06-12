import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { closeServerWithTimeout, runCli } from './cli.js';

const AUTH_TEST_TIMEOUT_MS = 15_000;

function createOutput() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
          return true;
        },
      },
    },
    output: () => ({ stdout, stderr }),
  };
}

describe('cubby cli auth', () => {
  it(
    'creates config.json with a password hash',
    async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
      const { io, output } = createOutput();

      const exitCode = await runCli(['auth', 'set-password', 'new-secret', '--data-dir', dataDir], {
        io,
      });

      const config = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'));
      expect(exitCode).toBe(0);
      expect(config.server).toEqual({ host: '0.0.0.0', port: 6310 });
      expect(config.auth.allowedOrigins).toEqual([]);
      expect(config.auth.passwordHash).not.toBe('new-secret');
      expect(await bcrypt.compare('new-secret', config.auth.passwordHash)).toBe(true);
      expect(output().stdout).toContain('Restart Cubby');
    },
    AUTH_TEST_TIMEOUT_MS,
  );

  it(
    'updates only the password hash while preserving existing server and origin settings',
    async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
      writeFileSync(
        join(dataDir, 'config.json'),
        JSON.stringify({
          server: { host: '127.0.0.1', port: 7310 },
          auth: {
            passwordHash: bcrypt.hashSync('old-secret', 10),
            allowedOrigins: ['https://cubby.example.com'],
          },
        }),
      );
      const { io } = createOutput();

      const exitCode = await runCli(
        [`auth`, 'set-password', 'new-secret', `--data-dir=${dataDir}`],
        {
          io,
        },
      );

      const config = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'));
      expect(exitCode).toBe(0);
      expect(config.server).toEqual({ host: '127.0.0.1', port: 7310 });
      expect(config.auth.allowedOrigins).toEqual(['https://cubby.example.com']);
      expect(await bcrypt.compare('old-secret', config.auth.passwordHash)).toBe(false);
      expect(await bcrypt.compare('new-secret', config.auth.passwordHash)).toBe(true);
    },
    AUTH_TEST_TIMEOUT_MS,
  );

  it(
    'preserves password whitespace exactly',
    async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
      const { io } = createOutput();

      const exitCode = await runCli(
        ['auth', 'set-password', '  spaced secret  ', '--data-dir', dataDir],
        {
          io,
        },
      );

      const config = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'));
      expect(exitCode).toBe(0);
      expect(await bcrypt.compare('  spaced secret  ', config.auth.passwordHash)).toBe(true);
      expect(await bcrypt.compare('spaced secret', config.auth.passwordHash)).toBe(false);
    },
    AUTH_TEST_TIMEOUT_MS,
  );

  it('rejects set-password without a password', async () => {
    const { io, output } = createOutput();

    const exitCode = await runCli(['auth', 'set-password'], { io });

    expect(exitCode).toBe(1);
    expect(output().stderr).toContain('Usage: cubby auth set-password');
  });
});

describe('cubby cli config', () => {
  it('updates host, port, and allowed origins in config.json', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
    const { io } = createOutput();

    const hostExitCode = await runCli(
      ['config', 'set', 'host', '127.0.0.1', '--data-dir', dataDir],
      {
        io,
      },
    );
    const portExitCode = await runCli(['config', 'set', 'port', '7412', '--data-dir', dataDir], {
      io,
    });
    const originsExitCode = await runCli(
      [
        'config',
        'set',
        'allowed-origins',
        'https://one.example,https://two.example',
        '--data-dir',
        dataDir,
      ],
      { io },
    );

    const config = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'));
    expect(hostExitCode).toBe(0);
    expect(portExitCode).toBe(0);
    expect(originsExitCode).toBe(0);
    expect(config.server).toEqual({ host: '127.0.0.1', port: 7412 });
    expect(config.auth.allowedOrigins).toEqual(['https://one.example', 'https://two.example']);
  });

  it(
    'prints config values including data dir and auth status',
    async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
      writeFileSync(
        join(dataDir, 'config.json'),
        JSON.stringify({
          server: { host: '127.0.0.1', port: 7412 },
          auth: {
            passwordHash: bcrypt.hashSync('secret', 10),
            allowedOrigins: ['https://cubby.example.com'],
          },
        }),
      );
      const { io, output } = createOutput();

      const exitCode = await runCli(['config', 'show', '--data-dir', dataDir], { io });

      expect(exitCode).toBe(0);
      expect(output().stdout).toContain(`Data dir: ${dataDir}`);
      expect(output().stdout).toContain('Host: 127.0.0.1');
      expect(output().stdout).toContain('Port: 7412');
      expect(output().stdout).toContain('Auth: enabled');
      expect(output().stdout).toContain('Allowed origins: https://cubby.example.com');
    },
    AUTH_TEST_TIMEOUT_MS,
  );
});

describe('cubby cli service management', () => {
  it('starts the server in the background and writes pid metadata', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
    const { io, output } = createOutput();
    const spawned: Array<{
      command: string;
      args: string[];
      env: Record<string, string | undefined>;
    }> = [];

    const exitCode = await runCli(
      ['serve', '--data-dir', dataDir, '--host', '127.0.0.1', '--port', '7413'],
      {
        io,
        runtime: {
          spawnDetached: (command, args, options) => {
            spawned.push({ command, args, env: options.env });
            return { pid: 4242, unref: () => {} };
          },
          isProcessAlive: () => false,
          waitForHealthy: async () => true,
        },
      },
    );

    const pidFile = JSON.parse(readFileSync(join(dataDir, 'server.pid.json'), 'utf8'));
    expect(exitCode).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args).toContain('serve');
    expect(spawned[0]?.args).toContain('--foreground');
    expect(spawned[0]?.env.CUBBY_DATA_DIR).toBe(dataDir);
    expect(spawned[0]?.env.CUBBY_HOST).toBe('127.0.0.1');
    expect(spawned[0]?.env.CUBBY_PORT).toBe('7413');
    expect(pidFile).toMatchObject({ pid: 4242, host: '127.0.0.1', port: 7413, dataDir });
    expect(existsSync(join(dataDir, 'logs', 'server.out.log'))).toBe(true);
    expect(existsSync(join(dataDir, 'logs', 'server.err.log'))).toBe(true);
    expect(output().stdout).toContain('Cubby started');
  });

  it('starts the foreground server with Bun so agent PTY dependencies can load', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
    const { io } = createOutput();
    const spawned: Array<{ command: string; args: string[] }> = [];

    const exitCode = await runCli(['serve', '--data-dir', dataDir], {
      io,
      env: { CUBBY_BUN_PATH: '/opt/homebrew/bin/bun' },
      runtime: {
        spawnDetached: (command, args) => {
          spawned.push({ command, args });
          return { pid: 4242, unref: () => {} };
        },
        isProcessAlive: () => false,
        waitForHealthy: async () => true,
      },
    });

    expect(exitCode).toBe(0);
    expect(spawned[0]?.command).toBe('/opt/homebrew/bin/bun');
    expect(spawned[0]?.args).toContain('serve');
    expect(spawned[0]?.args).toContain('--foreground');
  });

  it('reports running status from pid metadata', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
    writeFileSync(
      join(dataDir, 'server.pid.json'),
      JSON.stringify({ pid: 4242, host: '127.0.0.1', port: 7413, dataDir }),
    );
    const { io, output } = createOutput();

    const exitCode = await runCli(['status', '--data-dir', dataDir], {
      io,
      runtime: { isProcessAlive: (pid) => pid === 4242 },
    });

    expect(exitCode).toBe(0);
    expect(output().stdout).toContain('Status: running');
    expect(output().stdout).toContain('PID: 4242');
    expect(output().stdout).toContain('Port: 7413');
    expect(output().stdout).toContain(`Data dir: ${dataDir}`);
  });

  it('stops a running background server and removes pid metadata', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
    writeFileSync(
      join(dataDir, 'server.pid.json'),
      JSON.stringify({ pid: 4242, host: '127.0.0.1', port: 7413, dataDir }),
    );
    const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const { io, output } = createOutput();

    const exitCode = await runCli(['stop', '--data-dir', dataDir], {
      io,
      runtime: {
        isProcessAlive: (pid) => pid === 4242,
        killProcess: (pid, signal) => {
          killed.push({ pid, signal });
        },
        waitForExit: async () => true,
      },
    });

    expect(exitCode).toBe(0);
    expect(killed).toEqual([{ pid: 4242, signal: 'SIGTERM' }]);
    expect(existsSync(join(dataDir, 'server.pid.json'))).toBe(false);
    expect(output().stdout).toContain('Cubby stopped');
  });

  it('prints tailed server logs and can limit output to errors', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
    const logsDir = join(dataDir, 'logs');
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({}));
    await runCli(['serve', '--data-dir', dataDir], {
      io: createOutput().io,
      runtime: {
        spawnDetached: () => ({ pid: 4242, unref: () => {} }),
        isProcessAlive: () => false,
        waitForHealthy: async () => true,
      },
    });
    writeFileSync(join(logsDir, 'server.out.log'), ['one', 'two', 'three'].join('\n'));
    writeFileSync(join(logsDir, 'server.err.log'), ['bad', 'worse'].join('\n'));
    const { io, output } = createOutput();

    const exitCode = await runCli(['logs', '--errors-only', '--tail', '1', '--data-dir', dataDir], {
      io,
    });

    expect(exitCode).toBe(0);
    expect(output().stdout).not.toContain('three');
    expect(output().stdout).not.toContain('bad');
    expect(output().stdout).toContain('worse');
  });

  it('opens the local browser after ensuring the service is running', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-cli-'));
    const openedUrls: string[] = [];
    const { io, output } = createOutput();

    const exitCode = await runCli(
      ['open', '--data-dir', dataDir, '--host', '127.0.0.1', '--port', '7414'],
      {
        io,
        runtime: {
          spawnDetached: () => ({ pid: 4242, unref: () => {} }),
          isProcessAlive: () => false,
          waitForHealthy: async () => true,
          openUrl: async (url) => {
            openedUrls.push(url);
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(openedUrls).toEqual(['http://127.0.0.1:7414']);
    expect(output().stdout).toContain('Opened http://127.0.0.1:7414');
  });

  it('lets foreground shutdown finish when app.close does not resolve', async () => {
    const { io, output } = createOutput();

    const exitCode = await closeServerWithTimeout(
      () => new Promise<void>(() => {}),
      'SIGTERM',
      io,
      1,
    );

    expect(exitCode).toBe(0);
    expect(output().stderr).toContain('Timed out closing Cubby server after SIGTERM');
  });
});
