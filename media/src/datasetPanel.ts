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
  const list = el('list');
  if (files.length === 0) {
    list.innerHTML = `<div class="empty">No dataset files found.<br>
      Add CSV or Excel files under fixture, testdata, or dataset directories.</div>`;
    return;
  }

  list.innerHTML = files.map(f => {
    const sheetInfo = f.sheets.length > 1
      ? `${f.sheets.length} sheets`
      : f.sheets[0] ?? '';
    return `<div class="file-row" data-path="${escHtml(f.path)}">
      <span class="type-badge ${escHtml(f.fileType)}">${escHtml(f.fileType.toUpperCase())}</span>
      <span class="file-label" title="${escHtml(f.path)}">${escHtml(f.label)}</span>
      <span class="sheet-count">${escHtml(sheetInfo)}</span>
    </div>`;
  }).join('');

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
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  el('btn-refresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
    el('list').innerHTML = '<div class="empty">Scanning…</div>';
  });
  render();
});
