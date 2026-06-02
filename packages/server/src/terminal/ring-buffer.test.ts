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
});
