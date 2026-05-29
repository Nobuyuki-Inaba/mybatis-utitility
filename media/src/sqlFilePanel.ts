/**
 * Webview script for the SQL Files sidebar panel.
 * DOM only — no Node.js APIs.
 */

import type { SqlFile, SqlToWebMsg, WebToSqlMsg } from '../../src/types';

declare function acquireVsCodeApi(): { postMessage(msg: WebToSqlMsg): void };
const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let files: SqlFile[] = [];
let loading = true;
let hasFolders = true;
let displayMode: 'flat' | 'tree' =
  (document.body.dataset.displayMode as 'flat' | 'tree') ?? 'flat';
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
  return (document.getElementById('filter-input') as HTMLInputElement | null)
    ?.value.toLowerCase().trim() ?? '';
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function filteredFiles(): SqlFile[] {
  const f = filterText();
  if (!f) { return files; }
  return files.filter(file =>
    file.label.toLowerCase().includes(f) ||
    file.folder.toLowerCase().includes(f)
  );
}

function renderFileRow(f: SqlFile, indented = false, showDir = false): string {
  const indentClass = indented ? ' indent' : '';
  const dirHtml = showDir && f.folder !== '.'
    ? `<span class="file-dir" title="${escHtml(f.folder)}">${escHtml(f.folder)}</span>`
    : '';
  return `<div class="file-row${indentClass}" data-path="${escHtml(f.path)}">
    <span class="sql-icon">SQL</span>
    <span class="file-label" title="${escHtml(f.path)}">${escHtml(f.label)}</span>
    ${dirHtml}
  </div>`;
}

function renderGrouped(visible: SqlFile[]): string {
  const folderMap = new Map<string, SqlFile[]>();
  for (const f of visible) {
    if (!folderMap.has(f.folder)) { folderMap.set(f.folder, []); }
    folderMap.get(f.folder)!.push(f);
  }
  let html = '';
  for (const [dir, dirFiles] of [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const label = dir === '.' ? '(root)' : dir.split('/').slice(-3).join('/');
    html += `<div class="folder-row"><span class="folder-chevron">▾</span>${escHtml(label)}</div>`;
    html += dirFiles.map(f => renderFileRow(f, true, false)).join('');
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

  if (loading) {
    list.innerHTML = `<div class="empty">Scanning…</div>`;
    return;
  }

  if (!hasFolders) {
    list.innerHTML = `<div class="empty">No workspace folder open.</div>`;
    return;
  }

  if (files.length === 0) {
    list.innerHTML = `<div class="empty">No .sql files found.<br>SQL files anywhere in the workspace will appear here.</div>`;
    return;
  }

  if (visible.length === 0) {
    list.innerHTML = `<div class="empty">No results for "<strong>${escHtml(f)}</strong>"</div>`;
    return;
  }

  if (displayMode === 'flat') {
    list.innerHTML = visible.map(f => renderFileRow(f, false, true)).join('');
  } else {
    list.innerHTML = renderGrouped(visible);
  }

  list.querySelectorAll<HTMLElement>('.file-row').forEach(row => {
    row.addEventListener('click', () => {
      const fsPath = row.dataset.path ?? '';
      if (fsPath) { vscode.postMessage({ type: 'openFile', path: fsPath }); }
    });
  });
}

// ---------------------------------------------------------------------------
// Messages from extension
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent<SqlToWebMsg>) => {
  const msg = event.data;
  if (msg.type === 'setLoading') {
    loading = msg.loading;
    render();
  } else if (msg.type === 'setFiles') {
    loading = false;
    files = msg.items;
    hasFolders = msg.hasFolders;
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
  vscode.postMessage({ type: 'ready' });
});
