import { ParsedQuery, QueryKind, ParamEntry, ParamType } from './types';

// ---------------------------------------------------------------------------
// Placeholder extraction
// ---------------------------------------------------------------------------

/** Extract unique placeholder names from #{name} and ${name} patterns. */
export function extractPlaceholders(sql: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const re = /[#$]\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    // MyBatis allows #{name,jdbcType=VARCHAR} — take only the name part
    const name = m[1].split(',')[0].trim();
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------

/**
 * Replace MyBatis placeholders with literal SQL values based on ParamEntry
 * type.  Adding a new SQL type is a one-liner here: add a case.
 */
export function buildExecutableSql(sql: string, params: ParamEntry[]): string {
  const map = new Map(params.map(p => [p.name, p]));
  return sql.replace(/[#$]\{([^}]+)\}/g, (_, raw) => {
    const name = raw.split(',')[0].trim();
    const entry = map.get(name);
    if (!entry) { return 'NULL'; }
    return formatValue(entry);
  });
}

export function formatValue(entry: ParamEntry): string {
  const { value, type } = entry;

  switch (type as ParamType) {
    case 'null':
      return 'NULL';

    case 'number':
      return value === '' ? 'NULL' : value;

    case 'boolean':
      if (value === '' || value.toLowerCase() === 'null') { return 'NULL'; }
      return ['true', '1', 'yes'].includes(value.toLowerCase()) ? 'TRUE' : 'FALSE';

    case 'date':
      if (value === '') { return 'NULL'; }
      return `DATE '${value.replace(/'/g, "''")}'`;

    case 'string':
    default:
      if (value === '') { return 'NULL'; }
      return `'${value.replace(/'/g, "''")}'`;
  }
}

// ---------------------------------------------------------------------------
// Dynamic-SQL param extraction (test="…", collection="…", bind value="…")
// ---------------------------------------------------------------------------

const OGNL_KEYWORDS = new Set([
  'null', 'true', 'false', 'and', 'or', 'not',
  '_parameter', '_databaseId',
]);

/** Extract root-level param names referenced in an OGNL expression. */
function extractOgnlIdents(expr: string): string[] {
  // Strip string literals so we don't pick up words inside quotes
  const stripped = expr.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
  const result: string[] = [];
  const seen = new Set<string>();
  const re = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const ident = m[1];
    if (OGNL_KEYWORDS.has(ident.toLowerCase())) { continue; }
    // Skip property access: identifier immediately preceded by a dot
    if (m.index > 0 && stripped[m.index - 1] === '.') { continue; }
    if (!seen.has(ident)) { seen.add(ident); result.push(ident); }
  }
  return result;
}

/**
 * Scan a SQL template for param names referenced only in dynamic-SQL
 * attributes (test="…", collection="…", bind value="…") — these do NOT
 * appear as #{placeholder} in the SQL body, so extractPlaceholders misses them.
 */
export function extractDynamicParams(sql: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (name: string) => { if (!seen.has(name)) { seen.add(name); result.push(name); } };

  // test="…" in <if> / <when>
  const testRe = /\btest\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = testRe.exec(sql)) !== null) {
    for (const id of extractOgnlIdents(m[1] ?? m[2] ?? '')) { add(id); }
  }

  // collection="…" in <foreach>
  const colRe = /\bcollection\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while ((m = colRe.exec(sql)) !== null) {
    const name = (m[1] ?? m[2] ?? '').trim();
    if (name) { add(name); }
  }

  // value="…" in <bind>
  const bindRe = /<bind\b[^>]*\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while ((m = bindRe.exec(sql)) !== null) {
    for (const id of extractOgnlIdents(m[1] ?? m[2] ?? '')) { add(id); }
  }

  return result;
}

/**
 * Collect <foreach> loop-variable names (item="…" and index="…").
 * These are NOT mapper params — they are substituted by the foreach expander
 * and must be excluded from the params table.
 */
