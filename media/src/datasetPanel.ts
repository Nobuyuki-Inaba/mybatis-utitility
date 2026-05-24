/**
 * Webview script for the Dataset sidebar panel.
 * DOM only — no Node.js APIs.
 */

import type { DatasetFile, DatasetToWebMsg, WebToDatasetMsg } from '../../src/types';

declare function acquireVsCodeApi(): { postMessage(msg: WebToDatasetMsg): void };
const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let files: DatasetFile[] = [];
let displayMode: 'flat' | 'tree' = 'flat';
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function filterText(): string {
  const inp = document.getElementById('filter-input') as HTMLInputElement | null;
  return inp?.value.toLowerCase().trim() ?? '';
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function filteredFiles(): DatasetFile[] {
  const f = filterText();
  if (!f) { return files; }
  return files.filter(file =>
    file.label.toLowerCase().includes(f) ||
    file.sheets.some(s => s.toLowerCase().includes(f))
  );
}

function renderFileRow(f: DatasetFile, indented = false): string {
  const sheetInfo = f.sheets.length > 1
    ? `${f.sheets.length} sheets`
    : f.sheets[0] ?? '';
  const indentClass = indented ? ' indent' : '';
  return `<div class="file-row${indentClass}" data-path="${escHtml(f.path)}">
    <span class="type-badge ${escHtml(f.fileType)}">${escHtml(f.fileType.toUpperCase())}</span>
    <span class="file-label" title="${escHtml(f.path)}">${escHtml(f.label)}</span>
    <span class="sheet-count">${escHtml(sheetInfo)}</span>
  </div>`;
}

function renderGrouped(visibleFiles: DatasetFile[]): string {
  const folderMap = new Map<string, DatasetFile[]>();
  for (const f of visibleFiles) {
    const dir = f.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (!folderMap.has(dir)) { folderMap.set(dir, []); }
    folderMap.get(dir)!.push(f);
  }
  let html = '';
  for (const [dir, dirFiles] of [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const label = dir.split('/').slice(-3).join('/');
    html += `<div class="folder-row"><span class="folder-chevron">▾</span>${escHtml(label)}</div>`;
    html += dirFiles.map(f => renderFileRow(f, true)).join('');
  }
  return html;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(): void {
  const list = el('list');
  const visible = filteredFiles();
  const f = filterText();

  if (files.length === 0) {
    list.innerHTML = `<div class="empty">No dataset files found.<br>
      Add CSV or Excel files under fixture, testdata, or dataset directories.</div>`;
    return;
  }

  if (visible.length === 0) {
    list.innerHTML = `<div class="empty">No results for "<strong>${escHtml(f)}</strong>"</div>`;
    return;
  }

  if (displayMode === 'flat') {
    list.innerHTML = visible.map(f => renderFileRow(f)).join('');
  } else {
    list.innerHTML = renderGrouped(visible);
  }

  list.querySelectorAll<HTMLElement>('.file-row').forEach(row => {
    row.addEventListener('click', () => {
      const fsPath = row.dataset.path ?? '';
      const file = files.find(f => f.path === fsPath);
      if (file) {
        vscode.postMessage({ type: 'openLoader', file });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Messages from extension
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent<DatasetToWebMsg>) => {
  const msg = event.data;
  if (msg.type === 'setFiles') {
    files = msg.items;
    render();
  } else if (msg.type === 'setDisplayMode') {
    displayMode = msg.mode;
    render();
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  const input = el<HTMLInputElement>('filter-input');
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 150);
  });
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { input.value = ''; render(); }
  });
  render();
});
