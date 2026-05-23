import * as path from 'path';
import * as fs from 'fs';
import { SqliteConfig, QueryResult } from '../types';
import { getExtensionPath } from '../extensionContext';

export async function execute(config: SqliteConfig, _password: string | undefined, sql: string, maxRows: number): Promise<QueryResult> {
  const start = Date.now();

  // sql.js is marked external in esbuild — locate its WASM at runtime via extension path
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js') as (opts: { locateFile: (f: string) => string }) => Promise<SqlJsStatic>;
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(getExtensionPath(), 'node_modules', 'sql.js', 'dist', file),
  });

  const fileBuffer = fs.readFileSync(config.filePath);
  const db = new SQL.Database(fileBuffer);
  try {
    const results = db.exec(sql);
    if (results.length === 0) {
      return { columns: [], rows: [], rowCount: 0, durationMs: Date.now() - start };
    }
    const { columns, values } = results[0];
    const allRows = values as unknown[][];
    const truncated = allRows.length > maxRows;
    const rows = truncated ? allRows.slice(0, maxRows) : allRows;
    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - start,
      truncated,
    };
  } finally {
    db.close();
  }
}

// Minimal type shim so TypeScript is happy without @types/sql.js installed
interface SqlJsStatic {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlDatabase;
}
interface SqlDatabase {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
}
