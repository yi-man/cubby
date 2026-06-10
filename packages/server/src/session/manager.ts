import { Buffer } from 'node:buffer';
import type {
  AgentProcess,
  AgentProvider,
  CreateSessionInput,
  RecoveryReconcileResult,
  Session,
  SpawnOptions,
  TerminalOutputChunk,
  TerminalReplayResult,
  TerminalSnapshotResult,
} from '@cubby/core';
import { RingBuffer } from '../terminal/ring-buffer.js';
import { HeadlessSnapshotBuffer } from '../terminal/terminal-snapshot-buffer.js';
import type { SessionStore } from './store.js';

const OUTPUT_HISTORY_LIMIT = 5000;
const SNAPSHOT_PERSIST_DEBOUNCE_MS = 250;

interface SessionManagerOptions {
  outputHistoryLimit?: number;
}

export class SessionManager {
  private providers = new Map<string, AgentProvider>();
  private processes = new Map<string, AgentProcess>();
  private outputBuffers = new Map<string, RingBuffer>();
  private snapshotBuffers = new Map<string, HeadlessSnapshotBuffer>();
  private snapshotPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private firstInputBuffers = new Map<string, string>();
  private sessionsNeedingResumeInputReset = new Set<string>();
  private deletedSessionIds = new Set<string>();
  private statusListeners: ((sessionId: string, status: string) => void)[] = [];
  private sessionUpdateListeners: ((session: Session) => void)[] = [];
  private readonly outputHistoryLimit: number;

  constructor(
    private store: SessionStore,
    options: SessionManagerOptions = {},
  ) {
    this.outputHistoryLimit = options.outputHistoryLimit ?? OUTPUT_HISTORY_LIMIT;
  }

  onStatusChange(listener: (sessionId: string, status: string) => void): void {
    this.statusListeners.push(listener);
  }

  onSessionUpdate(listener: (session: Session) => void): void {
    this.sessionUpdateListeners.push(listener);
  }

  private notifyStatusChange(sessionId: string, status: string): void {
    for (const listener of this.statusListeners) {
      listener(sessionId, status);
    }
  }

