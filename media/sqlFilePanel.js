"use strict";
(() => {
  // media/src/sqlFilePanel.ts
  var vscode = acquireVsCodeApi();
  var files = [];
  var loading = true;
  var hasFolders = true;
  var displayMode = document.body.dataset.displayMode ?? "flat";
  var debounceTimer;
  function el(id) {
    return document.getElementById(id);
  }
  function escHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function filterText() {
    return document.getElementById("filter-input")?.value.toLowerCase().trim() ?? "";
  }
  function filteredFiles() {
    const f = filterText();
    if (!f) {
      return files;
    }
    return files.filter(
      (file) => file.label.toLowerCase().includes(f) || file.folder.toLowerCase().includes(f)
    );
  }
  function renderFileRow(f, indented = false, showDir = false) {
    const indentClass = indented ? " indent" : "";
    const dirHtml = showDir && f.folder !== "." ? `<span class="file-dir" title="${escHtml(f.folder)}">${escHtml(f.folder)}</span>` : "";
    return `<div class="file-row${indentClass}" data-path="${escHtml(f.path)}">
    <span class="sql-icon">SQL</span>
    <span class="file-label" title="${escHtml(f.path)}">${escHtml(f.label)}</span>
    ${dirHtml}
  </div>`;
  }
  function renderGrouped(visible) {
    const folderMap = /* @__PURE__ */ new Map();
    for (const f of visible) {
      if (!folderMap.has(f.folder)) {
        folderMap.set(f.folder, []);
      }
      folderMap.get(f.folder).push(f);
    }
    let html = "";
    for (const [dir, dirFiles] of [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const label = dir === "." ? "(root)" : dir.split("/").slice(-3).join("/");
      html += `<div class="folder-row"><span class="folder-chevron">\u25BE</span>${escHtml(label)}</div>`;
      html += dirFiles.map((f) => renderFileRow(f, true, false)).join("");
    }
    return html;
  }
  function render() {
    const list = el("list");
    const visible = filteredFiles();
    const f = filterText();
    if (loading) {
      list.innerHTML = `<div class="empty">Scanning\u2026</div>`;
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
    if (displayMode === "flat") {
      list.innerHTML = visible.map((f2) => renderFileRow(f2, false, true)).join("");
    } else {
      list.innerHTML = renderGrouped(visible);
    }
    list.querySelectorAll(".file-row").forEach((row) => {
      row.addEventListener("click", () => {
        const fsPath = row.dataset.path ?? "";
        if (fsPath) {
          vscode.postMessage({ type: "openFile", path: fsPath });
        }
      });
    });
  }
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "setLoading") {
      loading = msg.loading;
      render();
    } else if (msg.type === "setFiles") {
      loading = false;
      files = msg.items;
      hasFolders = msg.hasFolders;
      render();
    } else if (msg.type === "setDisplayMode") {
      displayMode = msg.mode;
      render();
    }
  });
  window.addEventListener("DOMContentLoaded", () => {
    const input = el("filter-input");
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(render, 150);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        input.value = "";
        render();
      }
    });
    render();
    vscode.postMessage({ type: "ready" });
  });
})();
