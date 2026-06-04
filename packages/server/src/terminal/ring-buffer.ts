import { Buffer } from 'node:buffer';
import type { TerminalOutputChunk } from '@cubby/core';

export type RingBufferReplayResult =
  | {
      status: 'ok';
      chunks: TerminalOutputChunk[];
      seq: number;
    }
  | {
      status: 'too_old';
      oldestSeq: number;
      seq: number;
    };

export class RingBuffer {
  private chunks: TerminalOutputChunk[];
  private maxSize: number;
  private index = 0;
  private seq = 0;

  constructor(maxSize: number = 5000) {
    this.chunks = [];
    this.maxSize = maxSize;
  }

  push(data: string): TerminalOutputChunk {
    const seqStart = this.seq;
    const seq = seqStart + Buffer.byteLength(data, 'utf8');
    const chunk: TerminalOutputChunk = { data, seqStart, seq };

    if (this.chunks.length >= this.maxSize) {
      this.chunks.shift();
    }

    this.chunks.push(chunk);
    this.index++;
    this.seq = seq;

    return { ...chunk };
  }

  getAll(): string[] {
    return this.chunks.map((chunk) => chunk.data);
  }

  getSince(index: number): string[] {
    const start = index - (this.index - this.chunks.length);
    if (start < 0) return this.getAll();
    return this.chunks.slice(start).map((chunk) => chunk.data);
  }

  getChunks(): TerminalOutputChunk[] {
    return this.chunks.map((chunk) => ({ ...chunk }));
  }

  replayFrom(lastSeq: number): RingBufferReplayResult {
    if (!this.canReplayFrom(lastSeq)) {
      return {
        status: 'too_old',
        oldestSeq: this.oldestSeq,
        seq: this.seq,
      };
    }

    return {
      status: 'ok',
      chunks: this.chunks.filter((chunk) => chunk.seq > lastSeq).map((chunk) => ({ ...chunk })),
      seq: this.seq,
    };
  }

  canReplayFrom(lastSeq: number): boolean {
    return this.chunks.length === 0 || lastSeq >= this.oldestSeq;
  }

  get currentIndex(): number {
    return this.index;
  }

  get currentSeq(): number {
    return this.seq;
  }

  get oldestSeq(): number {
    return this.chunks[0]?.seqStart ?? this.seq;
  }
}
