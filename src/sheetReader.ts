import * as path from 'path';

// ---------------------------------------------------------------------------
// Shared data types
// ---------------------------------------------------------------------------

export interface SheetData {
  columns: string[];
  rows: unknown[][];
}

// ---------------------------------------------------------------------------
// SheetReader interface
// ---------------------------------------------------------------------------

/**
 * Reads tabular data from a file format.
 * Add a new format by implementing this interface and registering it via
 * registerSheetReader().
 */
export interface SheetReader {
  /** File extensions this reader handles (lower-case, with dot, e.g. '.csv') */
  readonly extensions: readonly string[];
  /** Return the names of all sheets (or sheets-equivalent) in the file */
  listSheets(filePath: string): Promise<string[]>;
  /** Read data from the named sheet; first row becomes column headers */
  readSheet(filePath: string, sheetName: string): Promise<SheetData>;
}

// ---------------------------------------------------------------------------
// CsvReader
// ---------------------------------------------------------------------------

export class CsvReader implements SheetReader {
  readonly extensions = ['.csv'] as const;

  listSheets(filePath: string): Promise<string[]> {
    return Promise.resolve([path.basename(filePath, '.csv')]);
  }

  async readSheet(filePath: string, _sheetName: string): Promise<SheetData> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.csv.readFile(filePath);
    return _extractSheetData(workbook.worksheets[0]);
  }
}

// ---------------------------------------------------------------------------
// XlsxReader
// ---------------------------------------------------------------------------

export class XlsxReader implements SheetReader {
  readonly extensions = ['.xlsx'] as const;

  async listSheets(filePath: string): Promise<string[]> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return workbook.worksheets.map(ws => ws.name);
  }

  async readSheet(filePath: string, sheetName: string): Promise<SheetData> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) { throw new Error(`Sheet "${sheetName}" not found in ${filePath}`); }
    return _extractSheetData(ws);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _readers: SheetReader[] = [new CsvReader(), new XlsxReader()];

/** Register an additional SheetReader for a new file format. */
export function registerSheetReader(reader: SheetReader): void {
  _readers.push(reader);
}

/**
 * Return the reader for the given file path.
 * Throws if no reader handles the extension.
 */
export function getSheetReader(filePath: string): SheetReader {
  const ext = path.extname(filePath).toLowerCase();
  const reader = _readers.find(r => (r.extensions as readonly string[]).includes(ext));
  if (!reader) { throw new Error(`No sheet reader registered for extension: ${ext}`); }
  return reader;
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

function _extractSheetData(ws: import('exceljs').Worksheet): SheetData {
  const allRows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as unknown[]).slice(1); // row.values is 1-indexed
    allRows.push(values.map(v => {
      if (v === null || v === undefined) { return null; }
      if (typeof v === 'object' && 'text' in (v as object)) {
        return (v as { text: string }).text; // rich text cell
      }
      return v;
    }));
  });

  if (allRows.length === 0) { return { columns: [], rows: [] }; }
  const columns = allRows[0].map(String);
  const rows = allRows.slice(1);
  return { columns, rows };
}
