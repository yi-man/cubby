import { describe, expect, it } from 'vitest';
import { OpenCodeProvider } from './opencode.js';

describe('OpenCodeProvider', () => {
  it('has correct name and detects mapped conversations', () => {
    const provider = new OpenCodeProvider();

    expect(provider.name).toBe('opencode');
    expect(provider.supportsResume).toBe(true);
    expect(provider.hasConversation('session-1', '/tmp')).toBe(false);
    expect(provider.hasConversation('session-1', '/tmp', 'opencode-session-1')).toBe(true);
    expect(provider.getTranscriptHistory('session-1', '/tmp')).toEqual([]);
  });

  it('builds interactive args with cwd and model', () => {
    const provider = new OpenCodeProvider();

    const args = provider.buildArgs({ cwd: '/tmp/project', model: 'anthropic/claude-sonnet-4' });

    expect(args).toEqual(['/tmp/project', '--model', 'anthropic/claude-sonnet-4']);
  });

  it('builds resume args with a mapped provider session id', () => {
    const provider = new OpenCodeProvider();

    const args = provider.buildArgs({
      cwd: '/tmp/project',
      model: 'anthropic/claude-sonnet-4',
      resume: true,
      providerSessionId: 'opencode-session-1',
    });

    expect(args).toEqual([
      '--session',
      'opencode-session-1',
      '/tmp/project',
      '--model',
      'anthropic/claude-sonnet-4',
    ]);
  });

  it('spawns opencode in a pty and forwards terminal io', async () => {
    const dataListeners: ((data: string) => void)[] = [];
    const exitListeners: ((event: { exitCode: number; signal?: string }) => void)[] = [];
    const writes: string[] = [];
    const resizes: { cols: number; rows: number }[] = [];
    const kills: string[] = [];
    const calls: unknown[] = [];

    const provider = new OpenCodeProvider({
      spawn: (file, args, options) => {
        calls.push({ file, args, options });
        return {
          pid: 5432,
          onData: (listener) => {
            dataListeners.push(listener);
            return { dispose: () => {} };
          },
          onExit: (listener) => {
            exitListeners.push(listener);
            return { dispose: () => {} };
          },
          write: (data) => writes.push(data),
          resize: (cols, rows) => resizes.push({ cols, rows }),
          kill: (signal = 'SIGTERM') => kills.push(signal),
        };
      },
    });

    const outputs: string[] = [];
    const exits: number[] = [];
    const process = await provider.spawn(
      'session-1',
      { cwd: '/tmp/project', cols: 100, rows: 40, env: { CUSTOM_ENV: '1', TERM: 'dumb' } },
      (data) => outputs.push(data),
      (code) => exits.push(code),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      file: 'opencode',
      args: ['/tmp/project'],
      options: {
        cwd: '/tmp/project',
        cols: 100,
        rows: 40,
        env: {
          CUSTOM_ENV: '1',
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          FORCE_COLOR: '3',
        },
      },
    });

    dataListeners[0]?.('hello');
    expect(outputs).toEqual(['hello']);
    expect(process.ringBuffer.getAll()).toEqual(['hello']);

    process.write('input');
    process.resize(120, 50);
    process.kill();
    exitListeners[0]?.({ exitCode: 7 });

    expect(writes).toEqual(['input']);
    expect(resizes).toEqual([{ cols: 120, rows: 50 }]);
    expect(kills).toEqual(['SIGTERM']);
    expect(exits).toEqual([7]);
  });

  it('spawns opencode resume with the mapped provider session id', async () => {
    const calls: unknown[] = [];
    const provider = new OpenCodeProvider({
      spawn: (file, args, options) => {
        calls.push({ file, args, options });
        return {
          pid: 5433,
          onData: () => ({ dispose: () => {} }),
          onExit: () => ({ dispose: () => {} }),
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
    });

    await provider.spawn('session-1', {
      cwd: '/tmp/project',
      cols: 100,
      rows: 40,
      resume: true,
      providerSessionId: 'opencode-session-1',
    });

    expect(calls[0]).toMatchObject({
      file: 'opencode',
      args: ['--session', 'opencode-session-1', '/tmp/project'],
    });
  });
});
