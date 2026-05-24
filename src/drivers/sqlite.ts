import * as path from 'path';
import * as fs from 'fs';
import { SqliteConfig, QueryResult } from '../types';
import { getExtensionPath } from '../extensionContext';

const BATCH_SIZE = 500;

function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) { return 'NULL'; }
  if (typeof v === 'boolean') { return v ? '1' : '0'; }
  if (typeof v === 'number') { return String(v); }
  if (v instanceof Date) { return `'${v.toISOString().replace(/'/g, "''")}'`; }
  return `'${String(v).replace(/'/g, "''")}'`;
}

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

    // sql.js is in-memory only — persist changes to disk for DML statements
    if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b/i.test(sql)) {
      fs.writeFileSync(config.filePath, Buffer.from(db.export()));
    }

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

export function explainSql(sql: string): string {
  return `EXPLAIN QUERY PLAN ${sql}`;
}

export async function bulkLoad(
  config: SqliteConfig,
  _password: string | undefined,
  tableName: string,
  columns: string[],
  rows: unknown[][]
): Promise<{ inserted: number }> {
  if (columns.length === 0) { return { inserted: 0 }; }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js') as (opts: { locateFile: (f: string) => string }) => Promise<SqlJsStatic>;
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(getExtensionPath(), 'node_modules', 'sql.js', 'dist', file),
  });

  const fileBuffer = fs.readFileSync(config.filePath);
  const db = new SQL.Database(fileBuffer);
  try {
    const tbl = quoteId(tableName);
    db.run(`DELETE FROM ${tbl}`);

    if (rows.length > 0) {
      const colList = columns.map(quoteId).join(', ');
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const vals = batch.map(row => `(${row.map(fmtVal).join(', ')})`).join(',\n');
        db.run(`INSERT INTO ${tbl} (${colList}) VALUES\n${vals}`);
      }
    }

    fs.writeFileSync(config.filePath, Buffer.from(db.export()));
    return { inserted: rows.length };
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
  run(sql: string): void;
  export(): Uint8Array;
  close(): void;
}
