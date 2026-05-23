/**
 * Webview script for the Database Config Panel.
 * Supports SQLite, PostgreSQL, MySQL. Adding a new type:
 *   1. Add to DB_TYPES array below
 *   2. Add its field definitions in DB_FIELDS
 */

import type { ExtToWebMsg, WebToExtMsg, DbConnectionConfig, NewDbConnectionConfig, DbType } from '../../src/types';

declare function acquireVsCodeApi(): { postMessage(msg: WebToExtMsg): void };
const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// Field definitions per DB type  (the extension point for new types)
// ---------------------------------------------------------------------------

const DB_TYPES: DbType[] = ['sqlite', 'postgresql', 'mysql'];

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'number' | 'file';
  required?: boolean;
}

const DB_FIELDS: Record<DbType, FieldDef[]> = {
  sqlite: [
    { key: 'filePath', label: 'Database File Path', placeholder: '/path/to/db.sqlite', type: 'text', required: true },
  ],
  postgresql: [
    { key: 'host',     label: 'Host',     placeholder: 'localhost', type: 'text',     required: true },
    { key: 'port',     label: 'Port',     placeholder: '5432',      type: 'number',   required: true },
    { key: 'database', label: 'Database', placeholder: 'mydb',      type: 'text',     required: true },
    { key: 'schema',   label: 'Schema',   placeholder: 'public',    type: 'text',     required: true },
    { key: 'username', label: 'Username', placeholder: 'postgres',  type: 'text',     required: true },
    { key: 'password', label: 'Password', placeholder: '',           type: 'password', required: false },
  ],
  mysql: [
    { key: 'host',     label: 'Host',     placeholder: 'localhost', type: 'text',   required: true },
    { key: 'port',     label: 'Port',     placeholder: '3306',      type: 'number', required: true },
    { key: 'database', label: 'Database', placeholder: 'mydb',      type: 'text',   required: true },
    { key: 'username', label: 'Username', placeholder: 'root',      type: 'text',   required: true },
    { key: 'password', label: 'Password', placeholder: '',           type: 'password', required: false },
  ],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let connections: DbConnectionConfig[] = [];
let selectedType: DbType = 'sqlite';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function escHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderList(): void {
  const ul = el('conn-list');
  if (connections.length === 0) {
    ul.innerHTML = '<li class="empty">No connections configured.</li>';
    return;
  }
  ul.innerHTML = connections.map(c => `
    <li class="conn-item">
      <span class="conn-label">${escHtml(c.label)}</span>
      <span class="conn-type">${escHtml(c.type)}</span>
      <button class="btn-delete" data-id="${escHtml(c.id)}">Delete</button>
    </li>
  `).join('');
  ul.querySelectorAll<HTMLButtonElement>('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      vscode.postMessage({ type: 'deleteConnection', id });
    });
  });
}

function renderForm(): void {
  const fields = DB_FIELDS[selectedType];
  el('dynamic-fields').innerHTML = fields.map(f => `
    <div class="field-row">
      <label for="field-${f.key}">${escHtml(f.label)}${f.required ? ' *' : ''}</label>
      <input id="field-${f.key}" name="${f.key}" type="${f.type ?? 'text'}"
        placeholder="${escHtml(f.placeholder ?? '')}" autocomplete="off">
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

function submitForm(): void {
  const label = (el<HTMLInputElement>('field-label').value || '').trim();
  if (!label) { alert('Label is required.'); return; }

  const fields = DB_FIELDS[selectedType];
  const data: Record<string, string> = { label, type: selectedType };
  let password: string | undefined;

  for (const f of fields) {
    const input = el<HTMLInputElement>(`field-${f.key}`);
    const val = (input?.value ?? '').trim();
    if (f.required && !val) { alert(`${f.label} is required.`); return; }
    if (f.key === 'password') { password = val || undefined; } else { data[f.key] = val; }
  }

  // Coerce port to number
  if ('port' in data) { (data as Record<string, unknown>)['port'] = Number(data['port']); }

  vscode.postMessage({
    type: 'saveConnection',
    config: data as unknown as NewDbConnectionConfig,
    password,
  });
}

// ---------------------------------------------------------------------------
// Messages from extension
// ---------------------------------------------------------------------------

window.addEventListener('message', (e: MessageEvent<ExtToWebMsg>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'connections':
      connections = msg.items;
      renderList();
      break;
    case 'connectionSaved':
      // Clear form
      el<HTMLFormElement>('add-form').reset();
      renderForm();
      break;
    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  el('root').innerHTML = buildLayout();
  vscode.postMessage({ type: 'getConnections' });

  el<HTMLSelectElement>('type-select').addEventListener('change', e => {
    selectedType = (e.target as HTMLSelectElement).value as DbType;
    renderForm();
  });

  el('btn-add').addEventListener('click', submitForm);

  renderForm();
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
    --sel-bg: var(--vscode-list-activeSelectionBackground, #094771);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); font-size: var(--font-size); background: var(--bg); color: var(--fg); padding: 16px; max-width: 640px; }
  h2 { margin-bottom: 12px; font-size: 15px; }
  h3 { margin-bottom: 8px; font-size: 13px; font-weight: 600; }
  ul { list-style: none; margin-bottom: 20px; }
  .empty { opacity: 0.5; font-size: 12px; }
  .conn-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  .conn-label { flex: 1; font-weight: 600; }
  .conn-type { font-size: 11px; opacity: 0.7; }
  .btn-delete { background: #c0392b; color: #fff; border: none; padding: 2px 8px; cursor: pointer; border-radius: 2px; font-size: 12px; }
  .add-section { border-top: 1px solid var(--border); padding-top: 16px; }
  .field-row { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
  label { font-size: 11px; opacity: 0.8; }
  input, select {
    background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border);
    padding: 5px 8px; font-size: var(--font-size); border-radius: 2px; width: 100%;
  }
  button.btn-primary {
    background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 6px 16px;
    cursor: pointer; font-size: var(--font-size); border-radius: 2px; margin-top: 4px;
  }
  button.btn-primary:hover { filter: brightness(1.15); }
</style>

<h2>Database Connections</h2>

<ul id="conn-list"></ul>

<div class="add-section">
  <h3>Add Connection</h3>
  <form id="add-form" onsubmit="return false">
    <div class="field-row">
      <label for="field-label">Label *</label>
      <input id="field-label" type="text" placeholder="My Database" required>
    </div>
    <div class="field-row">
      <label for="type-select">Type *</label>
      <select id="type-select">
        ${DB_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
    </div>
    <div id="dynamic-fields"></div>
    <button id="btn-add" class="btn-primary">Add Connection</button>
  </form>
</div>
`;
}
