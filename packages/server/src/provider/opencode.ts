import { execFile } from 'node:child_process';
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

type ProviderSessionIdResolver = (options: {
  cwd: string;
  startedAtMs: number;
}) => Promise<string | null> | string | null;

async function loadBunPty(): Promise<PtySpawner> {
  const { spawn } = await import('bun-pty');
  return { spawn };
}

export class OpenCodeProvider implements AgentProvider {
  readonly name = 'opencode';
  readonly supportsResume = true;

  constructor(
    private ptySpawner?: PtySpawner,
    private providerSessionIdResolver?: ProviderSessionIdResolver,
  ) {}

  buildArgs(options: {
    cwd: string;
    model?: string;
    resume?: boolean;
    providerSessionId?: string;
    yolo?: boolean;
  }): string[] {
    if (options.yolo) {
      const args = ['run', '--interactive', '--dangerously-skip-permissions', '--dir', options.cwd];
      if (options.resume) {
        if (!options.providerSessionId) {
          throw new Error('OpenCode resume requires a provider session id');
        }
        args.push('--session', options.providerSessionId);
      }
      if (options.model) {
        args.push('--model', options.model);
      }
      return args;
    }

    const args = options.resume ? ['--session'] : [];
    if (options.resume) {
      if (!options.providerSessionId) {
        throw new Error('OpenCode resume requires a provider session id');
      }
      args.push(options.providerSessionId);
    }
    args.push(options.cwd);
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
    onProviderSessionId: (providerSessionId: string) => void = () => {},
  ): Promise<AgentProcess & { ringBuffer: RingBuffer }> {
    const startedAtMs = Date.now();
    const args = this.buildArgs({
      cwd: options.cwd,
      model: options.model,
      resume: options.resume,
      providerSessionId: options.providerSessionId,
      yolo: options.yolo,
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

    const pty = spawner.spawn('opencode', args, {
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

    if (!options.resume) {
      void this.reportProviderSessionId(options.cwd, startedAtMs, onProviderSessionId);
    }

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

  hasConversation(_sessionId: string, _cwd: string, providerSessionId?: string): boolean {
    return Boolean(providerSessionId);
  }

  getTranscriptHistory(_sessionId: string, _cwd: string): string[] {
    return [];
  }

  async kill(agentProcess: AgentProcess): Promise<void> {
    agentProcess.kill();
  }

  private async reportProviderSessionId(
    cwd: string,
    startedAtMs: number,
    onProviderSessionId: (providerSessionId: string) => void,
  ): Promise<void> {
    const resolver =
      this.providerSessionIdResolver ??
      ((options) => findLatestOpenCodeSessionId(options.cwd, options.startedAtMs));
    for (let attempt = 0; attempt < 30; attempt++) {
      const providerSessionId = await resolver({ cwd, startedAtMs });
      if (providerSessionId) {
        onProviderSessionId(providerSessionId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function findLatestOpenCodeSessionId(
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  const output = await readOpenCodeSessionList(cwd);
  return extractOpenCodeSessionId(output, cwd, startedAtMs);
}

function readOpenCodeSessionList(cwd: string): Promise<unknown> {
  return new Promise((resolve) => {
    execFile(
      'opencode',
      ['session', 'list', '--format', 'json', '--max-count', '20'],
      { cwd },
      (_error, stdout) => {
        if (!stdout.trim()) {
          resolve([]);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as unknown);
        } catch {
          resolve([]);
        }
      },
    );
  });
}

function extractOpenCodeSessionId(value: unknown, cwd: string, startedAtMs: number): string | null {
  const sessions = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.sessions)
      ? value.sessions
      : [];
  for (const item of sessions) {
    if (!isRecord(item)) continue;
    const id = firstString(item.id, item.sessionID, item.sessionId);
    if (!id) continue;
    const itemCwd = firstString(item.cwd, item.path, item.project, item.projectPath);
    if (itemCwd && itemCwd !== cwd) continue;
    const updatedAt = firstTimestamp(
      item.updatedAt,
      item.updated_at,
      item.time,
      item.createdAt,
      item.created_at,
    );
    if (updatedAt !== null && updatedAt < startedAtMs - 5000) continue;
    return id;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function firstTimestamp(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value))
      return value < 10_000_000_000 ? value * 1000 : value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
