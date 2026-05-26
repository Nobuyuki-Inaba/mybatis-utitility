import * as path from 'path';
import { CsvReader, XlsxReader, getSheetReader } from '../src/sheetReader';
import { readSheetData } from '../src/datasetLoader';

const FIXTURES = path.join(__dirname, '..', 'sample', 'fixtures');
const SAMPLE_CSV  = path.join(FIXTURES, 'sample.csv');
const USERS_CSV   = path.join(FIXTURES, 'users.csv');
const TESTDATA_XLSX = path.join(FIXTURES, 'testdata.xlsx');

// ---------------------------------------------------------------------------
// CsvReader
// ---------------------------------------------------------------------------

describe('CsvReader', () => {
  const reader = new CsvReader();

  test('extensions contains .csv', () => {
    expect(reader.extensions).toContain('.csv');
  });

  test('listSheets returns [basename without extension]', async () => {
    expect(await reader.listSheets(SAMPLE_CSV)).toEqual(['sample']);
    expect(await reader.listSheets(USERS_CSV)).toEqual(['users']);
  });

  test('readSheet returns expected columns for sample.csv', async () => {
    const { columns, rows } = await reader.readSheet(SAMPLE_CSV, 'sample');
    expect(columns).toEqual(['id', 'name', 'status', 'update_date']);
    expect(rows.length).toBe(7);
  });

  test('readSheet returns expected columns for users.csv', async () => {
    const { columns, rows } = await reader.readSheet(USERS_CSV, 'users');
    expect(columns).toEqual(['id', 'name', 'email', 'created_at']);
    expect(rows.length).toBe(8);
  });

  test('readSheet rows contain correct first-row values', async () => {
    const { rows } = await reader.readSheet(SAMPLE_CSV, 'sample');
    // First data row: id=alice, name="Alice Smith"
    expect(String(rows[0][0])).toBe('alice');
    expect(String(rows[0][1])).toBe('Alice Smith');
  });

  test('readSheet ignores sheetName (CSV has only one sheet)', async () => {
    const a = await reader.readSheet(SAMPLE_CSV, 'sample');
    const b = await reader.readSheet(SAMPLE_CSV, 'anything');
    expect(a.columns).toEqual(b.columns);
    expect(a.rows.length).toBe(b.rows.length);
  });
});

// ---------------------------------------------------------------------------
// XlsxReader
// ---------------------------------------------------------------------------

describe('XlsxReader', () => {
  const reader = new XlsxReader();

  test('extensions contains .xlsx', () => {
    expect(reader.extensions).toContain('.xlsx');
  });

  test('listSheets returns a non-empty array of strings', async () => {
    const sheets = await reader.listSheets(TESTDATA_XLSX);
    expect(sheets.length).toBeGreaterThan(0);
    sheets.forEach(s => expect(typeof s).toBe('string'));
  });

  test('readSheet returns non-empty columns for first sheet', async () => {
    const sheets = await reader.listSheets(TESTDATA_XLSX);
    const { columns } = await reader.readSheet(TESTDATA_XLSX, sheets[0]);
    expect(columns.length).toBeGreaterThan(0);
  });

  test('readSheet rows are arrays', async () => {
    const sheets = await reader.listSheets(TESTDATA_XLSX);
    const { rows } = await reader.readSheet(TESTDATA_XLSX, sheets[0]);
    rows.forEach(row => expect(Array.isArray(row)).toBe(true));
  });

  test('readSheet throws for a sheet that does not exist', async () => {
    await expect(
      reader.readSheet(TESTDATA_XLSX, '__no_such_sheet_xyz__')
    ).rejects.toThrow(/__no_such_sheet_xyz__/);
  });
});

// ---------------------------------------------------------------------------
// getSheetReader
// ---------------------------------------------------------------------------

describe('getSheetReader', () => {
  test('returns CsvReader for .csv', () => {
    expect(getSheetReader('data.csv')).toBeInstanceOf(CsvReader);
  });

  test('returns CsvReader for uppercase .CSV', () => {
    expect(getSheetReader('data.CSV')).toBeInstanceOf(CsvReader);
  });

  test('returns XlsxReader for .xlsx', () => {
    expect(getSheetReader('data.xlsx')).toBeInstanceOf(XlsxReader);
  });

  test('returns XlsxReader for uppercase .XLSX', () => {
    expect(getSheetReader('data.XLSX')).toBeInstanceOf(XlsxReader);
  });

  test('throws for unknown extension', () => {
    expect(() => getSheetReader('data.json')).toThrow(/No sheet reader/);
  });

  test('throws for no extension', () => {
    expect(() => getSheetReader('datafile')).toThrow(/No sheet reader/);
  });
});

// ---------------------------------------------------------------------------
// readSheetData (integration via datasetLoader)
// ---------------------------------------------------------------------------

describe('readSheetData', () => {
  test('reads CSV via readSheetData', async () => {
    const { columns, rows } = await readSheetData(SAMPLE_CSV, 'sample');
    expect(columns).toEqual(['id', 'name', 'status', 'update_date']);
    expect(rows.length).toBeGreaterThan(0);
  });

  test('reads XLSX via readSheetData', async () => {
    const sheets = await getSheetReader(TESTDATA_XLSX).listSheets(TESTDATA_XLSX);
    const { columns } = await readSheetData(TESTDATA_XLSX, sheets[0]);
    expect(columns.length).toBeGreaterThan(0);
  });
});
