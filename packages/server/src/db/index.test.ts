import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from './index.js';

describe('Database', () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-test-${randomUUID()}.db`);
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {}
  });

  it('creates tables on init', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('terminals');
  });
});
