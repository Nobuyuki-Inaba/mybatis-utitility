import { DbConnectionConfig } from './types';
import { bulkLoad as dbBulkLoad } from './dbManager';

export interface SheetData {
  columns: string[];
  rows: unknown[][];
}

/**
 * Read rows from a sheet in an xlsx or csv file.
 * First row is treated as column headers.
 */
export async function readSheetData(filePath: string, sheetName: string): Promise<SheetData> {
  if (filePath.toLowerCase().endsWith('.csv')) {
    return readCsvData(filePath);
  }
  return readXlsxSheet(filePath, sheetName);
}

async function readCsvData(filePath: string): Promise<SheetData> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.csv.readFile(filePath);
  const ws = workbook.worksheets[0];
  return extractSheetData(ws);
}

async function readXlsxSheet(filePath: string, sheetName: string): Promise<SheetData> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) { throw new Error(`Sheet "${sheetName}" not found in ${filePath}`); }
  return extractSheetData(ws);
}

function extractSheetData(ws: import('exceljs').Worksheet): SheetData {
  const allRows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-indexed; index 0 is undefined
    const values = (row.values as unknown[]).slice(1);
    allRows.push(values.map(v => {
      if (v === null || v === undefined) { return null; }
      if (typeof v === 'object' && 'text' in (v as object)) {
        // Rich text cell
        return (v as { text: string }).text;
      }
      return v;
    }));
  });

  if (allRows.length === 0) { return { columns: [], rows: [] }; }
  const columns = allRows[0].map(String);
  const rows = allRows.slice(1);
  return { columns, rows };
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
