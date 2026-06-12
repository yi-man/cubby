import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRuntimeDiagnostics } from './runtime.js';

describe('runtime diagnostics', () => {
  it('checks tools, data directory, disk space, and remote access posture', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-diagnostics-'));
    const diagnostics = await readRuntimeDiagnostics(
      {
        dataDir,
        configPath: join(dataDir, 'config.json'),
        server: { host: '127.0.0.1', port: 6310 },
        auth: { allowedOrigins: [] },
      },
      {
        checkCommand: async (command) => {
          if (['git', 'node', 'bun'].includes(command)) {
            return { available: true, version: `${command} 1.0.0` };
          }
          return { available: false, error: `${command} missing` };
        },
        checkDiskSpace: async () => ({ availableBytes: 1024 * 1024 * 1024 }),
      },
    );

    expect(diagnostics.server).toMatchObject({
      host: '127.0.0.1',
      port: 6310,
      dataDir,
    });
    expect(diagnostics.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool.git',
          status: 'ok',
          label: 'git',
          detail: 'git 1.0.0',
        }),
        expect.objectContaining({
          id: 'tool.claude',
          status: 'warning',
          label: 'Claude Code',
          recommendation: 'Install the Claude Code CLI or remove it from your provider list.',
        }),
        expect.objectContaining({
          id: 'dataDir.writable',
          status: 'ok',
        }),
        expect.objectContaining({
          id: 'disk.free',
          status: 'ok',
        }),
        expect.objectContaining({
          id: 'remote.bind',
          status: 'warning',
          recommendation: 'Bind CUBBY_HOST=0.0.0.0 when you intentionally need remote access.',
        }),
      ]),
    );
    expect(diagnostics.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
