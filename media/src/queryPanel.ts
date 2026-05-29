/**
 * Webview script for the MyBatis Query Panel.
 * Runs inside a VSCode Webview — no Node.js APIs, DOM only.
 */

import type { ExtToWebMsg, WebToExtMsg, ParsedQuery, ParamEntry, ParamType, ParamPreset, DbConnectionConfig, QueryResult } from '../../src/types';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
hljs.registerLanguage('sql', sql);

declare function acquireVsCodeApi(): {
  postMessage(msg: WebToExtMsg): void;
};

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentQuery: ParsedQuery | null = null;
let paramEntries: ParamEntry[] = [];
let connections: DbConnectionConfig[] = [];
let selectedConnectionId = '';
let canWriteBack = false;

let presets: ParamPreset[] = [];
let selectedPresetName = '';

let lastResult: QueryResult | null = null;
let currentPage = 0;
let pageSize = 200;

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

function render(): void {
  renderConnectionPicker();
  renderPresetBar();
  renderParamTable();
}

function renderConnectionPicker(): void {
  const sel = el<HTMLSelectElement>('conn-select');
  sel.innerHTML = '<option value="">-- select database --</option>' +
    connections.map(c =>
      `<option value="${escHtml(c.id)}" ${c.id === selectedConnectionId ? 'selected' : ''}>
        ${escHtml(c.label)} (${escHtml(c.type)})
      </option>`
    ).join('');
}

function getDisplayedParamNames(): Set<string> {
  const sql = el<HTMLElement>('query-display')?.textContent ?? '';
  const names = new Set<string>();
  // Handle #{name} and #{name,jdbcType=VARCHAR} — same logic as backend extractPlaceholders
  for (const m of sql.matchAll(/[#$]\{([^}]+)\}/g)) {
    names.add(m[1].split(',')[0].trim());
  }
  return names;
}

function renderPresetBar(): void {
  const sel = el<HTMLSelectElement>('preset-select');
  if (!sel) { return; }
  sel.innerHTML = '<option value="">-- Select preset --</option>' +
    presets.map(p =>
      `<option value="${escHtml(p.name)}" ${p.name === selectedPresetName ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');
  const nameInput = el<HTMLInputElement>('preset-name');
  const saveBtn = el<HTMLButtonElement>('preset-save');
  const deleteBtn = el<HTMLButtonElement>('preset-delete');
  saveBtn.disabled = nameInput.value.trim() === '';
  deleteBtn.disabled = selectedPresetName === '';
}

function renderParamTable(): void {
  const tbody = el<HTMLTableSectionElement>('param-body');
  tbody.innerHTML = paramEntries.map((p, i) => `
    <tr>
      <td class="param-name">${escHtml(p.name)}</td>
      <td>
        <select class="param-type" data-index="${i}">
          ${(['string', 'number', 'boolean', 'date', 'null'] as ParamType[]).map(t =>
            `<option value="${t}" ${t === p.type ? 'selected' : ''}>${t}</option>`
          ).join('')}
        </select>
      </td>
      <td>
        <input class="param-value" type="text" data-index="${i}"
          value="${escHtml(p.value)}"
          placeholder="${p.type === 'null' ? '(null)' : ''}">
      </td>
      <td><button class="param-del btn-secondary" data-index="${i}" ${getDisplayedParamNames().has(p.name) ? 'disabled' : ''}>×</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll<HTMLSelectElement>('.param-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.index);
      paramEntries[i].type = sel.value as ParamType;
      renderParamTable();
    });
  });
  tbody.querySelectorAll<HTMLInputElement>('.param-value').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = Number(inp.dataset.index);
      paramEntries[i].value = inp.value;
    });
  });
  tbody.querySelectorAll<HTMLButtonElement>('.param-del').forEach(btn => {
    btn.addEventListener('click', () => {
      paramEntries.splice(Number(btn.dataset.index), 1);
      renderParamTable();
    });
  });
}

function renderQuery(query: ParsedQuery): void {
  el('query-display').innerHTML = hljs.highlight(query.sql, { language: 'sql' }).value;
  el('mapper-label').textContent = query.id;
}

function updateWriteBackButtons(): void {
  const enabled = !!currentQuery && canWriteBack;
  el<HTMLButtonElement>('btn-preview-write-back').disabled = !enabled;
  el<HTMLButtonElement>('btn-write-back').disabled = !enabled;
}

