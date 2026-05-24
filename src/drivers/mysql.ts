import { MysqlConfig, QueryResult } from '../types';

export function explainSql(sql: string): string {
  return `EXPLAIN ${sql}`;
}

const BATCH_SIZE = 500;

function quoteId(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) { return 'NULL'; }
  if (typeof v === 'boolean') { return v ? 'TRUE' : 'FALSE'; }
  if (typeof v === 'number') { return String(v); }
  if (v instanceof Date) { return `'${v.toISOString().replace(/'/g, "''")}'`; }
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function bulkLoad(
  config: MysqlConfig,
  password: string | undefined,
  tableName: string,
  columns: string[],
  rows: unknown[][]
): Promise<{ inserted: number }> {
  if (columns.length === 0) { return { inserted: 0 }; }

  const mysql2 = await import('mysql2/promise');
  const conn = await mysql2.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password,
  });
  try {
    await conn.beginTransaction();
    const tbl = quoteId(tableName);
    await conn.execute(`DELETE FROM ${tbl}`);

    if (rows.length > 0) {
      const colList = columns.map(quoteId).join(', ');
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const vals = batch.map(row => `(${row.map(fmtVal).join(', ')})`).join(',\n');
        await conn.execute(`INSERT INTO ${tbl} (${colList}) VALUES\n${vals}`);
      }
    }

    await conn.commit();
    return { inserted: rows.length };
  } catch (err) {
    await conn.rollback().catch(() => { /* ignore */ });
    throw err;
  } finally {
    await conn.end();
  }
}

export async function execute(config: MysqlConfig, password: string | undefined, sql: string, maxRows: number): Promise<QueryResult> {
  const start = Date.now();
  const mysql2 = await import('mysql2/promise');
  const conn = await mysql2.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password,
  });
  try {
    const [rows, fields] = await conn.query(sql);
    const columns = (fields as Array<{ name: string }>).map(f => f.name);
    const allRows = (rows as Record<string, unknown>[]).map(r => columns.map(c => r[c]));
    const truncated = allRows.length > maxRows;
    const dataRows = truncated ? allRows.slice(0, maxRows) : allRows;
    return {
      columns,
      rows: dataRows,
      rowCount: dataRows.length,
      durationMs: Date.now() - start,
      truncated,
    };
  } finally {
    await conn.end();
  }
}
