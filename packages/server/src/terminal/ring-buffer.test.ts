import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring-buffer.js';

describe('RingBuffer', () => {
  it('stores and retrieves lines', () => {
    const buf = new RingBuffer(100);
    buf.push('line1');
    buf.push('line2');
    expect(buf.getAll()).toEqual(['line1', 'line2']);
  });

  it('evicts oldest when full', () => {
    const buf = new RingBuffer(3);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    buf.push('d');
    expect(buf.getAll()).toEqual(['b', 'c', 'd']);
  });

  it('returns snapshot since given index', () => {
    const buf = new RingBuffer(100);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    const snapshot = buf.getSince(1);
    expect(snapshot).toEqual(['b', 'c']);
  });

  it('handles empty buffer', () => {
    const buf = new RingBuffer(100);
    expect(buf.getAll()).toEqual([]);
    expect(buf.getSince(0)).toEqual([]);
  });

  it('tracks current index', () => {
    const buf = new RingBuffer(100);
    expect(buf.currentIndex).toBe(0);
    buf.push('a');
    expect(buf.currentIndex).toBe(1);
    buf.push('b');
    expect(buf.currentIndex).toBe(2);
  });

  it('returns sequenced chunks when data is pushed', () => {
    const buf = new RingBuffer(10);

    const first = buf.push('abc');
    const second = buf.push('你');

    expect(first).toEqual({ data: 'abc', seqStart: 0, seq: 3 });
    expect(second).toEqual({ data: '你', seqStart: 3, seq: 6 });
    expect(buf.currentSeq).toBe(6);
    expect(buf.oldestSeq).toBe(0);
    expect(buf.getChunks()).toEqual([first, second]);
  });

  it('replays chunks strictly after a rendered sequence', () => {
    const buf = new RingBuffer(10);
    buf.push('first');
    const second = buf.push('second');
    const third = buf.push('third');

    expect(buf.replayFrom(second.seqStart)).toEqual({
      status: 'ok',
      chunks: [second, third],
      seq: third.seq,
    });
    expect(buf.replayFrom(second.seq)).toEqual({
      status: 'ok',
      chunks: [third],
      seq: third.seq,
    });
    expect(buf.replayFrom(third.seq)).toEqual({
      status: 'ok',
      chunks: [],
      seq: third.seq,
    });
  });

  it('reports too_old when requested sequence predates retained chunks', () => {
    const buf = new RingBuffer(2);
    const first = buf.push('one');
    const second = buf.push('two');
    const third = buf.push('three');

    expect(buf.oldestSeq).toBe(second.seqStart);
    expect(buf.replayFrom(first.seqStart)).toEqual({
      status: 'too_old',
      oldestSeq: second.seqStart,
      seq: third.seq,
    });
  });
});