function renderResult(result: QueryResult): void {
  lastResult = result;
  currentPage = 0;
  renderResultPage();
  el('result-container').scrollIntoView({ behavior: 'smooth' });
}

function renderResultPage(): void {
  if (!lastResult) { return; }
  const { columns, rows, rowCount, durationMs, truncated } = lastResult;

  // Info bar
  let infoText = `${rowCount} row(s), ${columns.length} column(s) — ${durationMs} ms`;
  if (truncated) { infoText += '  ⚠ fetch limit reached, add LIMIT to see more'; }
  el('result-info').textContent = infoText;
  el('result-info').className = 'result-info' + (truncated ? ' warn' : '');

  // CSV button visibility
  el('btn-export-csv').style.display = columns.length > 0 ? '' : 'none';

  if (columns.length === 0) {
    el('result-table-wrap').innerHTML = '<p class="no-rows">Query executed. No rows returned.</p>';
    el('result-pagination').innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(rows.length / pageSize);
  const start = currentPage * pageSize;
  const end = Math.min(start + pageSize, rows.length);
  const pageRows = rows.slice(start, end);

  const header = columns.map(c => `<th>${escHtml(c)}</th>`).join('');
  const body = pageRows.map(row =>
    `<tr>${row.map(v => `<td>${escHtml(v)}</td>`).join('')}</tr>`
  ).join('');
  el('result-table-wrap').innerHTML = `
    <table class="result-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  // Pagination bar
  if (totalPages <= 1) {
    el('result-pagination').innerHTML = '';
    return;
  }
  el('result-pagination').innerHTML = `
    <button id="btn-page-prev" ${currentPage === 0 ? 'disabled' : ''}>&lsaquo; prev</button>
    <span class="page-info">${start + 1}–${end} of ${rows.length} rows &nbsp;(page ${currentPage + 1} / ${totalPages})</span>
    <button id="btn-page-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>next &rsaquo;</button>
  `;
  el('btn-page-prev')?.addEventListener('click', () => { currentPage--; renderResultPage(); });
  el('btn-page-next')?.addEventListener('click', () => { currentPage++; renderResultPage(); });
}

function renderError(message: string): void {
  lastResult = null;
  el('result-info').textContent = 'Error';
  el('result-info').className = 'result-info error';
  el('result-table-wrap').innerHTML = `<pre class="error-msg">${escHtml(message)}</pre>`;
  el('result-pagination').innerHTML = '';
  el('btn-export-csv').style.display = 'none';
  el('result-container').scrollIntoView({ behavior: 'smooth' });
}

function renderResultPlaceholder(): void {
  lastResult = null;
  el('result-info').textContent = '';
  el('result-info').className = 'result-info';
  el('result-table-wrap').innerHTML = '<p class="no-rows placeholder">Execute a query to see results here.</p>';
  el('result-pagination').innerHTML = '';
  el('btn-export-csv').style.display = 'none';
}

// ---------------------------------------------------------------------------
// CSV export — generates from all fetched rows (not just current page)
// ---------------------------------------------------------------------------

function exportCsv(): void {
  if (!lastResult || lastResult.columns.length === 0) { return; }
  const { columns, rows } = lastResult;
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    columns.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ];
  const csv = lines.join('\r\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'result.csv';
  a.click();
}

// ---------------------------------------------------------------------------
// SQL preview (client-side substitution, shown in result area on button click)
// ---------------------------------------------------------------------------

function _formatPreviewValue(entry: ParamEntry): string {
  const { value, type } = entry;
  switch (type as ParamType) {
    case 'null':    return 'NULL';
    case 'number':  return value === '' ? 'NULL' : value;
    case 'boolean':
      if (value === '' || value.toLowerCase() === 'null') { return 'NULL'; }
      return ['true', '1', 'yes'].includes(value.toLowerCase()) ? 'TRUE' : 'FALSE';
    case 'date':
      return value === '' ? 'NULL' : `DATE '${value.replace(/'/g, "''")}'`;
    case 'string':
    default:
      return value === '' ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
  }
}

function buildPreviewSql(sqlTemplate: string, params: ParamEntry[]): string {
  const map = new Map(params.map(p => [p.name, p]));
  return sqlTemplate.replace(/[#$]\{([^}]+)\}/g, (_, raw) => {
    const name = raw.split(',')[0].trim();
    const entry = map.get(name);
    return entry ? _formatPreviewValue(entry) : 'NULL';
  });
}

