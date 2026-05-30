/**
 * Webview script for the MyBatis Mapper panel.
 * Renders a filterable, collapsible mapper/query tree.
 */

import type { MapperFile, ParsedQuery } from '../../src/types';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebToExtMsg): void;
};

type ExtToWebMsg =
  | { type: 'setMappers'; items: MapperFile[]; hasFolders: boolean }
  | { type: 'setDisplayMode'; mode: 'flat' | 'tree' }
  | { type: 'setLoading'; loading: boolean };

type WebToExtMsg =
  | { type: 'ready' }
  | { type: 'openQuery'; query: ParsedQuery; mapperFile: MapperFile }
  | { type: 'openSettings' };

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allMappers: MapperFile[] = [];
let hasFolders = false;
let loading = true;
let displayMode: 'flat' | 'tree' =
  (document.body.dataset.displayMode as 'flat' | 'tree') ?? 'flat';
const expanded = new Set<string>(); // expanded file paths
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function filterText(): string {
  const inp = document.getElementById('filter-input') as HTMLInputElement | null;
  return inp?.value.toLowerCase().trim() ?? '';
}

function filteredFiles(): MapperFile[] {
  const f = filterText();
  if (!f) { return allMappers; }
  return allMappers.filter(m =>
    m.label.toLowerCase().includes(f) ||
    m.queries.some(q => q.id.toLowerCase().includes(f))
  );
}

function queriesFor(mf: MapperFile): ParsedQuery[] {
  const f = filterText();
  if (!f) { return mf.queries; }
  // If the file itself matches, show all queries; otherwise show only matching queries
  if (mf.label.toLowerCase().includes(f)) { return mf.queries; }
  return mf.queries.filter(q => q.id.toLowerCase().includes(f));
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(): void {
  const container = document.getElementById('tree')!;
  const files = filteredFiles();
  const f = filterText();

  if (loading) {
    container.innerHTML = `<div class="empty">Scanning…</div>`;
    return;
  }

  if (allMappers.length === 0) {
    if (!hasFolders) {
      container.innerHTML = `
        <div class="empty">
          No scan folders configured.<br>
          <a id="link-settings" href="#">Open Settings</a> to specify mapper folders.
        </div>`;
      document.getElementById('link-settings')?.addEventListener('click', e => {
        e.preventDefault();
        vscode.postMessage({ type: 'openSettings' });
      });
    } else {
      container.innerHTML = `
        <div class="empty">
          No mapper files found.<br>
          Check that the configured folders contain .java or .xml mapper files.
        </div>`;
    }
    return;
  }

  if (files.length === 0) {
    container.innerHTML = `<div class="empty">No results for "<strong>${escHtml(f)}</strong>"</div>`;
    return;
  }

  if (displayMode === 'flat') {
    container.innerHTML = files.map(m => renderFile(m)).join('');
  } else {
    container.innerHTML = renderGrouped(files);
  }
  wireEvents(container);
}

function kindBadge(kind: string): string {
  const letter = kind === 'select' ? 'S' : kind === 'insert' ? 'I' : kind === 'update' ? 'U' : kind === 'delete' ? 'D' : '?';
  return `<span class="kind-badge ${escHtml(kind)}">${letter}</span>`;
}

function renderFile(mf: MapperFile, indented = false): string {
  const f = filterText();
  const isOpen = f ? true : expanded.has(mf.filePath);
  const chevron = isOpen ? '▾' : '▸';
  const indentClass = indented ? ' indent' : '';
  const fileName = mf.filePath.replace(/\\/g, '/').split('/').pop() ?? '';

  let html = `
    <div class="file-row${indentClass}" data-fp="${escHtml(mf.filePath)}">
      <span class="chevron">${chevron}</span>
      <span class="file-label">${escHtml(mf.label)}</span>
      <span class="file-desc">${escHtml(fileName)}</span>
    </div>`;

  if (isOpen) {
    const queries = queriesFor(mf);
    html += queries.map(q => `
      <div class="query-row${indentClass}" data-fp="${escHtml(mf.filePath)}" data-qid="${escHtml(q.id)}">
        ${kindBadge(q.kind)}
        <span class="query-label">${escHtml(q.id)}</span>
        <span class="query-desc">${escHtml(q.kind)}</span>
      </div>`).join('');
  }
  return html;
}

function renderGrouped(files: MapperFile[]): string {
  const folderMap = new Map<string, MapperFile[]>();
  for (const m of files) {
    const dir = m.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (!folderMap.has(dir)) { folderMap.set(dir, []); }
    folderMap.get(dir)!.push(m);
  }
  let html = '';
  for (const [dir, dirFiles] of [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const label = dir.split('/').slice(-3).join('/');
    html += `<div class="folder-row"><span class="folder-chevron">▾</span>${escHtml(label)}</div>`;
    html += dirFiles.map(m => renderFile(m, true)).join('');
  }
  return html;
}

function wireEvents(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.file-row').forEach(row => {
    row.addEventListener('click', () => {
      const fp = row.dataset.fp!;
      if (expanded.has(fp)) { expanded.delete(fp); } else { expanded.add(fp); }
      render();
    });
  });

  container.querySelectorAll<HTMLElement>('.query-row').forEach(row => {
    row.addEventListener('click', () => {
      const fp = row.dataset.fp!;
      const qid = row.dataset.qid!;
      const mf = allMappers.find(m => m.filePath === fp);
      const q = mf?.queries.find(q => q.id === qid);
      if (mf && q) {
        vscode.postMessage({ type: 'openQuery', query: q, mapperFile: mf });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent<ExtToWebMsg>) => {
  const msg = event.data;
  if (msg.type === 'setLoading') {
    loading = msg.loading;
    render();
  } else if (msg.type === 'setMappers') {
    loading = false;
    hasFolders = msg.hasFolders;
    allMappers = msg.items;
    // Auto-expand all files when there are few results
    if (allMappers.length <= 5) {
      allMappers.forEach(m => expanded.add(m.filePath));
    }
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
  const input = document.getElementById('filter-input') as HTMLInputElement;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 150);
  });
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { input.value = ''; render(); }
  });
  render(); // show loading state immediately
  vscode.postMessage({ type: 'ready' }); // notify extension that script is ready
});
