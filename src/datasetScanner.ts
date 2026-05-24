import * as path from 'path';
import * as vscode from 'vscode';
import { DatasetFile } from './types';

/**
 * Scan the workspace for CSV and Excel fixture files under convention directories.
 * globs: array of glob patterns (e.g. ["**\/fixtures\/**", "**\/testdata\/**"])
 */
export async function scanDatasetFiles(globs: string[]): Promise<DatasetFile[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) { return []; }

  const results: DatasetFile[] = [];
  const seen = new Set<string>();

  for (const folder of workspaceFolders) {
    for (const globPattern of globs) {
      // Append file extension filter to each directory glob
      for (const ext of ['csv', 'xlsx']) {
        const pattern = new vscode.RelativePattern(folder, `${globPattern.replace(/\/$/, '')}/*.${ext}`);
        const found = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
        for (const uri of found) {
          const fsPath = uri.fsPath;
          if (seen.has(fsPath)) { continue; }
          seen.add(fsPath);
          const label = path.basename(fsPath);
          const fileType = ext as 'csv' | 'xlsx';
          const sheets = await readSheetNames(fsPath, fileType);
          results.push({ path: fsPath, label, fileType, sheets });
        }
      }
    }
  }

  return results.sort((a, b) => a.label.localeCompare(b.label));
}

async function readSheetNames(filePath: string, fileType: 'csv' | 'xlsx'): Promise<string[]> {
  if (fileType === 'csv') {
    return [path.basename(filePath, '.csv')];
  }
  try {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return workbook.worksheets.map(ws => ws.name);
  } catch {
    return [];
  }
}
