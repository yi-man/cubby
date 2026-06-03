import type {
  AgentProcess,
  AgentProvider,
  CreateSessionInput,
  Session,
  SpawnOptions,
} from '@cubby/core';
import { RingBuffer } from '../terminal/ring-buffer.js';
import type { SessionStore } from './store.js';

const OUTPUT_HISTORY_LIMIT = 5000;

export class SessionManager {
  private providers = new Map<string, AgentProvider>();
  private processes = new Map<string, AgentProcess>();
  private outputBuffers = new Map<string, RingBuffer>();
  private firstInputBuffers = new Map<string, string>();
  private statusListeners: ((sessionId: string, status: string) => void)[] = [];

  constructor(private store: SessionStore) {}

  onStatusChange(listener: (sessionId: string, status: string) => void): void {
    this.statusListeners.push(listener);
  }

  private notifyStatusChange(sessionId: string, status: string): void {
    for (const listener of this.statusListeners) {
      listener(sessionId, status);
    }
  }

  registerProvider(provider: AgentProvider): void {
    this.providers.set(provider.name, provider);
  }

  createSession(input: CreateSessionInput): Session {
    return this.store.create(input);
  }

  getSession(id: string): Session | null {
    return this.store.get(id);
  }

  listSessions(): Session[] {
    return this.store.list();
  }

  reconcileDetachedLiveSessions(): Session[] {
    const reconciled: Session[] = [];
    for (const session of this.store.list()) {
      if (
        (session.status === 'starting' || session.status === 'running') &&
        !this.processes.has(session.id)
      ) {
        this.store.updateStatus(session.id, 'ended');
        const updated = this.store.get(session.id);
        if (updated) reconciled.push(updated);
        this.notifyStatusChange(session.id, 'ended');
      }
    }
    return reconciled;
  }

  async startSession(
    sessionId: string,
    options: SpawnOptions,
    onOutput?: (data: string) => void,
  ): Promise<void> {
    await this.spawnSession(sessionId, options, 'draft', false, onOutput);
  }

  async resumeSession(
    sessionId: string,
    options: SpawnOptions,
    onOutput?: (data: string) => void,
  ): Promise<void> {
    await this.spawnSession(sessionId, options, 'ended', true, onOutput);
  }

  private async spawnSession(
    sessionId: string,
    options: SpawnOptions,
    expectedStatus: Session['status'],
    resume: boolean,
    onOutput?: (data: string) => void,
  ): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status !== expectedStatus)
      throw new Error(`Session not in ${expectedStatus} status: ${session.status}`);

    const provider = this.providers.get(session.provider);
    if (!provider) throw new Error(`Provider not found: ${session.provider}`);
    const outputBuffer = this.getOrCreateOutputBuffer(sessionId);

    this.store.updateStatus(sessionId, 'starting');
    this.notifyStatusChange(sessionId, 'starting');

    try {
      const process = await provider.spawn(
        sessionId,
        { ...options, model: session.model ?? undefined, resume },
        (data) => {
          outputBuffer.push(data);
          this.store.appendTerminalOutput(sessionId, data, OUTPUT_HISTORY_LIMIT);
          if (this.processes.has(sessionId)) {
            this.store.updateStatus(sessionId, 'running');
            this.notifyStatusChange(sessionId, 'running');
          }
          onOutput?.(data);
        },
        (code) => {
          if (this.processes.has(sessionId)) {
            this.store.updateStatus(sessionId, 'ended', { exitCode: code, pid: process.pid });
            this.notifyStatusChange(sessionId, 'ended');
            this.processes.delete(sessionId);
          }
        },
      );

      this.processes.set(sessionId, process);
      this.store.updateStatus(sessionId, 'running', { pid: process.pid });
      this.notifyStatusChange(sessionId, 'running');
    } catch (err) {
      this.store.updateStatus(sessionId, 'ended', { exitCode: 1 });
      this.notifyStatusChange(sessionId, 'ended');
      throw err;
    }
  }

  async killSession(sessionId: string): Promise<void> {
    const process = this.processes.get(sessionId);
    if (process) {
      process.kill();
      this.processes.delete(sessionId);
    }
    this.store.updateStatus(sessionId, 'ended');
    this.notifyStatusChange(sessionId, 'ended');
  }

  getProcess(sessionId: string): AgentProcess | undefined {
    return this.processes.get(sessionId);
  }

  getOutputHistory(sessionId: string): string[] {
    const persistedHistory = this.store.getTerminalOutputHistory(sessionId, OUTPUT_HISTORY_LIMIT);
    if (persistedHistory.length > 0) return persistedHistory;
    const bufferedHistory = this.outputBuffers.get(sessionId)?.getAll() ?? [];
    if (bufferedHistory.length > 0) return bufferedHistory;

    const session = this.store.get(sessionId);
    if (!session) return [];
    const provider = this.providers.get(session.provider);
    return provider?.getTranscriptHistory?.(sessionId, session.workspaceId) ?? [];
  }

  recordTerminalInput(sessionId: string, data: string): Session | null {
    const session = this.store.get(sessionId);
    if (!session) return null;
    if (session.title && !isSlashCommandTitle(session.title)) return null;

    let buffer = this.firstInputBuffers.get(sessionId) ?? '';
    for (let index = 0; index < data.length; index++) {
      const char = data[index];
      if (char === '\x1b') {
        index = skipEscapeSequence(data, index) - 1;
        continue;
      }
      if (char === '\r' || char === '\n') {
        const title = summarizeFirstInput(buffer);
        this.firstInputBuffers.delete(sessionId);
        if (!title) return null;
        this.store.updateTitle(sessionId, title);
        return this.store.get(sessionId);
      }
      if (char === '\b' || char === '\x7f') {
        buffer = buffer.slice(0, -1);
        continue;
      }
      if (char >= ' ') {
        buffer += char;
      }
    }

    this.firstInputBuffers.set(sessionId, buffer);
    return null;
  }

  private getOrCreateOutputBuffer(sessionId: string): RingBuffer {
    let outputBuffer = this.outputBuffers.get(sessionId);
    if (!outputBuffer) {
      outputBuffer = new RingBuffer(5000);
      this.outputBuffers.set(sessionId, outputBuffer);
    }
    return outputBuffer;
  }
}

function summarizeFirstInput(input: string): string {
  const normalized = input
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\p{P}\p{S} ]/gu, '')
    .trim();
  if (!normalized) return '';
  if (normalized.startsWith('/')) return '';
  if (normalized.length <= 32) return normalized;

  const truncated = normalized.slice(0, 32);
  const wordBoundary = truncated.lastIndexOf(' ');
  const summary = wordBoundary >= 16 ? truncated.slice(0, wordBoundary) : truncated;
  return summary.replace(/\s+(and|or|for|to|of|in|on|with|from|by)$/i, '');
}

function isSlashCommandTitle(title: string): boolean {
  return title.trim().startsWith('/');
}

function skipEscapeSequence(input: string, startIndex: number): number {
  const introducer = input[startIndex + 1];
  if (!introducer) return input.length;

  if (introducer === '[') {
    for (let index = startIndex + 2; index < input.length; index++) {
      const code = input.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index + 1;
    }
    return input.length;
  }

  if (introducer === ']') {
    for (let index = startIndex + 2; index < input.length; index++) {
      if (input.charCodeAt(index) === 0x07) return index + 1;
      if (input[index] === '\x1b' && input[index + 1] === '\\') return index + 2;
    }
    return input.length;
  }

  return Math.min(startIndex + 2, input.length);
}
