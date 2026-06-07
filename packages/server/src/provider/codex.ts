import type { AgentProcess, AgentProvider, SpawnOptions } from '@cubby/core';
import { RingBuffer } from '../terminal/ring-buffer.js';

interface PtyDisposable {
  dispose(): void;
}

interface PtyProcess {
  pid: number;
  onData(listener: (data: string) => void): PtyDisposable;
  onExit(listener: (event: { exitCode: number; signal?: string | number }) => void): PtyDisposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

interface PtySpawner {
  spawn(
    file: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; cols: number; rows: number; name: string },
  ): PtyProcess;
}

async function loadBunPty(): Promise<PtySpawner> {
  const { spawn } = await import('bun-pty');
  return { spawn };
}

export class CodexProvider implements AgentProvider {
  readonly name = 'codex';
  readonly supportsResume = false;

  constructor(private ptySpawner?: PtySpawner) {}

  buildArgs(options: { cwd: string; model?: string }): string[] {
    const args = ['--cd', options.cwd];
    if (options.model) {
      args.push('--model', options.model);
    }
    return args;
  }

  async spawn(
    _sessionId: string,
    options: SpawnOptions,
    onOutput: (data: string) => void = () => {},
    onExit: (code: number) => void = () => {},
  ): Promise<AgentProcess & { ringBuffer: RingBuffer }> {
    if (options.resume) {
      throw new Error('Codex sessions cannot be resumed by Cubby yet');
    }

    const args = this.buildArgs({
      cwd: options.cwd,
      model: options.model,
    });
    const ringBuffer = new RingBuffer(5000);
    const spawner = this.ptySpawner ?? (await loadBunPty());
    const env = {
      ...process.env,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
    } as Record<string, string>;

    const pty = spawner.spawn('codex', args, {
      cwd: options.cwd,
      env,
      cols: options.cols,
      rows: options.rows,
      name: 'xterm-256color',
    });

    pty.onData((text) => {
      ringBuffer.push(text);
      onOutput(text);
    });

    pty.onExit((event) => {
      onExit(event.exitCode ?? 1);
    });

    return {
      pid: pty.pid,
      onData: (cb) => {
        pty.onData(cb);
      },
      onExit: (cb) => {
        pty.onExit((event) => cb(event.exitCode ?? 1));
      },
      write: (data) => {
        pty.write(data);
      },
      resize: (cols, rows) => {
        pty.resize(cols, rows);
      },
      kill: () => {
        pty.kill('SIGTERM');
      },
      ringBuffer,
    };
  }

  hasConversation(_sessionId: string, _cwd: string): boolean {
    return false;
  }

  getTranscriptHistory(_sessionId: string, _cwd: string): string[] {
    return [];
  }

  async kill(agentProcess: AgentProcess): Promise<void> {
    agentProcess.kill();
  }
}
