import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { HeadlessSnapshotBuffer } from './terminal-snapshot-buffer.js';

describe('HeadlessSnapshotBuffer', () => {
  it('serializes the final visible terminal state', async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 80, rows: 24 });
    const payload = 'progress 10%\rprogress 100%\n';

    buffer.write(payload, Buffer.byteLength(payload, 'utf8'));
    const snapshot = await buffer.snapshot();

    expect(snapshot).toMatchObject({
      seq: Buffer.byteLength(payload, 'utf8'),
      cols: 80,
      rows: 24,
    });
    expect(snapshot.data).toContain('progress 100%');
    expect(snapshot.data).not.toContain('progress 10%');

    buffer.dispose();
  });

  it('tracks the sequence covered by the latest flushed write', async () => {
    const buffer = new HeadlessSnapshotBuffer({ cols: 100, rows: 30 });

    buffer.write('first line\n', 11);
    buffer.write('second line\n', 23);
    const snapshot = await buffer.snapshot();

    expect(snapshot.seq).toBe(23);
    expect(snapshot.cols).toBe(100);
    expect(snapshot.rows).toBe(30);
    expect(snapshot.data).toContain('second line');

    buffer.dispose();
  });
});
