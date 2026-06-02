import BetterSqlite3 from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export class Database {
  private db: InstanceType<typeof BetterSqlite3>;

  constructor(path: string) {
    this.db = new BetterSqlite3(path);
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