  private notifySessionUpdate(sessionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) return;
    for (const listener of this.sessionUpdateListeners) {
      listener(session);
    }
  }

  registerProvider(provider: AgentProvider): void {
    this.providers.set(provider.name, provider);
  }

  createSession(input: CreateSessionInput): Session {
    const session = this.store.create(input);
    this.deletedSessionIds.delete(session.id);
    return session;
  }

  renameSession(sessionId: string, title: string): Session {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new Error('Session title is required');

    const session = this.store.get(sessionId);
    if (!session) throw new Error('Session not found');

    this.store.updateTitle(sessionId, trimmedTitle);
    const updated = this.store.get(sessionId);
    if (!updated) throw new Error('Session not found');
    return updated;
  }

  getSession(id: string): Session | null {
    return this.store.get(id);
  }

  listSessions(): Session[] {
    return this.store.list().filter((session) => {
      return (
        session.status === 'draft' ||
        isLiveSession(session.status) ||
        this.hasConversation(session) ||
        this.hasCapturedTerminalHistory(session.id)
      );
    });
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
    onOutput?: (chunk: TerminalOutputChunk) => void,
  ): Promise<void> {
    await this.spawnSession(sessionId, options, 'draft', false, onOutput);
  }

  async resumeSession(
    sessionId: string,
    options: SpawnOptions,
    onOutput?: (chunk: TerminalOutputChunk) => void,
  ): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error('Session not found');
    const provider = this.providers.get(session.provider);
    if (provider?.supportsResume === false) {
      throw new Error('Session is not resumable: provider does not support resume');
    }
    if (!this.hasConversation(session)) {
      throw new Error('Session is not resumable: provider conversation not found');
    }
    await this.spawnSession(sessionId, options, 'ended', true, onOutput);
  }

  private hasConversation(session: Session): boolean {
    const provider = this.providers.get(session.provider);
    if (provider?.supportsResume === false) return false;
    return (
      provider?.hasConversation?.(
        session.id,
        session.workspaceId,
        session.providerSessionId ?? undefined,
      ) ?? true
    );
  }

  private hasCapturedTerminalHistory(sessionId: string): boolean {
    return this.store.getTerminalOutputHistory(sessionId, 1).length > 0;
  }

  private async spawnSession(
    sessionId: string,
    options: SpawnOptions,
    expectedStatus: Session['status'],
    resume: boolean,
    onOutput?: (chunk: TerminalOutputChunk) => void,
  ): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status !== expectedStatus)
      throw new Error(`Session not in ${expectedStatus} status: ${session.status}`);

    const provider = this.providers.get(session.provider);
    if (!provider) throw new Error(`Provider not found: ${session.provider}`);
    const outputBuffer = new RingBuffer(this.outputHistoryLimit);
    this.outputBuffers.set(sessionId, outputBuffer);
    this.replaceSnapshotBuffer(sessionId, options.cols, options.rows);

    this.store.updateStatus(sessionId, 'starting');
    this.notifyStatusChange(sessionId, 'starting');

    try {
      let earlyExitCode: number | null = null;
      const process = await provider.spawn(
        sessionId,
        {
          ...options,
          model: session.model ?? undefined,
          resume,
          providerSessionId: session.providerSessionId ?? undefined,
        },
        (data) => {
          if (this.deletedSessionIds.has(sessionId)) return;

          const chunk = outputBuffer.push(data);
          this.store.appendTerminalOutput(sessionId, chunk, this.outputHistoryLimit);
          this.writeSnapshotChunk(sessionId, chunk);
          if (this.processes.has(sessionId)) {
            this.store.updateStatus(sessionId, 'running');
            this.notifyStatusChange(sessionId, 'running');
          }
          onOutput?.(chunk);
        },
        (code) => {
          const activeProcess = this.processes.get(sessionId);
          if (activeProcess) {
            this.store.updateStatus(sessionId, 'ended', { exitCode: code, pid: activeProcess.pid });
            this.notifyStatusChange(sessionId, 'ended');
            this.processes.delete(sessionId);
            void this.disposeSnapshotBuffer(sessionId);
          } else {
            earlyExitCode = code;
          }
        },
        (providerSessionId) => {
          const trimmedProviderSessionId = providerSessionId.trim();
          if (!trimmedProviderSessionId || this.deletedSessionIds.has(sessionId)) return;
          this.store.updateProviderSessionId(sessionId, trimmedProviderSessionId);
          this.notifySessionUpdate(sessionId);
        },
      );

      if (earlyExitCode !== null) {
        this.store.updateStatus(sessionId, 'ended', { exitCode: earlyExitCode, pid: process.pid });
        this.notifyStatusChange(sessionId, 'ended');
        this.sessionsNeedingResumeInputReset.delete(sessionId);
        await this.disposeSnapshotBuffer(sessionId);
        return;
      }

      this.processes.set(sessionId, process);
      if (resume) {
        this.sessionsNeedingResumeInputReset.add(sessionId);
      } else {
        this.sessionsNeedingResumeInputReset.delete(sessionId);
      }
      this.store.updateStatus(sessionId, 'running', { pid: process.pid });
      this.notifyStatusChange(sessionId, 'running');
    } catch (err) {
      const errorChunk = outputBuffer.push(formatSessionStartError(err));
      this.store.appendTerminalOutput(sessionId, errorChunk, this.outputHistoryLimit);
      this.writeSnapshotChunk(sessionId, errorChunk);
      onOutput?.(errorChunk);
      this.store.updateStatus(sessionId, 'ended', { exitCode: 1 });
      this.notifyStatusChange(sessionId, 'ended');
      await this.disposeSnapshotBuffer(sessionId);
      throw err;
    }
  }

  async killSession(sessionId: string): Promise<void> {
    const process = this.processes.get(sessionId);
    let killError: unknown;
    if (process) {
      try {
        process.kill();
      } catch (err) {
        killError = err;
      } finally {
        this.processes.delete(sessionId);
      }
    }
    await this.disposeSnapshotBuffer(sessionId);
    this.store.updateStatus(sessionId, 'ended');
    this.notifyStatusChange(sessionId, 'ended');
    this.sessionsNeedingResumeInputReset.delete(sessionId);
    if (killError) {
      throw killError;
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.store.get(sessionId);
    if (!session) return false;

    const process = this.processes.get(sessionId);
    let killError: unknown;
    if (process) {
      try {
        process.kill();
      } catch (err) {
        killError = err;
      } finally {
        this.processes.delete(sessionId);
      }
    }

    this.clearRuntimeState(sessionId);

    if (isLiveSession(session.status)) {
      this.store.updateStatus(sessionId, 'ended', process ? { pid: process.pid } : undefined);
      this.notifyStatusChange(sessionId, 'ended');
    }

    if (killError) {
      throw killError;
    }

    this.deletedSessionIds.add(sessionId);
    try {
      const deleted = this.store.delete(sessionId);
      if (!deleted) this.deletedSessionIds.delete(sessionId);
      return deleted;
    } catch (err) {
      this.deletedSessionIds.delete(sessionId);
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    const errors: unknown[] = [];
    for (const sessionId of Array.from(this.processes.keys())) {
      try {
        await this.killSession(sessionId);
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new Error(`Failed to stop ${errors.length} session process(es) during shutdown`);
    }
  }

  getProcess(sessionId: string): AgentProcess | undefined {
    return this.processes.get(sessionId);
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): boolean {
    const process = this.processes.get(sessionId);
    if (!process) return false;
    process.resize(cols, rows);

    const snapshotBuffer = this.snapshotBuffers.get(sessionId);
    if (snapshotBuffer && !snapshotBuffer.disabled) {
      try {
        snapshotBuffer.resize(cols, rows);
        this.scheduleSnapshotPersist(sessionId, snapshotBuffer);
      } catch {
        void this.disposeSnapshotBuffer(sessionId, snapshotBuffer);
      }
    }

    return true;
  }

  getOutputReplay(sessionId: string, lastSeq = 0): TerminalReplayResult {
    const requestedSeq = normalizeSequence(lastSeq);
    const session = this.store.get(sessionId);
    if (!session) return { status: 'unknown', sessionId };

    if (this.processes.has(sessionId)) {
      const replay = this.outputBuffers.get(sessionId)?.replayFrom(requestedSeq) ?? {
        status: 'ok' as const,
        chunks: [],
        seq: 0,
      };
      if (replay.status === 'ok') {
        return { status: 'ok', sessionId, chunks: replay.chunks, seq: replay.seq };
      }
      return {
        status: 'too_old',
        sessionId,
        oldestSeq: replay.oldestSeq,
        seq: replay.seq,
      };
    }

    return replayOutputChunks(sessionId, this.getOutputHistoryChunks(session), requestedSeq);
  }

  reconcileTerminalRecovery(sessionId: string, renderedSeq: number): RecoveryReconcileResult {
    const requestedSeq = normalizeSequence(renderedSeq);
    const session = this.store.get(sessionId);
    if (!session) {
      return { action: 'unrecoverable', sessionId, reason: 'unknown_session' };
    }

    const buffer = this.outputBuffers.get(sessionId);
    const live = this.processes.has(sessionId);
    const historyChunks = live ? [] : this.getOutputHistoryChunks(session);
    const historySeq = historyChunks.at(-1)?.seq ?? 0;
    const headSeq = buffer?.currentSeq ?? historySeq;

    if (live) {
      if (requestedSeq >= headSeq) return { action: 'noop', sessionId, headSeq };
      if (
        requestedSeq === 0 &&
        headSeq > 0 &&
        this.hasRecoverableSnapshot(sessionId, requestedSeq)
      ) {
        return { action: 'snapshot', sessionId, headSeq };
      }
      if (buffer?.canReplayFrom(requestedSeq)) {
        return { action: 'replay', sessionId, fromSeq: requestedSeq, headSeq };
      }
      if (this.hasRecoverableSnapshot(sessionId, requestedSeq)) {
        return { action: 'snapshot', sessionId, headSeq };
      }
      return { action: 'unrecoverable', sessionId, reason: 'too_old_no_snapshot' };
    }

    if (session.status === 'ended') {
      if (requestedSeq >= headSeq) {
        return { action: 'closed', sessionId, headSeq, exitCode: session.exitCode };
      }
      if (buffer?.canReplayFrom(requestedSeq)) {
        return { action: 'replay', sessionId, fromSeq: requestedSeq, headSeq };
      }
      if (canReplayOutputChunks(historyChunks, requestedSeq)) {
        return { action: 'replay', sessionId, fromSeq: requestedSeq, headSeq };
      }
      if (historyChunks.length > 0) {
        return { action: 'unrecoverable', sessionId, reason: 'too_old_no_snapshot' };
      }

      return { action: 'closed', sessionId, headSeq, exitCode: session.exitCode };
    }

    if (requestedSeq < headSeq && canReplayOutputChunks(historyChunks, requestedSeq)) {
      return { action: 'replay', sessionId, fromSeq: requestedSeq, headSeq };
    }

    return { action: 'unrecoverable', sessionId, reason: 'unknown_session' };
  }

  prepareTerminalInput(sessionId: string, data: string): string {
    if (!this.sessionsNeedingResumeInputReset.has(sessionId)) return data;

    const input = stripTerminalFocusEvents(data);
    if (!input) return '';
    if (!shouldResetBeforeResumeInput(input)) return input;

    this.sessionsNeedingResumeInputReset.delete(sessionId);
    return `\x15${input}`;
  }

  async getTerminalSnapshot(sessionId: string, _size?: unknown): Promise<TerminalSnapshotResult> {
    const session = this.store.get(sessionId);
    if (!session) return { status: 'unknown', sessionId };

    const snapshotBuffer = this.snapshotBuffers.get(sessionId);
    if (snapshotBuffer && !snapshotBuffer.disabled) {
      try {
        const snapshot = await snapshotBuffer.snapshot();
        this.store.upsertTerminalSnapshot(sessionId, snapshot);
        return { status: 'ok', sessionId, ...snapshot };
      } catch {
        void this.disposeSnapshotBuffer(sessionId, snapshotBuffer);
      }
    }

    const storedSnapshot = this.store.getTerminalSnapshot(sessionId);
    if (storedSnapshot) {
      return { status: 'ok', sessionId, ...storedSnapshot };
    }
    return { status: 'unavailable', sessionId };
  }

  getOutputHistory(sessionId: string): string[] {
    if (this.processes.has(sessionId)) {
      return this.outputBuffers.get(sessionId)?.getAll() ?? [];
    }

    const session = this.store.get(sessionId);
    const provider = session ? this.providers.get(session.provider) : undefined;
    const persistedHistory = this.store.getTerminalOutputHistory(
      sessionId,
      this.outputHistoryLimit,
    );
    if (persistedHistory.length > 0) return persistedHistory;
    const bufferedHistory = this.outputBuffers.get(sessionId)?.getAll() ?? [];
    if (bufferedHistory.length > 0) return bufferedHistory;
    const transcriptHistory = session
      ? (provider?.getTranscriptHistory?.(
          sessionId,
          session.workspaceId,
          session.providerSessionId ?? undefined,
        ) ?? [])
      : [];
    if (transcriptHistory.length > 0) return transcriptHistory;
    return [];
  }

  private getOutputHistoryChunks(session: Session): TerminalOutputChunk[] {
    const persistedHistory = this.store.getTerminalOutputChunks(
      session.id,
      this.outputHistoryLimit,
    );
    if (persistedHistory.length > 0) return persistedHistory;
    const bufferedHistory = this.outputBuffers.get(session.id)?.getChunks() ?? [];
    if (bufferedHistory.length > 0) return bufferedHistory;
    const provider = this.providers.get(session.provider);
    return synthesizeOutputChunks(
      provider?.getTranscriptHistory?.(
        session.id,
        session.workspaceId,
        session.providerSessionId ?? undefined,
      ) ?? [],
    ).chunks;
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

  private clearRuntimeState(sessionId: string): void {
    void this.disposeSnapshotBuffer(sessionId, undefined, { persist: false });
    this.outputBuffers.delete(sessionId);
    this.firstInputBuffers.delete(sessionId);
    this.sessionsNeedingResumeInputReset.delete(sessionId);
  }

  private replaceSnapshotBuffer(sessionId: string, cols: number, rows: number): void {
    void this.disposeSnapshotBuffer(sessionId, undefined, { persist: false });
    this.store.clearTerminalSnapshot(sessionId);

    try {
      this.snapshotBuffers.set(sessionId, new HeadlessSnapshotBuffer({ cols, rows }));
    } catch {
      this.snapshotBuffers.delete(sessionId);
    }
  }

  private async disposeSnapshotBuffer(
    sessionId: string,
    expected?: HeadlessSnapshotBuffer,
    options: { persist?: boolean } = {},
  ): Promise<void> {
    const snapshotBuffer = this.snapshotBuffers.get(sessionId);
    if (!snapshotBuffer) return;
    if (expected && snapshotBuffer !== expected) return;
    const persist = options.persist ?? true;

    const timer = this.snapshotPersistTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.snapshotPersistTimers.delete(sessionId);
    this.snapshotBuffers.delete(sessionId);

    if (persist && !snapshotBuffer.disabled) {
      try {
        const snapshot = await snapshotBuffer.snapshot();
        this.store.upsertTerminalSnapshot(sessionId, snapshot);
      } catch {
      } finally {
        snapshotBuffer.dispose();
      }
      return;
    }

    snapshotBuffer.dispose();
  }

  private writeSnapshotChunk(sessionId: string, chunk: TerminalOutputChunk): void {
    const snapshotBuffer = this.snapshotBuffers.get(sessionId);
    if (!snapshotBuffer || snapshotBuffer.disabled) return;

    try {
      snapshotBuffer.write(chunk.data, chunk.seq);
      this.scheduleSnapshotPersist(sessionId, snapshotBuffer);
    } catch {
      void this.disposeSnapshotBuffer(sessionId, snapshotBuffer);
    }
  }

  private scheduleSnapshotPersist(sessionId: string, snapshotBuffer: HeadlessSnapshotBuffer): void {
    const existing = this.snapshotPersistTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.snapshotPersistTimers.delete(sessionId);
      if (this.snapshotBuffers.get(sessionId) !== snapshotBuffer || snapshotBuffer.disabled) return;

      void snapshotBuffer
        .snapshot()
        .then((snapshot) => {
          if (this.snapshotBuffers.get(sessionId) === snapshotBuffer) {
            this.store.upsertTerminalSnapshot(sessionId, snapshot);
          }
        })
        .catch(() => {
          void this.disposeSnapshotBuffer(sessionId, snapshotBuffer);
        });
    }, SNAPSHOT_PERSIST_DEBOUNCE_MS);

    this.snapshotPersistTimers.set(sessionId, timer);
  }

  private hasRecoverableSnapshot(sessionId: string, requestedSeq: number): boolean {
    const snapshotBuffer = this.snapshotBuffers.get(sessionId);
    if (snapshotBuffer && !snapshotBuffer.disabled) return true;

    const storedSnapshot = this.store.getTerminalSnapshot(sessionId);
    return Boolean(storedSnapshot && storedSnapshot.seq > requestedSeq);
  }
}

function synthesizeOutputChunks(history: string[]): { chunks: TerminalOutputChunk[]; seq: number } {
  let seq = 0;
  const chunks = history.map((data) => {
    const seqStart = seq;
    seq += Buffer.byteLength(data, 'utf8');
    return { data, seqStart, seq };
  });
  return { chunks, seq };
}

function replayOutputChunks(
  sessionId: string,
  chunks: TerminalOutputChunk[],
  lastSeq: number,
): TerminalReplayResult {
  const seq = chunks.at(-1)?.seq ?? 0;
  if (chunks.length > 0 && lastSeq > 0 && lastSeq < chunks[0].seqStart) {
    return { status: 'too_old', sessionId, oldestSeq: chunks[0].seqStart, seq };
  }

  return {
    status: 'ok',
    sessionId,
    chunks:
      lastSeq <= 0
        ? chunks.map((chunk) => ({ ...chunk }))
        : chunks.filter((chunk) => chunk.seq > lastSeq).map((chunk) => ({ ...chunk })),
    seq,
  };
}

function canReplayOutputChunks(chunks: TerminalOutputChunk[], lastSeq: number): boolean {
  return chunks.length > 0 && (lastSeq <= 0 || lastSeq >= chunks[0].seqStart);
}

function formatSessionStartError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Failed to start session: ${message}\r\n`;
}

function normalizeSequence(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function isLiveSession(status: Session['status']): boolean {
  return status === 'starting' || status === 'running';
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

function shouldResetBeforeResumeInput(data: string): boolean {
  for (let index = 0; index < data.length; index++) {
    const char = data[index];
    if (char === '\x1b') {
      index = skipEscapeSequence(data, index) - 1;
      continue;
    }
    if (char === '\r' || char === '\n') return true;
    if (char >= ' ') return true;
  }

  return false;
}

function stripTerminalFocusEvents(input: string): string {
  return input.replaceAll('\x1b[I', '').replaceAll('\x1b[O', '');
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