function extractForeachLoopVars(sql: string): Set<string> {
  const vars = new Set<string>();
  // Match <foreach ...> opening tag (attributes may contain quoted > via the alternation)
  const tagRe = /<foreach\b((?:[^>"']|"[^"]*"|'[^']*')*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(sql)) !== null) {
    const attrs = m[1];
    const itemM = /\bitem\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
    const idxM  = /\bindex\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
    if (itemM) { const v = itemM[1] ?? itemM[2]; if (v) vars.add(v); }
    if (idxM)  { const v = idxM[1]  ?? idxM[2];  if (v) vars.add(v); }
  }
  return vars;
}

/** All param names: #{} placeholders first, then OGNL-only refs (deduped, loop vars excluded). */
function extractAllParams(sql: string): string[] {
  const loopVars = extractForeachLoopVars(sql);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of [...extractPlaceholders(sql), ...extractDynamicParams(sql)]) {
    if (!loopVars.has(name) && !seen.has(name)) { seen.add(name); result.push(name); }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Java mapper parser
// ---------------------------------------------------------------------------

// match[1]=kind  match[2]=text-block  match[3]=double-quoted  match[4]=backtick
const JAVA_ANNOTATION_RE =
  /@(Select|Insert|Update|Delete)\s*\(\s*(?:"""([\s\S]*?)"""|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)\s*\)/gs;

const JAVA_METHOD_RE = /(?:void|[\w<>[\],\s]+)\s+(\w+)\s*\(/g;

export function parseJavaMapper(content: string): ParsedQuery[] {
  const results: ParsedQuery[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regexes
  JAVA_ANNOTATION_RE.lastIndex = 0;

  while ((match = JAVA_ANNOTATION_RE.exec(content)) !== null) {
    const kind = match[1].toLowerCase() as QueryKind;
    // match[2] = text block content (Java 15+), match[3] = quoted string, match[4] = backtick
    const raw = match[2] ?? match[3] ?? match[4];
    let sql = raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\').trim();
    // Strip <script> wrapper used for dynamic SQL in Java annotations
    const scriptMatch = /^<script>([\s\S]*)<\/script>$/i.exec(sql);
    if (scriptMatch) sql = scriptMatch[1].trim();

    // Find the method name that follows the annotation
    const afterAnnotation = content.slice(match.index + match[0].length);
    JAVA_METHOD_RE.lastIndex = 0;
    const mMethod = JAVA_METHOD_RE.exec(afterAnnotation);
    const id = mMethod ? mMethod[1] : `query_${results.length + 1}`;

    results.push({ id, kind, sql, params: extractAllParams(sql) });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Java mapper method parser (XML-mapped projects — no inline SQL)
// ---------------------------------------------------------------------------

/**
 * For @Mapper interfaces where SQL lives in XML files (no @Select/@Insert etc.).
 * Extracts method names, infers QueryKind from naming conventions, and collects
 * @Param values (or parameter names) as placeholder hints.
 * sql is left empty — the user fills it in the query panel.
 */
export function parseJavaMapperMethods(content: string): ParsedQuery[] {
  const results: ParsedQuery[] = [];
  const seen = new Set<string>();

  // Strip block comments so we don't match method-like text inside them
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, ' ');

  for (const rawLine of stripped.split('\n')) {
    // Remove trailing line comment and trim
    const line = rawLine.replace(/\/\/.*$/, '').trim();

    // Abstract interface methods end with ; and have ( )
    if (!line.endsWith(';') || !line.includes('(') || !line.includes(')')) continue;
    // Skip annotations, comments, imports, type declarations
    if (/^[@*/]|^(import|package|public\s+(interface|class|abstract|enum))\b/.test(line)) continue;

    // Strip inline annotations (@Param("x"), @Options, etc.) to expose the bare signature
    const lineNoAnnot = line.replace(/@\w+\s*\([^)]*\)\s*/g, '');

    // Method name = last identifier before the first '('
    const firstParen = lineNoAnnot.indexOf('(');
    if (firstParen < 0) continue;
    const nameParts = lineNoAnnot.slice(0, firstParen).trim().split(/[\s<>[\],]+/).filter(Boolean);
    const id = nameParts[nameParts.length - 1];

    if (!id || !/^\w+$/.test(id)) continue;
    if (/^(if|else|for|while|switch|catch|try|new|return|throw|extends|implements|class|interface|enum|super|this|public|private|protected|static|final|abstract|default|void)$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    // Extract params from original line (between first '(' and last ')')
    const paramsStr = line.slice(line.indexOf('(') + 1, line.lastIndexOf(')'));

    results.push({ id, kind: _inferKind(id), sql: '', params: _extractParamNames(paramsStr) });
  }

  return results;
}

function _inferKind(name: string): QueryKind {
  const lc = name.toLowerCase();
  if (/^(select|find|get|list|fetch|query|search|count|exists|load|read|retrieve|look)/.test(lc)) { return 'select'; }
  if (/^(insert|save|create|add|register|persist|store)/.test(lc)) { return 'insert'; }
  if (/^(update|modify|change|edit|merge|upsert|patch)/.test(lc)) { return 'update'; }
  if (/^(delete|remove|drop|purge|clear|erase)/.test(lc)) { return 'delete'; }
  return 'unknown';
}

function _extractParamNames(paramsStr: string): string[] {
  // Prefer @Param("name") — these are the actual SQL placeholder names
  const annotNames: string[] = [];
  const re = /@Param\s*\(\s*"([^"]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paramsStr)) !== null) { annotNames.push(m[1]); }
  if (annotNames.length > 0) { return annotNames; }

  // Fallback: last word (variable name) of each comma-separated parameter
  const noAnnot = paramsStr.replace(/@\w+\s*\([^)]*\)\s*/g, '');
  return noAnnot
    .split(',')
    .map(p => p.trim().split(/\s+/).filter(Boolean).pop() ?? '')
    .filter(name => name && /^[a-z]/.test(name));
}

// ---------------------------------------------------------------------------
// XML mapper parser
// ---------------------------------------------------------------------------

const XML_QUERY_RE =
  /<(select|insert|update|delete)\s[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi;

export function parseXmlMapper(content: string): ParsedQuery[] {
  const results: ParsedQuery[] = [];
  let match: RegExpExecArray | null;

  XML_QUERY_RE.lastIndex = 0;
  while ((match = XML_QUERY_RE.exec(content)) !== null) {
    const kind = match[1].toLowerCase() as QueryKind;
    const id = match[2];
    const sql = stripXmlComments(match[3]).trim();
    results.push({ id, kind, sql, params: extractAllParams(sql) });
  }

  return results;
}

function stripXmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

// ---------------------------------------------------------------------------
// Default param entries for a query (all typed as 'string' initially)
// ---------------------------------------------------------------------------

export function defaultParamEntries(query: ParsedQuery): ParamEntry[] {
  return query.params.map(name => ({ name, value: '', type: 'string' as ParamType }));
}

// ---------------------------------------------------------------------------
// SQL file kind detection
// ---------------------------------------------------------------------------

/** Infer QueryKind from the first DML keyword in a SQL string. */
export function detectSqlKind(sql: string): QueryKind {
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trimStart();
  const first = (stripped.split(/[\s\n(]+/)[0] ?? '').toUpperCase();
  if (first === 'SELECT' || first === 'WITH') { return 'select'; }
  if (first === 'INSERT') { return 'insert'; }
  if (first === 'UPDATE') { return 'update'; }
  if (first === 'DELETE') { return 'delete'; }
  return 'unknown';
}
