import { describe, expect, it } from 'vitest';
import {
  filterRenderableLiveChunks,
  isRecoveryReconcileData,
  isTerminalOutputData,
  isTerminalReplayData,
  isTerminalSnapshotData,
} from './terminal-recovery.js';

describe('terminal recovery helpers', () => {
  it('validates sequenced terminal output payloads', () => {
    expect(isTerminalOutputData({ sessionId: 's1', data: 'abc', seqStart: 0, seq: 3 }, 's1')).toBe(
      true,
    );
    expect(isTerminalOutputData({ sessionId: 's1', data: 'abc' }, 's1')).toBe(false);
    expect(
      isTerminalOutputData({ sessionId: 'other', data: 'abc', seqStart: 0, seq: 3 }, 's1'),
    ).toBe(false);
  });

  it('validates replay responses', () => {
    expect(
      isTerminalReplayData(
        {
          status: 'ok',
          sessionId: 's1',
          chunks: [{ data: 'abc', seqStart: 0, seq: 3 }],
          seq: 3,
        },
        's1',
      ),
    ).toBe(true);
    expect(
      isTerminalReplayData({ status: 'too_old', sessionId: 's1', oldestSeq: 4, seq: 8 }, 's1'),
    ).toBe(true);
    expect(isTerminalReplayData({ sessionId: 's1', chunks: ['abc'] }, 's1')).toBe(false);
  });

  it('validates reconcile responses', () => {
    expect(isRecoveryReconcileData({ action: 'noop', sessionId: 's1', headSeq: 3 }, 's1')).toBe(
      true,
    );
    expect(
      isRecoveryReconcileData({ action: 'snapshot', sessionId: 's1', headSeq: 12 }, 's1'),
    ).toBe(true);
    expect(
      isRecoveryReconcileData(
        { action: 'unrecoverable', sessionId: 's1', reason: 'too_old_no_snapshot' },
        's1',
      ),
    ).toBe(true);
    expect(isRecoveryReconcileData({ action: 'noop', sessionId: 'other', headSeq: 3 }, 's1')).toBe(
      false,
    );
  });

  it('validates snapshot responses', () => {
    expect(
      isTerminalSnapshotData(
        {
          status: 'ok',
          sessionId: 's1',
          data: 'serialized screen',
          seq: 17,
          cols: 100,
          rows: 30,
        },
        's1',
      ),
    ).toBe(true);
    expect(isTerminalSnapshotData({ status: 'unknown', sessionId: 's1' }, 's1')).toBe(true);
    expect(
      isTerminalSnapshotData(
        { status: 'ok', sessionId: 's1', data: 'bad', seq: 1, cols: 0, rows: 30 },
        's1',
      ),
    ).toBe(false);
  });

  it('filters live chunks that have already been rendered', () => {
    const chunks = [
      { data: 'old', seqStart: 0, seq: 3 },
      { data: 'next', seqStart: 3, seq: 7 },
      { data: 'future', seqStart: 7, seq: 13 },
    ];

    expect(filterRenderableLiveChunks(chunks, 7)).toEqual([chunks[2]]);
  });
});
