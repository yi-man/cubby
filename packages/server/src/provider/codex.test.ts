import { describe, expect, it } from 'vitest';
import { CodexProvider } from './codex.js';

describe('CodexProvider', () => {
  it('has correct name and detects mapped conversations', () => {
    const provider = new CodexProvider();

    expect(provider.name).toBe('codex');
    expect(provider.supportsResume).toBe(true);
    expect(provider.hasConversation('session-1', '/tmp')).toBe(false);
    expect(provider.hasConversation('session-1', '/tmp', 'codex-session-1')).toBe(true);
    expect(provider.getTranscriptHistory('session-1', '/tmp')).toEqual([]);
  });

  it('builds interactive args with cwd and model', () => {
    const provider = new CodexProvider();

    const args = provider.buildArgs({ cwd: '/tmp/project', model: 'gpt-5' });

    expect(args).toEqual(['--cd', '/tmp/project', '--model', 'gpt-5']);
  });

  it('builds resume args with a mapped provider session id', () => {
    const provider = new CodexProvider();

    const args = provider.buildArgs({
      cwd: '/tmp/project',
      model: 'gpt-5',
      resume: true,
      providerSessionId: 'codex-session-1',
    });

    expect(args).toEqual(['resume', '--cd', '/tmp/project', '--model', 'gpt-5', 'codex-session-1']);
  });

  it('spawns codex in a pty and forwards terminal io', async () => {
    const dataListeners: ((data: string) => void)[] = [];
    const exitListeners: ((event: { exitCode: number; signal?: string }) => void)[] = [];
    const writes: string[] = [];
    const resizes: { cols: number; rows: number }[] = [];
    const kills: string[] = [];
    const calls: unknown[] = [];

    const provider = new CodexProvider({
      spawn: (file, args, options) => {
        calls.push({ file, args, options });
        return {
          pid: 4321,
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
      file: 'codex',
      args: ['--cd', '/tmp/project'],
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

  it('spawns codex resume with the mapped provider session id', async () => {
    const calls: unknown[] = [];
    const provider = new CodexProvider({
      spawn: (file, args, options) => {
        calls.push({ file, args, options });
        return {
          pid: 4322,
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
      providerSessionId: 'codex-session-1',
    });

    expect(calls[0]).toMatchObject({
      file: 'codex',
      args: ['resume', '--cd', '/tmp/project', 'codex-session-1'],
    });
  });
});
