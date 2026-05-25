/**
 * mapperScanner.ts — pure scanning logic, no VSCode API.
 *
 * Design goals:
 *  - Zero external dependencies (uses only Node built-ins)
 *  - All functions accept explicit file content → easy to unit-test without the FS
 *  - The top-level `scanFiles` function is the single integration entry point
 *  - Detection and parsing are separate steps → swap or improve either independently
 */

import * as path from 'path';
import { MapperFile } from './types';
import { parseJavaMapper, parseXmlMapper, parseJavaMapperMethods } from './queryParser';

// ---------------------------------------------------------------------------
// Detection  (is this file a MyBatis mapper?)
// ---------------------------------------------------------------------------

/**
 * Returns true if the Java source looks like a MyBatis mapper file.
 * Checks for annotation presence only — no AST parsing required.
 */
export function isJavaMapper(content: string): boolean {
  return /@(Mapper|Select|Insert|Update|Delete)\b/.test(content);
}

/**
 * Returns true if the XML file is a MyBatis mapper document.
 * Accepts either the DTD reference or the <mapper> root element.
 */
export function isXmlMapper(content: string): boolean {
  return content.includes('mybatis.org/dtd/mybatis-3-mapper') ||
    /<mapper\s/i.test(content);
}

// ---------------------------------------------------------------------------
// Single-file parsing
// ---------------------------------------------------------------------------

export function parseFile(filePath: string, content: string): MapperFile | null {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.java') {
    if (!isJavaMapper(content)) { return null; }
    // First try inline SQL (@Select/@Insert etc.); fall back to method signatures for XML-mapped mappers
    let queries = parseJavaMapper(content);
    if (queries.length === 0) { queries = parseJavaMapperMethods(content); }
    if (queries.length === 0) { return null; }
    const label = extractJavaClassName(content) ?? path.basename(filePath, '.java');
    return { source: 'java', filePath, label, queries };
  }

  if (ext === '.xml') {
    if (!isXmlMapper(content)) { return null; }
    const queries = parseXmlMapper(content);
    if (queries.length === 0) { return null; }
    return { source: 'xml', filePath, label: path.basename(filePath), queries };
  }

  return null;
}

function extractJavaClassName(content: string): string | null {
  const m = /(?:public\s+)?(?:interface|class)\s+(\w+)/.exec(content);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Multi-file scanning (FS-dependent; injected reader for testability)
// ---------------------------------------------------------------------------

export interface FileReader {
  /** Return file content as UTF-8 string, or null on error. */
  read(filePath: string): string | null;
  /** Return child entries under a directory, or [] on error. */
  list(dir: string): Array<{ name: string; isDirectory: boolean }>;
}

/** Directories that are always skipped during recursive walk. */
const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', 'target', 'build', 'out', 'dist', '.vscode-test',
]);

export function scanFiles(
  roots: string[],
  reader: FileReader,
  skipDirs: Set<string> = DEFAULT_SKIP_DIRS
): MapperFile[] {
  const results: MapperFile[] = [];
  for (const root of roots) {
    walkDir(root, reader, skipDirs, (filePath) => {
      const content = reader.read(filePath);
      if (content === null) { return; }
      const mf = parseFile(filePath, content);
      if (mf) { results.push(mf); }
    });
  }
  return results;
}

function walkDir(
  dir: string,
  reader: FileReader,
  skipDirs: Set<string>,
  cb: (filePath: string) => void
): void {
  const entries = reader.list(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory) {
      if (!skipDirs.has(entry.name)) {
        walkDir(fullPath, reader, skipDirs, cb);
      }
    } else {
      cb(fullPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Default FS-backed reader (used by the extension at runtime)
// ---------------------------------------------------------------------------

import * as fs from 'fs';

export const fsReader: FileReader = {
  read(filePath) {
    try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
  },
  list(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
    } catch { return []; }
  },
};
