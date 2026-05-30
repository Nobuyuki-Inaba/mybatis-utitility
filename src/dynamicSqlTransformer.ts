/**
 * MyBatis dynamic SQL transformer.
 *
 * Handles: <script>, <if>, <where>, <set>, <trim>, <foreach>,
 *          <choose>/<when>/<otherwise>, <bind>
 *
 * The `test` attribute uses OGNL expressions evaluated against the current
 * param values.  <foreach> treats a string param as a comma-separated list.
 */

import { ParamEntry } from './types';
import { formatValue } from './queryParser';

// ---------------------------------------------------------------------------
// Evaluation context  (param values as JS primitives)
// ---------------------------------------------------------------------------

type CtxVal = string | number | boolean | null;
type Context = Record<string, CtxVal>;

function buildContext(params: ParamEntry[]): Context {
  const ctx: Context = {};
  for (const p of params) {
    if (p.type === 'null' || p.value === '') {
      ctx[p.name] = null;
    } else if (p.type === 'number') {
      ctx[p.name] = Number(p.value);
    } else if (p.type === 'boolean') {
      ctx[p.name] = ['true', '1', 'yes'].includes(p.value.toLowerCase());
    } else {
      ctx[p.name] = p.value;
    }
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// OGNL tokenizer
// ---------------------------------------------------------------------------

type TokKind =
  | 'null' | 'bool' | 'num' | 'str' | 'ident'
  | 'op' | 'and' | 'or' | 'not'
  | 'lp' | 'rp' | 'dot' | 'eof';

interface Tok { k: TokKind; v?: string | number | boolean }

function tokenize(expr: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }

    const two = expr.slice(i, i + 2);
    if (['==', '!=', '>=', '<='].includes(two)) { toks.push({ k: 'op', v: two }); i += 2; continue; }

    const ch = expr[i];
    if (ch === '>') { toks.push({ k: 'op', v: '>' }); i++; continue; }
    if (ch === '<') { toks.push({ k: 'op', v: '<' }); i++; continue; }
    if (ch === '!') { toks.push({ k: 'not' }); i++; continue; }
    if (ch === '(') { toks.push({ k: 'lp' }); i++; continue; }
    if (ch === ')') { toks.push({ k: 'rp' }); i++; continue; }
    if (ch === '.') { toks.push({ k: 'dot' }); i++; continue; }

    if (ch === "'" || ch === '"') {
      const q = ch; i++;
      let s = '';
      while (i < expr.length && expr[i] !== q) s += expr[i++];
      i++;
      toks.push({ k: 'str', v: s }); continue;
    }

    if (/\d/.test(ch) || (ch === '-' && /\d/.test(expr[i + 1] ?? ''))) {
      let s = ch; i++;
      while (i < expr.length && /[\d.]/.test(expr[i])) s += expr[i++];
      toks.push({ k: 'num', v: parseFloat(s) }); continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      let s = '';
      while (i < expr.length && /[\w$]/.test(expr[i])) s += expr[i++];
      const sl = s.toLowerCase();
      if (sl === 'null')  { toks.push({ k: 'null' }); continue; }
      if (sl === 'true')  { toks.push({ k: 'bool', v: true }); continue; }
      if (sl === 'false') { toks.push({ k: 'bool', v: false }); continue; }
      if (sl === 'and')   { toks.push({ k: 'and' }); continue; }
      if (sl === 'or')    { toks.push({ k: 'or' }); continue; }
      if (sl === 'not')   { toks.push({ k: 'not' }); continue; }
      toks.push({ k: 'ident', v: s }); continue;
    }

    i++; // skip unknown char
  }
  toks.push({ k: 'eof' });
  return toks;
}

// ---------------------------------------------------------------------------
// OGNL recursive-descent parser / evaluator
// ---------------------------------------------------------------------------

