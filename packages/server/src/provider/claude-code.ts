import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

async function loadBunPty(): Promise<PtySpawner> {
  const { spawn } = await import('bun-pty');
  return { spawn };
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = 'claude-code';

  constructor(
    private ptySpawner?: PtySpawner,
    private claudeDir = join(homedir(), '.claude'),
  ) {}

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

  getTranscriptHistory(sessionId: string, cwd: string): string[] {
    const transcriptPath = this.findTranscriptPath(sessionId, cwd);
    if (!transcriptPath) return [];

    const chunks: string[] = [];
    const lines = readFileSync(transcriptPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = transcriptLineToHistoryChunk(line);
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  }

  private findTranscriptPath(sessionId: string, cwd: string): string | null {
    const encodedCwd = cwd.replace(/[\\/]/g, '-');
    const directPath = join(this.claudeDir, 'projects', encodedCwd, `${sessionId}.jsonl`);
    if (existsSync(directPath)) return directPath;

    const projectsDir = join(this.claudeDir, 'projects');
    if (!existsSync(projectsDir)) return null;
    for (const projectName of readdirSync(projectsDir)) {
      const candidate = join(projectsDir, projectName, `${sessionId}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  async kill(agentProcess: AgentProcess): Promise<void> {
    agentProcess.kill();
  }
}

function transcriptLineToHistoryChunk(line: string): string | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isTranscriptRecord(record)) return null;
  if (record.type !== 'user') return null;
  if (record.isMeta) return null;
  const content = record.message?.content;
  if (typeof content !== 'string') return null;
  if (content.includes('<local-command-caveat>')) return null;

  const commandName = extractTag(content, 'command-name');
  if (commandName) {
    return `> ${commandName.trim()}\r\n`;
  }

  const stdout = extractTag(content, 'local-command-stdout');
  if (stdout) {
    return `${stdout.trim()}\r\n`;
  }

  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('<')) return null;
  return `> ${trimmed}\r\n`;
}

function isTranscriptRecord(
  value: unknown,
): value is { type?: string; isMeta?: boolean; message?: { content?: unknown } } {
  return typeof value === 'object' && value !== null;
}

function extractTag(content: string, tagName: string): string | null {
  const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
  return match?.[1] ?? null;
}
