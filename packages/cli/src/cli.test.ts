import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.js';

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
  it('creates config.json with a password hash', async () => {
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
  });

  it('updates only the password hash while preserving existing server and origin settings', async () => {
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

    const exitCode = await runCli([`auth`, 'set-password', 'new-secret', `--data-dir=${dataDir}`], {
      io,
    });

    const config = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'));
    expect(exitCode).toBe(0);
    expect(config.server).toEqual({ host: '127.0.0.1', port: 7310 });
    expect(config.auth.allowedOrigins).toEqual(['https://cubby.example.com']);
    expect(await bcrypt.compare('old-secret', config.auth.passwordHash)).toBe(false);
    expect(await bcrypt.compare('new-secret', config.auth.passwordHash)).toBe(true);
  });

  it('preserves password whitespace exactly', async () => {
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
  });

  it('rejects set-password without a password', async () => {
    const { io, output } = createOutput();

    const exitCode = await runCli(['auth', 'set-password'], { io });

    expect(exitCode).toBe(1);
    expect(output().stderr).toContain('Usage: cubby auth set-password');
  });
});