class OgnlParser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok { return this.toks[this.pos] ?? { k: 'eof' }; }
  private consume(): Tok { return this.toks[this.pos++] ?? { k: 'eof' }; }

  evalBool(ctx: Context): boolean { return !!this._or(ctx); }

  private _or(ctx: Context): unknown {
    let v = this._and(ctx);
    while (this.peek().k === 'or') { this.consume(); v = !!v || !!this._and(ctx); }
    return v;
  }

  private _and(ctx: Context): unknown {
    let v = this._not(ctx);
    while (this.peek().k === 'and') { this.consume(); v = !!v && !!this._not(ctx); }
    return v;
  }

  private _not(ctx: Context): unknown {
    if (this.peek().k === 'not') { this.consume(); return !this._not(ctx); }
    return this._cmp(ctx);
  }

  private _cmp(ctx: Context): unknown {
    const l = this._primary(ctx);
    const op = this.peek();
    if (op.k === 'op') {
      this.consume();
      const r = this._primary(ctx);
      if (op.v === '==') return l === r || (l == null && r == null);
      if (op.v === '!=') return !(l === r || (l == null && r == null));
      if (op.v === '>')  return (l as number) >  (r as number);
      if (op.v === '<')  return (l as number) <  (r as number);
      if (op.v === '>=') return (l as number) >= (r as number);
      if (op.v === '<=') return (l as number) <= (r as number);
    }
    return l;
  }

  private _primary(ctx: Context): unknown {
    const tok = this.peek();
    if (tok.k === 'lp')   { this.consume(); const v = this._or(ctx); if (this.peek().k === 'rp') this.consume(); return v; }
    if (tok.k === 'null') { this.consume(); return null; }
    if (tok.k === 'bool') { this.consume(); return tok.v; }
    if (tok.k === 'num')  { this.consume(); return tok.v; }
    if (tok.k === 'str')  { this.consume(); return tok.v; }
    if (tok.k === 'not')  { this.consume(); return !this._primary(ctx); }

    if (tok.k === 'ident') {
      this.consume();
      const parts: string[] = [tok.v as string];
      while (this.peek().k === 'dot') {
        this.consume();
        const nx = this.peek();
        if (nx.k === 'ident') { parts.push(nx.v as string); this.consume(); }
      }
      // Method call: list.size()
      let method: string | undefined;
      if (this.peek().k === 'lp') {
        this.consume();
        if (this.peek().k === 'rp') { this.consume(); method = parts.pop(); }
      }
      // Resolve value via property path
      let val: unknown = ctx;
      for (const p of parts) {
        if (val == null || typeof val !== 'object') { val = null; break; }
        val = (val as Record<string, unknown>)[p];
      }
      if (method === 'size' || method === 'length') {
        if (typeof val === 'string') return val.split(',').filter(Boolean).length;
        return 0;
      }
      if (method === 'isEmpty') {
        if (typeof val === 'string') return val.length === 0;
        return true;
      }
      return val ?? null;
    }

    this.consume();
    return null;
  }
}

function evalOgnl(expr: string, ctx: Context): boolean {
  try { return new OgnlParser(tokenize(expr)).evalBool(ctx); }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// Attribute parser
// ---------------------------------------------------------------------------

function parseAttrs(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs)) !== null) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

// ---------------------------------------------------------------------------
// Nesting-aware matching close-tag finder
// ---------------------------------------------------------------------------

function findClose(html: string, tag: string, from: number): number {
  const lc = tag.toLowerCase();
  // Matches block-open: <tag ...> or <tag> (but not <tag/>)
  const openRe  = new RegExp(`<${lc}(?:\\s[^>]*)?>`, 'gi');
  const closeRe = new RegExp(`</${lc}\\s*>`, 'gi');
  let depth = 1;
  let at = from;
  while (depth > 0) {
    openRe.lastIndex  = at;
    closeRe.lastIndex = at;
    const om = openRe.exec(html);
    const cm = closeRe.exec(html);
    if (!cm) return -1;
    if (om && om.index < cm.index) { depth++; at = om.index + om[0].length; }
    else { depth--; if (depth === 0) return cm.index; at = cm.index + cm[0].length; }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Fragment transformer (recursive)
// ---------------------------------------------------------------------------

// Matches opening (and optionally self-closing) dynamic-SQL tags.
// Attribute values may contain > when quoted, so we use an alternation that
// consumes quoted strings before falling through to plain non-> chars.
const OPEN_TAG_PAT = String.raw`<(script|if|where|set|trim|foreach|choose|bind)\b((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>`;

function transformFragment(frag: string, ctx: Context, params: ParamEntry[]): string {
  const tagRe = new RegExp(OPEN_TAG_PAT, 'gi');
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(frag)) !== null) {
    result += frag.slice(last, m.index);
    const tag       = m[1].toLowerCase();
    const attrs     = m[2];
    const selfClose = m[3] === '/';
    const afterOpen = m.index + m[0].length;

    if (selfClose) {
      if (tag === 'bind') handleBind(attrs, ctx);
      last = afterOpen;
      tagRe.lastIndex = last;
      continue;
    }

    const closeIdx = findClose(frag, tag, afterOpen);
    if (closeIdx === -1) {
      last = afterOpen;
      tagRe.lastIndex = last;
      continue;
    }

    const content     = frag.slice(afterOpen, closeIdx);
    const closeTagLen = `</${tag}>`.length;
    last = closeIdx + closeTagLen;
    tagRe.lastIndex = last;

    switch (tag) {
      case 'script':  result += transformFragment(content, ctx, params); break;
      case 'if':      result += handleIf(attrs, content, ctx, params); break;
      case 'where':   result += handleWhere(content, ctx, params); break;
      case 'set':     result += handleSet(content, ctx, params); break;
      case 'trim':    result += handleTrim(attrs, content, ctx, params); break;
      case 'foreach': result += handleForeach(attrs, content, ctx, params); break;
      case 'choose':  result += handleChoose(content, ctx, params); break;
    }
  }

  result += frag.slice(last);
  return result;
}

