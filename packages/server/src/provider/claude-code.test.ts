import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('builds yolo args for a new Claude Code session', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({
      sessionId: '00000000-0000-4000-8000-000000000001',
      yolo: true,
    });

    expect(args).toEqual([
      '--session-id',
      '00000000-0000-4000-8000-000000000001',
      '--dangerously-skip-permissions',
    ]);
  });

  it('does not add Claude Code permission bypass args when yolo is false', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({
      sessionId: '00000000-0000-4000-8000-000000000001',
      yolo: false,
    });

    expect(args).toEqual(['--session-id', '00000000-0000-4000-8000-000000000001']);
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

  it('filters slash command history from Claude transcript files', () => {
    const claudeDir = join(tmpdir(), `cubby-claude-history-${randomUUID()}`);
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const projectDir = join(claudeDir, 'projects', '-tmp-cubby-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'user',
          isMeta: true,
          message: { content: '<local-command-caveat>ignore me</local-command-caveat>' },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content:
              '<command-name>/theme</command-name>\n<command-message>theme</command-message>',
          },
        }),
        JSON.stringify({
          type: 'user',
          message: { content: '<local-command-stdout>Theme set to light</local-command-stdout>' },
        }),
        JSON.stringify({
          type: 'user',
          message: { content: 'Build the pinyin quiz' },
        }),
      ].join('\n'),
    );

    try {
      const provider = new ClaudeCodeProvider(undefined, claudeDir);
      const history = provider.getTranscriptHistory(sessionId, '/tmp/cubby/project').join('');

      expect(history).toContain('> Build the pinyin quiz');
      expect(history).not.toContain('> /theme');
      expect(history).not.toContain('Theme set to light');
      expect(history).not.toContain('ignore me');
    } finally {
      rmSync(claudeDir, { recursive: true, force: true });
    }
  });

  it('detects whether a Claude transcript exists for a session', () => {
    const claudeDir = join(tmpdir(), `cubby-claude-exists-${randomUUID()}`);
    const sessionId = '00000000-0000-4000-8000-000000000002';
    const projectDir = join(claudeDir, 'projects', '-tmp-cubby-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), '');

    try {
      const provider = new ClaudeCodeProvider(undefined, claudeDir);

      expect(provider.hasConversation(sessionId, '/tmp/cubby/project')).toBe(true);
      expect(provider.hasConversation('missing-session', '/tmp/cubby/project')).toBe(false);
    } finally {
      rmSync(claudeDir, { recursive: true, force: true });
    }
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

  it('spawns claude with yolo args', async () => {
    const calls: unknown[] = [];
    const provider = new ClaudeCodeProvider({
      spawn: (file, args, options) => {
        calls.push({ file, args, options });
        return {
          pid: 1235,
          onData: () => ({ dispose: () => {} }),
          onExit: () => ({ dispose: () => {} }),
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
    });

    await provider.spawn('session-1', {
      cwd: '/tmp',
      cols: 100,
      rows: 40,
      yolo: true,
    });

    expect(calls[0]).toMatchObject({
      file: 'claude',
      args: ['--session-id', 'session-1', '--dangerously-skip-permissions'],
    });
  });
});
