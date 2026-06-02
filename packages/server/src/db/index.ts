import { SCHEMA_SQL } from './schema.js';

// Runtime-adaptive SQLite: bun:sqlite in Bun, better-sqlite3 in Node.js (Vitest)
const isBun = typeof globalThis.Bun !== 'undefined';

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
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

export class Database {
  private db: SqliteDb;

  constructor(path: string) {
    this.db = new NativeDb(path);
    this.db.exec(SCHEMA_SQL);
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
