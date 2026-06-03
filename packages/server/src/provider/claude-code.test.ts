import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from './claude-code.js';

describe('ClaudeCodeProvider', () => {
  it('has correct name', () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.name).toBe('claude-code');
  });

  it('builds correct command args with model', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({ model: 'sonnet' });
    expect(args).toEqual(['--model', 'sonnet']);
  });

  it('builds interactive args without print mode', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({});
    expect(args).toEqual([]);
  });

  it('binds a new Claude conversation to the Cubby session id', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({ sessionId: '00000000-0000-4000-8000-000000000001' });
    expect(args).toEqual(['--session-id', '00000000-0000-4000-8000-000000000001']);
  });

  it('builds resume args for an ended session', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({
      resume: true,
      sessionId: '00000000-0000-4000-8000-000000000001',
    });
    expect(args).toEqual(['--resume', '00000000-0000-4000-8000-000000000001']);
  });

  it('spawns claude in a pty and forwards terminal io', async () => {
    const dataListeners: ((data: string) => void)[] = [];
    const exitListeners: ((event: { exitCode: number; signal?: string }) => void)[] = [];
    const writes: string[] = [];
    const resizes: { cols: number; rows: number }[] = [];
    const kills: string[] = [];
    const calls: unknown[] = [];

    const provider = new ClaudeCodeProvider({
      spawn: (file, args, options) => {
        calls.push({ file, args, options });
        return {
          pid: 1234,
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
      { cwd: '/tmp', cols: 100, rows: 40, env: { CUSTOM_ENV: '1', TERM: 'dumb' } },
      (data) => outputs.push(data),
      (code) => exits.push(code),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      file: 'claude',
      args: ['--session-id', 'session-1'],
      options: {
        cwd: '/tmp',
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
});
