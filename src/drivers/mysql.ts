import { MysqlConfig, QueryResult } from '../types';

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
