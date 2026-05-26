import { DbConnectionConfig } from './types';
import { bulkLoad as dbBulkLoad } from './dbManager';
import { getSheetReader } from './sheetReader';

export type { SheetData } from './sheetReader';

/**
 * Read rows from a sheet in an xlsx or csv file.
 * First row is treated as column headers.
 */
export function readSheetData(
  filePath: string,
  sheetName: string
): Promise<import('./sheetReader').SheetData> {
  return getSheetReader(filePath).readSheet(filePath, sheetName);
}

/**
 * Delete all rows from tableName, then bulk-insert using the driver's optimized method.
 * Returns the number of rows inserted.
 */
export function loadSheetToDb(
  config: DbConnectionConfig,
  password: string | undefined,
  tableName: string,
  columns: string[],
  rows: unknown[][]
): Promise<{ inserted: number }> {
  return dbBulkLoad(config, password, tableName, columns, rows);
}
