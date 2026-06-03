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

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = 'claude-code';

  constructor(private ptySpawner?: PtySpawner) {}

  buildArgs(options: { model?: string; resume?: boolean; sessionId?: string }): string[] {
    const args: string[] = [];
    if (options.resume && options.sessionId) {
      args.push('--resume', options.sessionId);
    } else if (options.resume) {
      args.push('--continue');
    } else if (options.sessionId) {
      args.push('--session-id', options.sessionId);
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    return args;
  }

  async spawn(
    sessionId: string,
    options: SpawnOptions,
    onOutput: (data: string) => void = () => {},
    onExit: (code: number) => void = () => {},
  ): Promise<AgentProcess & { ringBuffer: RingBuffer }> {
    const args = this.buildArgs({
      model: options.model,
      resume: options.resume,
      sessionId,
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

    const pty = spawner.spawn('claude', args, {
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

    const agentProcess: AgentProcess & { ringBuffer: RingBuffer } = {
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

    return agentProcess;
  }

  async kill(agentProcess: AgentProcess): Promise<void> {
    agentProcess.kill();
  }
}
