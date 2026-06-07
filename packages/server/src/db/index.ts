import { SCHEMA_SQL } from './schema.js';

// Runtime-adaptive SQLite: bun:sqlite in Bun, better-sqlite3 in Node.js (Vitest)
const isBun = typeof globalThis.Bun !== 'undefined';

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

interface SqliteConstructor {
  new (path: string): SqliteDb;
}

let NativeDb: SqliteConstructor;
if (isBun) {
  const { Database } = await import('bun:sqlite');
  NativeDb = Database;
} else {
  const { default: BetterSqlite3 } = await import('better-sqlite3');
  NativeDb = BetterSqlite3;
}

function ensureTerminalOutputSequenceColumns(db: SqliteDb): void {
  const columns = db.prepare('PRAGMA table_info(terminal_outputs)').all() as Array<{
    name?: unknown;
  }>;
  const names = new Set(columns.map((column) => String(column.name)));

  if (!names.has('seq_start')) {
    db.exec('ALTER TABLE terminal_outputs ADD COLUMN seq_start INTEGER');
  }
  if (!names.has('seq_end')) {
    db.exec('ALTER TABLE terminal_outputs ADD COLUMN seq_end INTEGER');
  }
}

function ensureSessionProviderSessionIdColumn(db: SqliteDb): void {
  const columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{
    name?: unknown;
  }>;
  const names = new Set(columns.map((column) => String(column.name)));

  if (!names.has('provider_session_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN provider_session_id TEXT');
  }
}

export class Database {
  private db: SqliteDb;

  constructor(path: string) {
    this.db = new NativeDb(path);
    this.db.exec(SCHEMA_SQL);
    ensureSessionProviderSessionIdColumn(this.db);
    ensureTerminalOutputSequenceColumns(this.db);
  }

  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  run(sql: string, params?: unknown[]) {
    const stmt = this.db.prepare(sql);
    if (params) {
      return stmt.run(...params);
    }
    return stmt.run();
  }

  close() {
    this.db.close();
  }
}
