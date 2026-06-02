import { describe, expect, it } from 'vitest';
import { BinaryFrameType } from '../types/ws.js';
import { decodeBinaryFrame, encodeBinaryFrame } from './binary.js';

describe('binary protocol', () => {
  it('encode and decode output frame', () => {
    const frame = encodeBinaryFrame(BinaryFrameType.OUTPUT, 'term-1', 'hello');
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.type).toBe(BinaryFrameType.OUTPUT);
    expect(decoded.terminalId).toBe('term-1');
    expect(decoded.payload).toBe('hello');
  });

  it('encode and decode input frame', () => {
    const frame = encodeBinaryFrame(BinaryFrameType.INPUT, 'term-1', 'ls\n');
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.type).toBe(BinaryFrameType.INPUT);
    expect(decoded.terminalId).toBe('term-1');
    expect(decoded.payload).toBe('ls\n');
  });

  it('encode and decode resize frame', () => {
    const payload = JSON.stringify({ cols: 120, rows: 40 });
    const frame = encodeBinaryFrame(BinaryFrameType.RESIZE, 'term-1', payload);
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.type).toBe(BinaryFrameType.RESIZE);
    expect(decoded.terminalId).toBe('term-1');
    expect(JSON.parse(decoded.payload)).toEqual({ cols: 120, rows: 40 });
  });

  it('encode and decode empty payload', () => {
    const frame = encodeBinaryFrame(BinaryFrameType.OUTPUT, 't', '');
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.type).toBe(BinaryFrameType.OUTPUT);
    expect(decoded.terminalId).toBe('t');
    expect(decoded.payload).toBe('');
  });

  it('encode and decode unicode payload', () => {
    const frame = encodeBinaryFrame(BinaryFrameType.OUTPUT, 'term-1', '你好世界');
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.payload).toBe('你好世界');
  });
});
