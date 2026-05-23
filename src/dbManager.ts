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

// ---------------------------------------------------------------------------
// Built-in driver registrations
// ---------------------------------------------------------------------------

registerDriver('sqlite', {
  execute: (c, p, s, m) => sqliteDriver.execute(c as Parameters<typeof sqliteDriver.execute>[0], p, s, m),
});

registerDriver('postgresql', {
  execute: (c, p, s, m) => postgresDriver.execute(c as Parameters<typeof postgresDriver.execute>[0], p, s, m),
});

registerDriver('mysql', {
  execute: (c, p, s, m) => mysqlDriver.execute(c as Parameters<typeof mysqlDriver.execute>[0], p, s, m),
});
