import * as path from 'path';
import * as vscode from 'vscode';
import { DatasetFile } from './types';

/**
 * Scan the workspace for CSV and Excel fixture files under convention directories.
 * globs: array of glob patterns (e.g. ["**\/fixtures\/**", "**\/testdata\/**"])
 *
 * All findFiles calls run in parallel. xlsx sheet names are NOT read here —
 * they are loaded lazily when the DatasetLoaderPanel opens the file.
 */
export async function scanDatasetFiles(globs: string[]): Promise<DatasetFile[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) { return []; }

  // Build all (folder × glob × ext) tasks and run them in parallel
  const tasks: Thenable<vscode.Uri[]>[] = [];
  const taskExts: string[] = [];

  for (const folder of workspaceFolders) {
    for (const globPattern of globs) {
      for (const ext of ['csv', 'xlsx']) {
        const pattern = new vscode.RelativePattern(folder, `${globPattern.replace(/\/$/, '')}/*.${ext}`);
        tasks.push(vscode.workspace.findFiles(pattern, '{**/node_modules/**,**/target/**,**/build/**,**/dist/**,**/out/**,.git/**,**/.gradle/**}', 200));
        taskExts.push(ext);
      }
    }
  }

  const allResults = await Promise.all(tasks);

  const seen = new Set<string>();
  const results: DatasetFile[] = [];

  for (let i = 0; i < allResults.length; i++) {
    const ext = taskExts[i];
    for (const uri of allResults[i]) {
      const fsPath = uri.fsPath;
      if (seen.has(fsPath)) { continue; }
      seen.add(fsPath);
      const label = path.basename(fsPath);
      const fileType = ext as 'csv' | 'xlsx';
      // csv: use filename as sheet name; xlsx: defer sheet reading to loader panel
      const sheets = fileType === 'csv' ? [path.basename(fsPath, '.csv')] : [];
      results.push({ path: fsPath, label, fileType, sheets });
    }
  }

  return results.sort((a, b) => a.label.localeCompare(b.label));
}
