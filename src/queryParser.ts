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

function formatValue(entry: ParamEntry): string {
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
// Java mapper parser
// ---------------------------------------------------------------------------

const JAVA_ANNOTATION_RE =
  /@(Select|Insert|Update|Delete)\s*\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)\s*\)/gs;

const JAVA_METHOD_RE = /(?:void|[\w<>[\],\s]+)\s+(\w+)\s*\(/g;

export function parseJavaMapper(content: string): ParsedQuery[] {
  const results: ParsedQuery[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regexes
  JAVA_ANNOTATION_RE.lastIndex = 0;

  while ((match = JAVA_ANNOTATION_RE.exec(content)) !== null) {
    const kind = match[1].toLowerCase() as QueryKind;
    const sql = (match[2] ?? match[3]).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\').trim();

    // Find the method name that follows the annotation
    const afterAnnotation = content.slice(match.index + match[0].length);
    JAVA_METHOD_RE.lastIndex = 0;
    const mMethod = JAVA_METHOD_RE.exec(afterAnnotation);
    const id = mMethod ? mMethod[1] : `query_${results.length + 1}`;

    results.push({ id, kind, sql, params: extractPlaceholders(sql) });
  }

  return results;
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
    results.push({ id, kind, sql, params: extractPlaceholders(sql) });
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
