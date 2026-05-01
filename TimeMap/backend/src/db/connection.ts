import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import fs from 'node:fs';

type QueryParam = number | string | null;
export type { Database };

let _db: Database | null = null;
let _dbPath = '';

export async function openDb(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();
  _dbPath = dbPath;
  if (fs.existsSync(dbPath)) {
    const data = fs.readFileSync(dbPath);
    _db = new SQL.Database(data);
  } else {
    _db = new SQL.Database();
  }
  return _db;
}

export function getDb(): Database {
  if (!_db) throw new Error('Database not initialized — call openDb() first');
  return _db;
}

export function persist(): void {
  if (!_db || !_dbPath) return;
  const data = _db.export();
  fs.writeFileSync(_dbPath, Buffer.from(data));
}

export function queryAll<T>(sql: string, params: QueryParam[] = []): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return rows;
}

export function queryOne<T>(sql: string, params: QueryParam[] = []): T | undefined {
  return queryAll<T>(sql, params)[0];
}

export function execute(sql: string, params: QueryParam[] = []): void {
  getDb().run(sql, params);
}
