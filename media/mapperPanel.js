"use strict";
(() => {
  // media/src/mapperPanel.ts
  var vscode = acquireVsCodeApi();
  var allMappers = [];
  var displayMode = "flat";
  var expanded = /* @__PURE__ */ new Set();
  var debounceTimer;
  function escHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function filterText() {
    const inp = document.getElementById("filter-input");
    return inp?.value.toLowerCase().trim() ?? "";
  }
  function filteredFiles() {
    const f = filterText();
    if (!f) {
      return allMappers;
    }
    return allMappers.filter(
      (m) => m.label.toLowerCase().includes(f) || m.queries.some((q) => q.id.toLowerCase().includes(f))
    );
  }
  function queriesFor(mf) {
    const f = filterText();
    if (!f) {
      return mf.queries;
    }
    if (mf.label.toLowerCase().includes(f)) {
      return mf.queries;
    }
    return mf.queries.filter((q) => q.id.toLowerCase().includes(f));
  }
  function render() {
    const container = document.getElementById("tree");
    const files = filteredFiles();
    const f = filterText();
    if (allMappers.length === 0) {
      container.innerHTML = `
      <div class="empty">
        No scan folders configured.<br>
        <a id="link-settings" href="#">Open Settings</a> to specify mapper folders.
      </div>`;
      document.getElementById("link-settings")?.addEventListener("click", (e) => {
        e.preventDefault();
        vscode.postMessage({ type: "openSettings" });
      });
      return;
    }
    if (files.length === 0) {
      container.innerHTML = `<div class="empty">No results for "<strong>${escHtml(f)}</strong>"</div>`;
      return;
    }
    if (displayMode === "flat") {
      container.innerHTML = files.map((m) => renderFile(m)).join("");
    } else {
      container.innerHTML = renderGrouped(files);
    }
    wireEvents(container);
  }
  function kindBadge(kind) {
    const letter = kind === "select" ? "S" : kind === "insert" ? "I" : kind === "update" ? "U" : kind === "delete" ? "D" : "?";
    return `<span class="kind-badge ${escHtml(kind)}">${letter}</span>`;
  }
  function renderFile(mf, indented = false) {
    const f = filterText();
    const isOpen = f ? true : expanded.has(mf.filePath);
    const chevron = isOpen ? "\u25BE" : "\u25B8";
    const srcClass = mf.source === "java" ? "java" : "xml";
    const indentClass = indented ? " indent" : "";
    const fileName = mf.filePath.replace(/\\/g, "/").split("/").pop() ?? "";
    let html = `
    <div class="file-row${indentClass}" data-fp="${escHtml(mf.filePath)}">
      <span class="chevron">${chevron}</span>
      <span class="src-badge ${srcClass}">${mf.source === "java" ? "J" : "X"}</span>
      <span class="file-label">${escHtml(mf.label)}</span>
      <span class="file-desc">${escHtml(fileName)}</span>
    </div>`;
    if (isOpen) {
      const queries = queriesFor(mf);
      html += queries.map((q) => `
      <div class="query-row${indentClass}" data-fp="${escHtml(mf.filePath)}" data-qid="${escHtml(q.id)}">
        ${kindBadge(q.kind)}
        <span class="query-label">${escHtml(q.id)}</span>
        <span class="query-desc">${escHtml(q.kind)}</span>
      </div>`).join("");
    }
    return html;
  }
  function renderGrouped(files) {
    const folderMap = /* @__PURE__ */ new Map();
    for (const m of files) {
      const dir = m.filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      if (!folderMap.has(dir)) {
        folderMap.set(dir, []);
      }
      folderMap.get(dir).push(m);
    }
    let html = "";
    for (const [dir, dirFiles] of [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const label = dir.split("/").slice(-3).join("/");
      html += `<div class="folder-row"><span class="folder-chevron">\u25BE</span>${escHtml(label)}</div>`;
      html += dirFiles.map((m) => renderFile(m, true)).join("");
    }
    return html;
  }
  function wireEvents(container) {
    container.querySelectorAll(".file-row").forEach((row) => {
      row.addEventListener("click", () => {
        const fp = row.dataset.fp;
        if (expanded.has(fp)) {
          expanded.delete(fp);
        } else {
          expanded.add(fp);
        }
        render();
      });
    });
    container.querySelectorAll(".query-row").forEach((row) => {
      row.addEventListener("click", () => {
        const fp = row.dataset.fp;
        const qid = row.dataset.qid;
        const mf = allMappers.find((m) => m.filePath === fp);
        const q = mf?.queries.find((q2) => q2.id === qid);
        if (mf && q) {
          vscode.postMessage({ type: "openQuery", query: q, mapperFile: mf });
        }
      });
    });
  }
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "setMappers") {
      allMappers = msg.items;
      if (allMappers.length <= 5) {
        allMappers.forEach((m) => expanded.add(m.filePath));
      }
      render();
    } else if (msg.type === "setDisplayMode") {
      displayMode = msg.mode;
      render();
    }
  });
  window.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("filter-input");
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
  });
})();
