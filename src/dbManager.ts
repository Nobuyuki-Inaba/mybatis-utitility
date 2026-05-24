/**
 * dbManager.ts — driver registry.
 *
 * To support a new database type:
 *   1. Add the type to DbType in types.ts
 *   2. Create src/drivers/<type>.ts exporting execute()
 *   3. Call registerDriver() here
 * No other files need to change.
 */

import { DbConnectionConfig, DbType, QueryResult } from './types';
import * as sqliteDriver from './drivers/sqlite';
import * as postgresDriver from './drivers/postgresql';
import * as mysqlDriver from './drivers/mysql';

// ---------------------------------------------------------------------------
// Driver interface
// ---------------------------------------------------------------------------

export interface DbDriver {
  execute(
    config: DbConnectionConfig,
    password: string | undefined,
    sql: string,
    maxRows: number
  ): Promise<QueryResult>;
  /** Wrap sql with the DB-specific EXPLAIN prefix. */
  explainSql(sql: string): string;
  /**
   * Delete all rows from tableName then bulk-insert columns/rows using the
   * most efficient method available for this DB type (e.g. COPY for PG).
   * Implementations are responsible for atomicity (transaction / single write).
   */
  bulkLoad(
    config: DbConnectionConfig,
    password: string | undefined,
    tableName: string,
    columns: string[],
    rows: unknown[][]
  ): Promise<{ inserted: number }>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<DbType, DbDriver>();

export function registerDriver(type: DbType, driver: DbDriver): void {
  registry.set(type, driver);
}

export const DEFAULT_MAX_ROWS = 5000;

export function executeQuery(
  config: DbConnectionConfig,
  password: string | undefined,
  sql: string,
  maxRows = DEFAULT_MAX_ROWS
): Promise<QueryResult> {
  const driver = registry.get(config.type);
  if (!driver) {
    throw new Error(`No driver registered for database type: "${config.type}"`);
  }
  return driver.execute(config, password, sql, maxRows);
}

export function explainQuery(
  config: DbConnectionConfig,
  password: string | undefined,
  sql: string
): Promise<QueryResult> {
  const driver = registry.get(config.type);
  if (!driver) {
    throw new Error(`No driver registered for database type: "${config.type}"`);
  }
  return driver.execute(config, password, driver.explainSql(sql), DEFAULT_MAX_ROWS);
}

export function bulkLoad(
  config: DbConnectionConfig,
  password: string | undefined,
  tableName: string,
  columns: string[],
  rows: unknown[][]
): Promise<{ inserted: number }> {
  const driver = registry.get(config.type);
  if (!driver) {
    throw new Error(`No driver registered for database type: "${config.type}"`);
  }
  return driver.bulkLoad(config, password, tableName, columns, rows);
}

// ---------------------------------------------------------------------------
// Built-in driver registrations
// ---------------------------------------------------------------------------

registerDriver('sqlite', {
  execute: (c, p, s, m) => sqliteDriver.execute(c as Parameters<typeof sqliteDriver.execute>[0], p, s, m),
  explainSql: (sql) => sqliteDriver.explainSql(sql),
  bulkLoad: (c, p, t, cols, rows) => sqliteDriver.bulkLoad(c as Parameters<typeof sqliteDriver.execute>[0], p, t, cols, rows),
});

registerDriver('postgresql', {
  execute: (c, p, s, m) => postgresDriver.execute(c as Parameters<typeof postgresDriver.execute>[0], p, s, m),
  explainSql: (sql) => postgresDriver.explainSql(sql),
  bulkLoad: (c, p, t, cols, rows) => postgresDriver.bulkLoad(c as Parameters<typeof postgresDriver.execute>[0], p, t, cols, rows),
});

registerDriver('mysql', {
  execute: (c, p, s, m) => mysqlDriver.execute(c as Parameters<typeof mysqlDriver.execute>[0], p, s, m),
  explainSql: (sql) => mysqlDriver.explainSql(sql),
  bulkLoad: (c, p, t, cols, rows) => mysqlDriver.bulkLoad(c as Parameters<typeof mysqlDriver.execute>[0], p, t, cols, rows),
});