// ---------------------------------------------------------------------------
// Tag handlers
// ---------------------------------------------------------------------------

function handleIf(attrs: string, content: string, ctx: Context, params: ParamEntry[]): string {
  const { test } = parseAttrs(attrs);
  if (test && !evalOgnl(test, ctx)) return '';
  return transformFragment(content, ctx, params);
}

function handleWhere(content: string, ctx: Context, params: ParamEntry[]): string {
  const inner = transformFragment(content, ctx, params).trim();
  if (!inner) return '';
  return 'WHERE ' + inner.replace(/^(AND|OR)\s+/i, '').trim();
}

function handleSet(content: string, ctx: Context, params: ParamEntry[]): string {
  const inner = transformFragment(content, ctx, params).trim();
  if (!inner) return '';
  return 'SET ' + inner.replace(/,\s*$/, '').trim();
}

function handleTrim(attrs: string, content: string, ctx: Context, params: ParamEntry[]): string {
  const a = parseAttrs(attrs);
  let inner = transformFragment(content, ctx, params).trim();
  if (!inner) return '';
  if (a.prefixOverrides) {
    for (const ov of a.prefixOverrides.split('|')) {
      // Keep spaces in `ov` so "AND |OR " doesn't match "ANDROID" or "ORDER"
      if (ov.trim() && inner.toUpperCase().startsWith(ov.toUpperCase())) {
        inner = inner.slice(ov.length).trimStart(); break;
      }
    }
  }
  if (a.suffixOverrides) {
    for (const ov of a.suffixOverrides.split('|')) {
      if (ov.trim() && inner.toUpperCase().endsWith(ov.toUpperCase())) {
        inner = inner.slice(0, -ov.length).trimEnd(); break;
      }
    }
  }
  const pre = a.prefix ? a.prefix + ' ' : '';
  const suf = a.suffix ? ' ' + a.suffix : '';
  return pre + inner + suf;
}

/**
 * <foreach collection="ids" item="id" open="(" close=")" separator=",">
 *   #{id}
 * </foreach>
 *
 * The collection param should be a comma-separated string of values.
 * Each item is formatted using the same ParamType as the collection param.
 */
function handleForeach(attrs: string, content: string, ctx: Context, params: ParamEntry[]): string {
  const a        = parseAttrs(attrs);
  const col      = a.collection ?? '';
  const item     = a.item       ?? 'item';
  const open     = a.open       ?? '';
  const close    = a.close      ?? '';
  const sep      = a.separator  ?? ',';

  // Use the raw string value from ParamEntry so comma-separated lists
  // are not coerced to NaN by buildContext's numeric conversion.
  const colParam = params.find(p => p.name === col);
  const rawVal   = colParam?.value ?? '';
  const itemType = colParam?.type  ?? 'string';

  if (!rawVal || colParam?.type === 'null') return '';
  const items = rawVal.split(',').map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return '';

  const itemRe = new RegExp(`#\\{${escapeRe(item)}(?:,[^}]*)?\\}`, 'g');

  const parts = items.map(raw => {
    const formatted = formatValue({ name: item, value: raw, type: itemType });
    const iter = content.replace(itemRe, formatted);
    return transformFragment(iter, { ...ctx, [item]: raw }, params).trim();
  });

  return open + parts.filter(Boolean).join(sep + ' ') + close;
}

function handleChoose(content: string, ctx: Context, params: ParamEntry[]): string {
  const whenRe = /<when\b((?:[^>"']|"[^"]*"|'[^']*')*?)>([\s\S]*?)<\/when>/gi;
  let m: RegExpExecArray | null;
  while ((m = whenRe.exec(content)) !== null) {
    const { test } = parseAttrs(m[1]);
    if (!test || evalOgnl(test, ctx)) return transformFragment(m[2], ctx, params);
  }
  const ow = /<otherwise>([\s\S]*?)<\/otherwise>/i.exec(content);
  return ow ? transformFragment(ow[1], ctx, params) : '';
}

function handleBind(attrs: string, ctx: Context): void {
  const { name, value } = parseAttrs(attrs);
  if (!name || !value) return;
  // Simple string-concatenation binding: 'lit' + param + 'lit'
  ctx[name] = value.split('+').map(part => {
    const p = part.trim();
    if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) return p.slice(1, -1);
    return ctx[p] != null ? String(ctx[p]) : '';
  }).join('');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Transform MyBatis dynamic SQL tags into plain executable SQL using param values. */
export function transformDynamicSql(sql: string, params: ParamEntry[]): string {
  // Strip CDATA wrappers (common in XML mappers to escape < > in conditions)
  const cleaned = sql.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const ctx = buildContext(params);
  return transformFragment(cleaned, ctx, params);
}
