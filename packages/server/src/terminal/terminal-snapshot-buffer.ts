import { SerializeAddon } from '@xterm/addon-serialize';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import XtermHeadless from '@xterm/headless';

const { Terminal } = XtermHeadless;
const DEFAULT_SCROLLBACK = 5000;

export interface TerminalSnapshot {
  data: string;
  seq: number;
  cols: number;
  rows: number;
}

export class SnapshotUnsupportedError extends Error {
  constructor(message = 'Terminal snapshot buffer is unavailable') {
    super(message);
    this.name = 'SnapshotUnsupportedError';
  }
}

export class HeadlessSnapshotBuffer {
  private term: HeadlessTerminal | null;
  private addon: SerializeAddon | null;
  private mirroredSeq = 0;
  private disabledState = false;
  private disposed = false;
  private pendingWrites = 0;
  private drainResolvers: Array<() => void> = [];
  private cols: number;
  private rows: number;

  constructor(options: { cols: number; rows: number; scrollback?: number }) {
    this.cols = options.cols;
    this.rows = options.rows;
    this.term = new Terminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollback ?? DEFAULT_SCROLLBACK,
      allowProposedApi: true,
    });
    this.addon = new SerializeAddon();
    this.term.loadAddon(this.addon);
  }

  get disabled(): boolean {
    return this.disabledState;
  }

  write(data: string, seq: number): void {
    const term = this.requireTerminal();
    this.pendingWrites += 1;

    try {
      term.write(data, () => {
        this.mirroredSeq = seq;
        this.pendingWrites = Math.max(0, this.pendingWrites - 1);
        this.resolveDrainIfIdle();
      });
    } catch (error) {
      this.pendingWrites = Math.max(0, this.pendingWrites - 1);
      this.disable();
      throw error;
    }
  }

  resize(cols: number, rows: number): void {
    const term = this.requireTerminal();

    try {
      term.resize(cols, rows);
      this.cols = cols;
      this.rows = rows;
    } catch (error) {
      this.disable();
      throw error;
    }
  }

  async snapshot(): Promise<TerminalSnapshot> {
    this.requireTerminal();
    const addon = this.requireAddon();
    await this.waitForPendingWrites();

    try {
      return {
        data: addon.serialize(),
        seq: this.mirroredSeq,
        cols: this.cols,
        rows: this.rows,
      };
    } catch (error) {
      this.disable();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.term?.dispose();
    this.addon?.dispose();
    this.term = null;
    this.addon = null;
    this.disabledState = true;
    this.pendingWrites = 0;
    this.resolveDrainIfIdle();
  }

  private waitForPendingWrites(): Promise<void> {
    if (this.pendingWrites === 0) return Promise.resolve();

    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private resolveDrainIfIdle(): void {
    if (this.pendingWrites !== 0) return;

    const resolvers = this.drainResolvers;
    this.drainResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  private requireTerminal(): HeadlessTerminal {
    if (this.disposed || this.disabledState || !this.term) {
      throw new SnapshotUnsupportedError();
    }
    return this.term;
  }

  private requireAddon(): SerializeAddon {
    if (this.disposed || this.disabledState || !this.addon) {
      throw new SnapshotUnsupportedError();
    }
    return this.addon;
  }

  private disable(): void {
    this.disabledState = true;
    this.resolveDrainIfIdle();
  }
}
