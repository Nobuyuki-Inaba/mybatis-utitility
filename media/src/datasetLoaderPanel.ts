/**
 * Webview script for the Dataset Loader panel.
 * DOM only — no Node.js APIs.
 */

import type { DatasetFile, DbConnectionConfig, LoaderExtToWebMsg, LoaderWebToExtMsg, SheetMapping } from '../../src/types';

declare function acquireVsCodeApi(): { postMessage(msg: LoaderWebToExtMsg): void };
const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentFile: DatasetFile | null = null;
let connections: DbConnectionConfig[] = [];
let selectedConnectionId = '';
let mappings: SheetMapping[] = [];

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

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderConnectionPicker(): void {
  const sel = el<HTMLSelectElement>('conn-select');
  sel.innerHTML = '<option value="">-- select database --</option>' +
    connections.map(c =>
      `<option value="${escHtml(c.id)}" ${c.id === selectedConnectionId ? 'selected' : ''}>
        ${escHtml(c.label)} (${escHtml(c.type)})
      </option>`
    ).join('');
}

function renderMappings(): void {
  const tbody = el<HTMLTableSectionElement>('mapping-body');
  tbody.innerHTML = mappings.map((m, i) => `
    <tr>
      <td style="text-align:center">
        <input type="checkbox" class="m-enabled" data-index="${i}" ${m.enabled ? 'checked' : ''}>
      </td>
      <td class="sheet-name">${escHtml(m.sheetName)}</td>
      <td>
        <input class="m-table" type="text" data-index="${i}" value="${escHtml(m.tableName)}"
          placeholder="target table name" style="width:100%">
      </td>
      <td>
        <button class="btn-preview btn-secondary" data-sheet="${escHtml(m.sheetName)}">Preview</button>
      </td>
    </tr>
    <tr class="preview-row" id="preview-${i}" style="display:none">
      <td colspan="4">
        <div class="preview-wrap" id="preview-content-${i}"></div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll<HTMLInputElement>('.m-enabled').forEach(cb => {
    cb.addEventListener('change', () => {
      mappings[Number(cb.dataset.index)].enabled = cb.checked;
    });
  });

  tbody.querySelectorAll<HTMLInputElement>('.m-table').forEach(inp => {
    inp.addEventListener('input', () => {
      mappings[Number(inp.dataset.index)].tableName = inp.value;
    });
  });

  tbody.querySelectorAll<HTMLButtonElement>('.btn-preview').forEach(btn => {
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'getPreview', sheet: btn.dataset.sheet ?? '' });
    });
  });
}

function renderPreview(sheet: string, columns: string[], rows: unknown[][]): void {
  const index = mappings.findIndex(m => m.sheetName === sheet);
  if (index < 0) { return; }

  const previewRow = document.getElementById(`preview-${index}`);
  const previewContent = document.getElementById(`preview-content-${index}`);
  if (!previewRow || !previewContent) { return; }

  previewRow.style.display = '';
  if (columns.length === 0) {
    previewContent.innerHTML = '<p style="opacity:0.6;font-size:12px;padding:4px">No data.</p>';
    return;
  }

  const header = columns.map(c => `<th>${escHtml(c)}</th>`).join('');
  const body = rows.map(row =>
    `<tr>${(row as unknown[]).map(v => `<td>${escHtml(v)}</td>`).join('')}</tr>`
  ).join('');
  previewContent.innerHTML = `
    <table class="preview-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p style="font-size:11px;opacity:0.6;margin-top:4px">Showing up to 100 rows (${rows.length} shown)</p>
  `;
}

function renderResult(success: boolean, message: string): void {
  const bar = el('result-bar');
  bar.textContent = message;
  bar.className = 'result-bar ' + (success ? 'success' : 'error');
  bar.style.display = '';
  bar.scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Messages from extension
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent<LoaderExtToWebMsg>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      currentFile = msg.file;
      connections = msg.connections;
      mappings = msg.file.sheets.map(sheet => ({
        sheetName: sheet,
        tableName: sheet,
        enabled: true,
      }));
      if (connections.length > 0 && !selectedConnectionId) {
        selectedConnectionId = connections[0].id;
      }
      el('file-label').textContent = `${msg.file.label} (${msg.file.fileType.toUpperCase()})`;
      renderConnectionPicker();
      renderMappings();
      el('result-bar').style.display = 'none';
      break;

    case 'preview':
      renderPreview(msg.sheet, msg.columns, msg.rows);
      break;

    case 'loadResult':
      renderResult(msg.success, msg.message);
      break;
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  el('root').innerHTML = buildLayout();

  el<HTMLSelectElement>('conn-select').addEventListener('change', (e) => {
    selectedConnectionId = (e.target as HTMLSelectElement).value;
  });

  el('btn-load').addEventListener('click', () => {
    if (!currentFile) { return; }
    vscode.postMessage({
      type: 'load',
      connectionId: selectedConnectionId,
      mappings: [...mappings],
    });
  });
});

function buildLayout(): string {
  return `
<style>
  :root {
    --font: var(--vscode-font-family, 'Segoe UI', sans-serif);
    --font-size: var(--vscode-font-size, 13px);
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --border: var(--vscode-panel-border, #404040);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #cccccc);
    --btn-bg: var(--vscode-button-background, #0e639c);
    --btn-fg: var(--vscode-button-foreground, #ffffff);
    --btn2-bg: var(--vscode-button-secondaryBackground, #3a3d41);
    --btn2-fg: var(--vscode-button-secondaryForeground, #cccccc);
    --select-bg: var(--vscode-dropdown-background, #3c3c3c);
    --err-fg: #f44747;
    --ok-fg: #89d185;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); font-size: var(--font-size); background: var(--bg); color: var(--fg); padding: 12px; }

  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  button {
    background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 4px 12px;
    cursor: pointer; font-size: var(--font-size); border-radius: 2px;
  }
  button:hover { filter: brightness(1.15); }
  button:disabled { opacity: 0.4; cursor: default; filter: none; }
  .btn-secondary { background: var(--btn2-bg); color: var(--btn2-fg); }

  select, input[type="text"] {
    background: var(--select-bg); color: var(--input-fg); border: 1px solid var(--border);
    padding: 3px 6px; font-size: var(--font-size); border-radius: 2px;
  }

  .section-title { font-weight: 600; margin-bottom: 6px; font-size: 12px; text-transform: uppercase; opacity: 0.7; }

  .file-info { font-size: 12px; background: var(--input-bg); border: 1px solid var(--border); padding: 6px 10px; margin-bottom: 14px; font-family: monospace; }

  .warn-bar { color: #e5c07b; margin-bottom: 12px; font-size: 12px; }

  table.mapping-table { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
  table.mapping-table th, table.mapping-table td {
    border: 1px solid var(--border); padding: 5px 8px; text-align: left;
  }
  table.mapping-table th { background: var(--input-bg); font-size: 11px; text-transform: uppercase; opacity: 0.8; }
  .sheet-name { font-family: monospace; }

  .preview-row td { background: var(--input-bg); padding: 8px; }
  .preview-wrap { overflow-x: auto; }
  table.preview-table { border-collapse: collapse; font-size: 12px; }
  table.preview-table th, table.preview-table td { border: 1px solid var(--border); padding: 3px 8px; }
  table.preview-table th { background: rgba(0,0,0,0.2); }

  .result-bar { padding: 8px 12px; margin-top: 12px; font-size: 13px; border-radius: 2px; }
  .result-bar.success { background: rgba(137, 209, 133, 0.15); color: var(--ok-fg); border: 1px solid var(--ok-fg); }
  .result-bar.error { background: rgba(244, 71, 71, 0.15); color: var(--err-fg); border: 1px solid var(--err-fg); }
</style>

<div class="section-title">File</div>
<div id="file-label" class="file-info">—</div>

<div class="section-title">Connection</div>
<div class="toolbar">
  <select id="conn-select" style="min-width:240px"><option value="">-- select database --</option></select>
</div>

<p class="warn-bar">&#9888; Loading will DELETE ALL rows in the target table(s) and re-insert. Make sure this is intentional.</p>

<div class="section-title">Sheet / Table Mapping</div>
<table class="mapping-table">
  <thead><tr><th style="width:36px">Load</th><th>Sheet / Source</th><th>Target Table</th><th style="width:80px"></th></tr></thead>
  <tbody id="mapping-body"></tbody>
</table>

<button id="btn-load">Load into Database</button>
<div id="result-bar" class="result-bar" style="display:none"></div>
`;
}
