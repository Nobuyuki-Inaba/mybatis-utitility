/**
 * Rewrite SQL in mapper source files (XML and Java annotation).
 *
 * Design note: the SQL stored in ParsedQuery.sql is always trim()-ed, which
 * means the first line has no leading indent even though subsequent lines may
 * retain their original file indentation.  reindentSql() normalises this by
 * treating the first line specially and stripping/re-adding a known indent
 * prefix on the remaining lines.
 */

/**
 * Reindent all lines of `sql`.
 * - Line 0: prefix with toIndent (trim() stripped its leading whitespace).
 * - Lines 1+: strip fromIndent if present (preserving relative indent), then
 *   prefix with toIndent.  When fromIndent is '' every line is prefixed as-is
 *   so relative indentation typed by the user is preserved.
 */
function reindentSql(sql: string, fromIndent: string, toIndent: string): string {
  return sql.split('\n').map((line, i) => {
    if (i === 0) { return toIndent + line; }
    if (fromIndent && line.startsWith(fromIndent)) {
      return toIndent + line.slice(fromIndent.length);
    }
    return toIndent + line;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// XML mapper writer
// ---------------------------------------------------------------------------

/**
 * Update the SQL body of the named query element inside an XML mapper file.
 * Returns the updated file content, or throws if queryId is not found.
 */
export function updateXmlMapperSql(content: string, queryId: string, newSql: string): string {
  const re = /<(select|insert|update|delete)\s[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    if (match[2] !== queryId) { continue; }

    const body = match[3];
    // Leading whitespace of body (e.g. "\n        ") — includes initial newline
    const leadingWs = body.match(/^(\s*)/)?.[1] ?? '\n    ';
    // Trailing whitespace of body (e.g. "\n    ") — includes final newline + closing indent
    const trailingWs = body.match(/(\s*)$/)?.[1] ?? '\n    ';
    // Content indent = leading whitespace without the initial newline
    const contentIndent = leadingWs.replace(/^[\r\n]+/, '');

    // Compute byte positions in the original content string
    const openTagLength = match[0].indexOf('>') + 1; // first '>' ends the opening tag
    const closeTagStr = `</${match[1]}>`;
    const bodyStartPos = match.index + openTagLength;
    const bodyEndPos = match.index + match[0].length - closeTagStr.length;

    const indented = reindentSql(newSql.trim(), contentIndent, contentIndent);
    const newBody = leadingWs + indented + trailingWs;

    return content.slice(0, bodyStartPos) + newBody + content.slice(bodyEndPos);
  }

  throw new Error(`Query "${queryId}" not found in XML mapper`);
}

// ---------------------------------------------------------------------------
// Java annotation mapper writer
// ---------------------------------------------------------------------------

// Matches @Select/@Insert/@Update/@Delete with text-block, quoted, or backtick string
const JAVA_ANNOTATION_RE =
  /@(Select|Insert|Update|Delete)\s*\(\s*(?:"""([\s\S]*?)"""|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)\s*\)/gs;

const JAVA_METHOD_RE = /(?:void|[\w<>[\],\s]+)\s+(\w+)\s*\(/;

/**
 * Update the SQL in a Java annotation (@Select / @Insert / …) mapper file.
 * Returns the updated file content, or throws if the method is not found.
 */
export function updateJavaAnnotationSql(content: string, methodId: string, newSql: string): string {
  const re = new RegExp(JAVA_ANNOTATION_RE.source, 'gs');
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    // Confirm the method name immediately after this annotation matches methodId
    const afterAnnotation = content.slice(match.index + match[0].length);
    const mMethod = JAVA_METHOD_RE.exec(afterAnnotation);
    if (!mMethod || mMethod[1] !== methodId) { continue; }

    const kind = match[1]; // Select | Insert | Update | Delete
    const isTextBlock = match[2] !== undefined;
    let newAnnotation: string;

    if (isTextBlock) {
      // Preserve text-block format; detect existing content indent from the body
      const textBlockBody = match[2];
      const closingWsMatch = textBlockBody.match(/\n(\s*)$/);
      const contentIndent = closingWsMatch?.[1] ?? '        ';
      const leadingIndent = (textBlockBody.match(/^[\r\n]*(\s*)/) ?? [])[1] ?? contentIndent;
      const indented = reindentSql(newSql.trim(), leadingIndent, contentIndent);
      newAnnotation = `@${kind}("""\n${indented}\n${contentIndent}""")`;
    } else {
      const trimmedSql = newSql.trim();
      if (trimmedSql.includes('\n')) {
        // Original was a single-line string but user wrote multi-line — convert to text block
        const lineStart = content.lastIndexOf('\n', match.index) + 1;
        const annotIndent = content.slice(lineStart, match.index).match(/^(\s*)/)?.[1] ?? '    ';
        const contentIndent = annotIndent + '    ';
        const indented = reindentSql(trimmedSql, '', contentIndent);
        newAnnotation = `@${kind}("""\n${indented}\n${contentIndent}""")`;
      } else {
        // Keep as a quoted string; escape backslash and double-quote
        const escaped = trimmedSql
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        newAnnotation = `@${kind}("${escaped}")`;
      }
    }

    return content.slice(0, match.index) + newAnnotation + content.slice(match.index + match[0].length);
  }

  throw new Error(`Method "${methodId}" not found in Java mapper`);
}
