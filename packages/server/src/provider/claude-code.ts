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
    let skipNextLocalCommandStdout = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = transcriptLineToHistoryEntry(line, skipNextLocalCommandStdout);
      skipNextLocalCommandStdout = entry.skipNextLocalCommandStdout;
      const { chunk } = entry;
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

function transcriptLineToHistoryEntry(
  line: string,
  skipLocalCommandStdout: boolean,
): { chunk: string | null; skipNextLocalCommandStdout: boolean } {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return { chunk: null, skipNextLocalCommandStdout: false };
  }
  if (!isTranscriptRecord(record)) return { chunk: null, skipNextLocalCommandStdout: false };
  if (record.type !== 'user') return { chunk: null, skipNextLocalCommandStdout: false };
  if (record.isMeta) return { chunk: null, skipNextLocalCommandStdout: false };
  const content = record.message?.content;
  if (typeof content !== 'string') return { chunk: null, skipNextLocalCommandStdout: false };
  if (content.includes('<local-command-caveat>')) {
    return { chunk: null, skipNextLocalCommandStdout: false };
  }

  const commandName = extractTag(content, 'command-name');
  if (commandName) {
    const trimmedCommand = commandName.trim();
    if (trimmedCommand.startsWith('/')) {
      return { chunk: null, skipNextLocalCommandStdout: true };
    }
    return { chunk: `> ${trimmedCommand}\r\n`, skipNextLocalCommandStdout: false };
  }

  const stdout = extractTag(content, 'local-command-stdout');
  if (stdout) {
    if (skipLocalCommandStdout) return { chunk: null, skipNextLocalCommandStdout: false };
    return { chunk: `${stdout.trim()}\r\n`, skipNextLocalCommandStdout: false };
  }

  const trimmed = content.trim();
  if (!trimmed) return { chunk: null, skipNextLocalCommandStdout: false };
  if (trimmed.startsWith('<')) return { chunk: null, skipNextLocalCommandStdout: false };
  return { chunk: `> ${trimmed}\r\n`, skipNextLocalCommandStdout: false };
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