function showPreview(): void {
  const sqlTemplate = (el('query-display') as HTMLElement).textContent ?? '';
  const sql = buildPreviewSql(sqlTemplate, paramEntries);
  lastResult = null;
  el('result-info').textContent = 'Preview SQL (parameters substituted)';
  el('result-info').className = 'result-info';
  el('result-table-wrap').innerHTML = `<pre class="preview-sql">${escHtml(sql)}</pre>`;
  el('result-pagination').innerHTML = '';
  el('btn-export-csv').style.display = 'none';
  el('result-container').scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

function execute(mode: 'range' | 'all' | 'explain'): void {
  if (!currentQuery) { return; }
  const selectedText = mode === 'range' ? getSelection()?.toString() ?? '' : '';
  const displayedSql = (el('query-display') as HTMLElement).textContent ?? '';
  const msg: WebToExtMsg = {
    type: 'execute',
    mode,
    params: [...paramEntries],
    selectedText,
    displayedSql,
    connectionId: selectedConnectionId,
  };
  vscode.postMessage(msg);
  el('result-info').textContent = 'Executing…';
  el('result-table-wrap').innerHTML = '';
  el('result-pagination').innerHTML = '';
  el('btn-export-csv').style.display = 'none';
}

// ---------------------------------------------------------------------------
// Messages from extension
// ---------------------------------------------------------------------------

let domReady = false;
let pendingSetQuery: ExtToWebMsg & { type: 'setQuery' } | null = null;

window.addEventListener('message', (event: MessageEvent<ExtToWebMsg>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'setQuery':
      currentQuery = msg.query;
      canWriteBack = msg.canWriteBack;
      paramEntries = msg.query.params.map((name: string) => ({ name, value: '', type: 'string' as ParamType }));
      presets = [];
      selectedPresetName = '';
      if (!domReady) {
        pendingSetQuery = msg;
        return;
      }
      (el<HTMLInputElement>('preset-name')).value = '';
      renderResultPlaceholder();
      renderQuery(msg.query);
      render();
      updateWriteBackButtons();
      break;

    case 'presets':
      presets = msg.presets;
      if (!presets.find(p => p.name === selectedPresetName)) {
        selectedPresetName = '';
        el<HTMLInputElement>('preset-name').value = '';
      }
      renderPresetBar();
      break;

    case 'queryResult':
      renderResult(msg.result);
      break;

    case 'queryError':
      renderError(msg.message);
      break;

    case 'connections':
      connections = msg.items;
      if (msg.items.length > 0 && !selectedConnectionId) {
        selectedConnectionId = msg.items[0].id;
      }
      renderConnectionPicker();
      break;

    case 'connectionSaved':
      vscode.postMessage({ type: 'getConnections' });
      break;

    case 'connectionDeleted':
      if (selectedConnectionId === msg.id) { selectedConnectionId = ''; }
      vscode.postMessage({ type: 'getConnections' });
      break;

    case 'settings':
      pageSize = msg.pageSize;
      // Re-render current page with new pageSize if a result is already shown
      if (lastResult) { currentPage = 0; renderResultPage(); }
      break;
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  el('root').innerHTML = buildLayout();

  el('btn-exec-range').addEventListener('click', () => execute('range'));
  el('btn-exec-all').addEventListener('click', () => execute('all'));
  el('btn-exec-explain').addEventListener('click', () => execute('explain'));
  el('btn-preview-sql').addEventListener('click', () => showPreview());

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      execute('range');
    } else if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      execute('all');
    }
  });

  el('btn-reset').addEventListener('click', () => {
    if (!currentQuery) { return; }
    // Always re-read from disk — picks up any external edits to XML, Java, or SQL files
    vscode.postMessage({ type: 'reloadSql' });
  });

  el('btn-preview-write-back').addEventListener('click', () => {
    const sql = (el('query-display') as HTMLElement).textContent ?? '';
    vscode.postMessage({ type: 'previewWriteBack', sql });
  });

  el('btn-write-back').addEventListener('click', () => {
    const sql = (el('query-display') as HTMLElement).textContent ?? '';
    vscode.postMessage({ type: 'saveSql', sql });
  });

  el('query-display').addEventListener('input', () => {
    // Auto-add parameter rows for any new #{placeholder} found in the edited SQL
    const displayedNames = getDisplayedParamNames();
    const existingNames = new Set(paramEntries.map(p => p.name));
    for (const name of displayedNames) {
      if (!existingNames.has(name)) {
        paramEntries.push({ name, value: '', type: 'string' });
      }
    }
    renderParamTable();
  });

  el<HTMLSelectElement>('preset-select').addEventListener('change', (e) => {
    selectedPresetName = (e.target as HTMLSelectElement).value;
    if (selectedPresetName) {
      const preset = presets.find(p => p.name === selectedPresetName);
      if (preset) {
        for (const entry of paramEntries) {
          const pp = preset.params.find(p => p.name === entry.name);
          if (pp) { entry.value = pp.value; entry.type = pp.type; }
        }
        renderParamTable();
      }
    }
    renderPresetBar();
  });

  el<HTMLInputElement>('preset-name').addEventListener('input', () => {
    renderPresetBar();
  });

  el<HTMLButtonElement>('preset-save').addEventListener('click', () => {
    const name = el<HTMLInputElement>('preset-name').value.trim();
    if (!name) { return; }
    vscode.postMessage({ type: 'savePreset', presetName: name, params: [...paramEntries] });
    el<HTMLInputElement>('preset-name').value = '';
    renderPresetBar();
  });

  el<HTMLButtonElement>('preset-delete').addEventListener('click', () => {
    if (!selectedPresetName) { return; }
    vscode.postMessage({ type: 'deletePreset', presetName: selectedPresetName });
  });

  el<HTMLButtonElement>('preset-clear-params').addEventListener('click', () => {
    for (const entry of paramEntries) { entry.value = ''; entry.type = 'string'; }
    selectedPresetName = '';
    el<HTMLInputElement>('preset-name').value = '';
    renderPresetBar();
    renderParamTable();
  });
  el('btn-export-csv').addEventListener('click', exportCsv);
  el('conn-select').addEventListener('change', (e) => {
    selectedConnectionId = (e.target as HTMLSelectElement).value;
  });

  vscode.postMessage({ type: 'getConnections' });

  domReady = true;
  renderResultPlaceholder();
  updateWriteBackButtons();
  if (pendingSetQuery) {
    canWriteBack = pendingSetQuery.canWriteBack;
    renderQuery(pendingSetQuery.query);
    render();
    updateWriteBackButtons();
    pendingSetQuery = null;
  }
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
    --warn-fg: #e5c07b;
    --err-fg: #f44747;
    --select-bg: var(--vscode-dropdown-background, #3c3c3c);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); font-size: var(--font-size); background: var(--bg); color: var(--fg); padding: 12px; max-width: 100vw; overflow-x: hidden; }

  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
  .toolbar-sep { width: 1px; height: 18px; background: var(--border); margin: 0 2px; flex-shrink: 0; }
  button {
    background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 4px 12px;
    cursor: pointer; font-size: var(--font-size); border-radius: 2px;
  }
  button:hover { filter: brightness(1.15); }
  button:disabled { opacity: 0.4; cursor: default; filter: none; }
  .btn-secondary { background: var(--btn2-bg); color: var(--btn2-fg); }

  select {
    background: var(--select-bg); color: var(--input-fg); border: 1px solid var(--border);
    padding: 3px 6px; font-size: var(--font-size); border-radius: 2px;
  }

  .warn-bar { color: var(--warn-fg); margin-bottom: 8px; font-size: 12px; }

  .query-box {
    background: var(--input-bg); border: 1px solid var(--border);
    padding: 10px; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px;
    white-space: pre-wrap; word-break: break-all;
    min-height: 80px; max-height: 50vh; margin-bottom: 14px;
    overflow-y: auto; resize: vertical;
    user-select: text; cursor: text;
  }

  .section-title { font-weight: 600; margin-bottom: 6px; font-size: 12px; text-transform: uppercase; opacity: 0.7; }

  table.param-table { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
  table.param-table th, table.param-table td {
    border: 1px solid var(--border); padding: 5px 8px; text-align: left;
  }
  table.param-table th { background: var(--input-bg); font-size: 11px; text-transform: uppercase; opacity: 0.8; }
  .param-name { font-family: monospace; color: #c678dd; }
  .param-type { width: 90px; }
  .param-value { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); padding: 3px 6px; width: 100%; font-size: var(--font-size); }
  .param-del { padding: 2px 7px; font-size: 11px; }

  .preset-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .preset-label { font-size: 12px; opacity: 0.7; white-space: nowrap; }
  #preset-name { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); padding: 3px 6px; font-size: var(--font-size); border-radius: 2px; width: 140px; }

  #result-container { margin-top: 14px; }
  .result-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
  .result-info { font-size: 12px; opacity: 0.8; flex: 1; }
  .result-info.error { color: var(--err-fg); opacity: 1; }
  .result-info.warn { color: var(--warn-fg); opacity: 1; }
  .result-table-wrap { overflow: auto; max-height: 60vh; }
  table.result-table { border-collapse: collapse; font-size: 12px; }
  table.result-table th, table.result-table td { border: 1px solid var(--border); padding: 4px 8px; }
  table.result-table th { background: var(--input-bg); }
  .error-msg { color: var(--err-fg); font-family: monospace; white-space: pre-wrap; font-size: 12px; }
  .no-rows { opacity: 0.7; font-size: 12px; }
  .result-pagination { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; }
  .page-info { opacity: 0.8; }
  kbd {
    display: inline-block; font-family: 'Consolas', monospace; font-size: 10px;
    background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25);
    border-radius: 3px; padding: 1px 4px; margin-left: 4px; line-height: 1.4;
    vertical-align: middle; white-space: nowrap;
  }

  .preview-sql {
    font-family: 'Consolas', 'Courier New', monospace; font-size: 12px;
    color: #98c379; white-space: pre-wrap; word-break: break-all;
    padding: 8px 10px; user-select: text;
  }

  /* highlight.js SQL theme (dark default, light override) */
  :root {
    --hljs-kw: #569cd6;
    --hljs-str: #ce9178;
    --hljs-num: #b5cea8;
    --hljs-cmt: #6a9955;
    --hljs-op: #d4d4d4;
    --hljs-var: #9cdcfe;
  }
  body.vscode-light {
    --hljs-kw: #0000ff;
    --hljs-str: #a31515;
    --hljs-num: #098658;
    --hljs-cmt: #008000;
    --hljs-op: #000000;
    --hljs-var: #001080;
  }
  .hljs-keyword, .hljs-type { color: var(--hljs-kw); font-weight: bold; }
  .hljs-string, .hljs-literal { color: var(--hljs-str); }
  .hljs-number { color: var(--hljs-num); }
  .hljs-comment { color: var(--hljs-cmt); font-style: italic; }
  .hljs-operator, .hljs-punctuation { color: var(--hljs-op); }
  .hljs-variable, .hljs-name { color: var(--hljs-var); }
</style>

<div class="toolbar">
  <button id="btn-exec-all">execute(all)<kbd>Ctrl+Enter</kbd></button>
  <button id="btn-exec-range">execute(range)<kbd>Ctrl+&#x21E7;+Enter</kbd></button>
  <button id="btn-exec-explain" class="btn-secondary">Explain</button>
  <button id="btn-preview-sql" class="btn-secondary">Preview SQL</button>
  <button id="btn-reset" class="btn-secondary">reset SQL</button>
  <span class="toolbar-sep"></span>
  <button id="btn-preview-write-back" class="btn-secondary" disabled>Preview write-back</button>
  <button id="btn-write-back" class="btn-secondary" disabled>Write back to mapper</button>
  <select id="conn-select" style="min-width:220px"><option value="">-- select database --</option></select>
</div>

<p class="warn-bar">&#9888; warn: no transaction, You can't rollback.</p>

<div id="mapper-label" style="font-size:11px;opacity:0.6;margin-bottom:4px;"></div>
<div id="query-display" class="query-box" contenteditable="true" spellcheck="false">(select a query from the Mapper tree)</div>

<div class="section-title">Parameters</div>
<div class="preset-bar">
  <span class="preset-label">Preset:</span>
  <select id="preset-select"><option value="">-- Select preset --</option></select>
  <input id="preset-name" type="text" placeholder="Preset name" />
  <button id="preset-save" class="btn-secondary" disabled>Save</button>
  <button id="preset-delete" class="btn-secondary" disabled>Delete</button>
  <button id="preset-clear-params" class="btn-secondary">Clear params</button>
</div>
<table class="param-table">
  <thead><tr><th>Name</th><th>Type</th><th>Value</th><th></th></tr></thead>
  <tbody id="param-body"></tbody>
</table>

<div id="result-container">
  <div class="result-header">
    <p id="result-info" class="result-info"></p>
    <button id="btn-export-csv" class="btn-secondary" style="display:none;font-size:11px;padding:3px 10px;">Export CSV</button>
  </div>
  <div id="result-table-wrap" class="result-table-wrap"><p class="no-rows placeholder">Execute a query to see results here.</p></div>
  <div id="result-pagination" class="result-pagination"></div>
</div>
`;
}
