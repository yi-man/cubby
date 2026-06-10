import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

export class CodexProvider implements AgentProvider {
  readonly name = 'codex';
  readonly supportsResume = true;

  constructor(
    private ptySpawner?: PtySpawner,
    private codexDir = join(homedir(), '.codex'),
    private providerSessionIdResolver?: ProviderSessionIdResolver,
  ) {}

  buildArgs(options: {
    cwd: string;
    model?: string;
    resume?: boolean;
    providerSessionId?: string;
    yolo?: boolean;
  }): string[] {
    const args = options.resume ? ['resume', '--cd', options.cwd] : ['--cd', options.cwd];
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.yolo) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
    if (options.resume) {
      if (!options.providerSessionId) {
        throw new Error('Codex resume requires a provider session id');
      }
      args.push(options.providerSessionId);
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
      ((options) => findLatestCodexSessionId(this.codexDir, options.cwd, options.startedAtMs));
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

function findLatestCodexSessionId(
  codexDir: string,
  cwd: string,
  startedAtMs: number,
): string | null {
  const sessionsDir = join(codexDir, 'sessions');
  const candidates = listJsonlFiles(sessionsDir)
    .map((path) => {
      try {
        return { path, mtimeMs: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; mtimeMs: number } => Boolean(entry))
    .filter((entry) => entry.mtimeMs >= startedAtMs - 5000)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const candidate of candidates) {
    const session = readCodexSessionMeta(candidate.path);
    if (session?.cwd === cwd) return session.id;
  }
  return null;
}

function listJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...listJsonlFiles(path));
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path);
      }
    }
  } catch {
    return [];
  }
  return files;
}

function readCodexSessionMeta(path: string): { id: string; cwd: string } | null {
  try {
    const firstLine = readFileSync(path, 'utf8').split(/\r?\n/, 1)[0];
    if (!firstLine) return null;
    const parsed = JSON.parse(firstLine) as unknown;
    if (!isRecord(parsed) || parsed.type !== 'session_meta') return null;
    const payload = parsed.payload;
    if (!isRecord(payload) || typeof payload.id !== 'string' || typeof payload.cwd !== 'string') {
      return null;
    }
    return { id: payload.id, cwd: payload.cwd };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
