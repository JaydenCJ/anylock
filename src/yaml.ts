/**
 * Minimal YAML reader — the strict subset that pnpm-lock.yaml and Yarn
 * Berry's yarn.lock are written in. Supported: block mappings by
 * indentation, block sequences (`- item`), plain / single-quoted /
 * double-quoted scalars, flow mappings `{k: v}` and flow sequences
 * `[a, b]`, comments, and multi-document noise like a leading `---`.
 * Anchors, aliases, tags and block scalars (`|`, `>`) are rejected with
 * ParseError — no lockfile in scope emits them, so hitting one means the
 * input is not what we think it is.
 */

import { ParseError } from "./types.js";

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

export type YamlMap = { [key: string]: YamlValue };

interface Line {
  indent: number;
  /** Content with indentation stripped; never empty, never a comment. */
  text: string;
  /** 1-based line number in the source. */
  no: number;
}

/** Split source into significant lines (blank lines and comments dropped). */
function significantLines(src: string): Line[] {
  const out: Line[] = [];
  const raw = src.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const lineRaw = raw[i]!;
    let indent = 0;
    while (lineRaw[indent] === " ") indent++;
    const text = lineRaw.slice(indent);
    if (text === "" || text.startsWith("#")) continue;
    if (lineRaw[indent] === "\t") {
      throw new ParseError("YAML: tabs are not allowed in indentation", i + 1);
    }
    if (text === "---") continue; // document separator noise
    out.push({ indent, text, no: i + 1 });
  }
  return out;
}

/** Strip an unquoted trailing comment (` # …`) from a plain scalar chunk. */
function stripComment(text: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && (i === 0 || text[i - 1] === " ")) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

/** Coerce a plain (unquoted) scalar per the YAML 1.2 core schema subset we need. */
function plainScalar(raw: string, no: number): YamlValue {
  const t = raw.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  if (t.startsWith("&") || t.startsWith("*") || t.startsWith("!")) {
    throw new ParseError(`YAML: anchors/aliases/tags are not supported (\`${t}\`)`, no);
  }
  if (t === "|" || t === ">" || t.startsWith("| ") || t.startsWith("> ")) {
    throw new ParseError("YAML: block scalars are not supported", no);
  }
  return t;
}

/** Parse a single-line value: quoted scalar, flow collection, or plain scalar. */
function inlineValue(raw: string, no: number): YamlValue {
  const t = raw.trim();
  if (t.startsWith('"') || t.startsWith("'")) {
    const [v, rest] = readQuoted(t, no);
    if (stripComment(rest).trim() !== "") {
      throw new ParseError("YAML: trailing content after quoted scalar", no);
    }
    return v;
  }
  if (t.startsWith("{") || t.startsWith("[")) {
    const [v, rest] = readFlow(t, no);
    if (stripComment(rest).trim() !== "") {
      throw new ParseError("YAML: trailing content after flow collection", no);
    }
    return v;
  }
  return plainScalar(stripComment(t), no);
}

/** Read a quoted scalar from the head of `t`; returns [value, remainder]. */
function readQuoted(t: string, no: number): [string, string] {
  const q = t[0];
  if (q === "'") {
    let out = "";
    let i = 1;
    for (;;) {
      if (i >= t.length) throw new ParseError("YAML: unterminated single-quoted scalar", no);
      if (t[i] === "'") {
        if (t[i + 1] === "'") {
          out += "'";
          i += 2;
        } else {
          return [out, t.slice(i + 1)];
        }
      } else {
        out += t[i];
        i++;
      }
    }
  }
  // double-quoted
  let out = "";
  let i = 1;
  for (;;) {
    if (i >= t.length) throw new ParseError("YAML: unterminated double-quoted scalar", no);
    const c = t[i]!;
    if (c === '"') return [out, t.slice(i + 1)];
    if (c === "\\") {
      const e = t[i + 1] ?? "";
      i += 2;
      if (e === "n") out += "\n";
      else if (e === "t") out += "\t";
      else if (e === '"') out += '"';
      else if (e === "\\") out += "\\";
      else if (e === "/") out += "/";
      else if (e === "u") {
        const hex = t.slice(i, i + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new ParseError("YAML: bad \\u escape", no);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else throw new ParseError(`YAML: unsupported escape \\${e}`, no);
    } else {
      out += c;
      i++;
    }
  }
}

/** Read a flow collection ({…} or […]) from the head of `t`; returns [value, remainder]. */
function readFlow(t: string, no: number): [YamlValue, string] {
  if (t[0] === "[") {
    const out: YamlValue[] = [];
    let rest = t.slice(1).trimStart();
    if (rest.startsWith("]")) return [out, rest.slice(1)];
    for (;;) {
      let v: YamlValue;
      if (rest.startsWith("{") || rest.startsWith("[")) {
        [v, rest] = readFlow(rest, no);
      } else if (rest.startsWith('"') || rest.startsWith("'")) {
        [v, rest] = readQuoted(rest, no);
      } else {
        const m = /^[^,\]]*/.exec(rest)!;
        v = plainScalar(m[0], no);
        rest = rest.slice(m[0].length);
      }
      out.push(v);
      rest = rest.trimStart();
      if (rest.startsWith(",")) {
        rest = rest.slice(1).trimStart();
        continue;
      }
      if (rest.startsWith("]")) return [out, rest.slice(1)];
      throw new ParseError("YAML: expected ',' or ']' in flow sequence", no);
    }
  }
  // flow mapping
  const out: YamlMap = Object.create(null) as YamlMap;
  let rest = t.slice(1).trimStart();
  if (rest.startsWith("}")) return [out, rest.slice(1)];
  for (;;) {
    let key: string;
    if (rest.startsWith('"') || rest.startsWith("'")) {
      [key, rest] = readQuoted(rest, no);
    } else {
      const m = /^[^:,\}]*/.exec(rest)!;
      key = m[0].trim();
      rest = rest.slice(m[0].length);
    }
    rest = rest.trimStart();
    if (!rest.startsWith(":")) throw new ParseError("YAML: expected ':' in flow mapping", no);
    rest = rest.slice(1).trimStart();
    let v: YamlValue;
    if (rest.startsWith("{") || rest.startsWith("[")) {
      [v, rest] = readFlow(rest, no);
    } else if (rest.startsWith('"') || rest.startsWith("'")) {
      [v, rest] = readQuoted(rest, no);
    } else {
      const m = /^[^,\}]*/.exec(rest)!;
      v = plainScalar(m[0], no);
      rest = rest.slice(m[0].length);
    }
    out[key] = v;
    rest = rest.trimStart();
    if (rest.startsWith(",")) {
      rest = rest.slice(1).trimStart();
      continue;
    }
    if (rest.startsWith("}")) return [out, rest.slice(1)];
    throw new ParseError("YAML: expected ',' or '}' in flow mapping", no);
  }
}

/**
 * Split a mapping line into key and inline remainder. Handles quoted keys
 * (Yarn Berry: `"lodash@npm:^4.17.21":`) and plain keys that themselves
 * contain `@`/`/` (pnpm: `lodash@4.17.21:`) by finding the first `: ` (or
 * a trailing `:`) outside quotes.
 */
function splitKey(text: string, no: number): { key: string; rest: string } | null {
  if (text.startsWith('"') || text.startsWith("'")) {
    const [key, after] = readQuoted(text, no);
    const t = after.trimStart();
    if (!t.startsWith(":")) return null;
    return { key, rest: t.slice(1).trim() };
  }
  // Plain key: the separator is the first `: ` or a `:` at end of line.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ":" && !inSingle && !inDouble) {
      const next = text[i + 1];
      if (next === undefined || next === " ") {
        const key = text.slice(0, i).trim();
        if (key === "") return null;
        return { key, rest: text.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

/** Recursive-descent block parser over significant lines. */
class BlockParser {
  private i = 0;
  constructor(private readonly lines: Line[]) {}

  parse(): YamlValue {
    if (this.lines.length === 0) return Object.create(null) as YamlMap;
    return this.block(this.lines[0]!.indent);
  }

  private block(indent: number): YamlValue {
    const first = this.lines[this.i];
    if (first === undefined) return null;
    if (first.text.startsWith("- ") || first.text === "-") {
      return this.sequence(indent);
    }
    return this.mapping(indent);
  }

  private sequence(indent: number): YamlValue[] {
    const out: YamlValue[] = [];
    while (this.i < this.lines.length) {
      const ln = this.lines[this.i]!;
      if (ln.indent < indent) break;
      if (ln.indent > indent) {
        throw new ParseError("YAML: bad indentation in sequence", ln.no);
      }
      if (!(ln.text.startsWith("- ") || ln.text === "-")) break;
      const rest = ln.text === "-" ? "" : ln.text.slice(2).trim();
      this.i++;
      if (rest === "") {
        // Item is a nested block on following lines.
        const next = this.lines[this.i];
        if (next !== undefined && next.indent > indent) {
          out.push(this.block(next.indent));
        } else {
          out.push(null);
        }
      } else {
        const kv = splitKey(rest, ln.no);
        if (kv !== null && !rest.startsWith("{") && !rest.startsWith("[")) {
          // `- key: value` — a mapping item starting inline.
          out.push(this.inlineMapItem(kv, indent + 2, ln.no));
        } else {
          out.push(inlineValue(rest, ln.no));
        }
      }
    }
    return out;
  }

  /** A mapping whose first entry sat on the `- ` line itself. */
  private inlineMapItem(
    kv: { key: string; rest: string },
    childIndent: number,
    no: number
  ): YamlMap {
    const map: YamlMap = Object.create(null) as YamlMap;
    map[kv.key] = kv.rest === "" ? this.nested(childIndent) : inlineValue(kv.rest, no);
    while (this.i < this.lines.length) {
      const ln = this.lines[this.i]!;
      if (ln.indent !== childIndent || ln.text.startsWith("- ")) break;
      const kv2 = splitKey(ln.text, ln.no);
      if (kv2 === null) break;
      this.i++;
      map[kv2.key] = kv2.rest === "" ? this.nested(childIndent + 1) : inlineValue(kv2.rest, ln.no);
    }
    return map;
  }

  private mapping(indent: number): YamlMap {
    const out: YamlMap = Object.create(null) as YamlMap;
    while (this.i < this.lines.length) {
      const ln = this.lines[this.i]!;
      if (ln.indent < indent) break;
      if (ln.indent > indent) {
        throw new ParseError("YAML: bad indentation in mapping", ln.no);
      }
      const kv = splitKey(ln.text, ln.no);
      if (kv === null) {
        throw new ParseError(`YAML: expected \`key:\` but got \`${ln.text}\``, ln.no);
      }
      this.i++;
      out[kv.key] =
        kv.rest === "" ? this.nested(indent + 1, indent) : inlineValue(kv.rest, ln.no);
    }
    return out;
  }

  /**
   * Value of a key with nothing after the colon: a nested block, a block
   * sequence allowed to sit at the parent key's own indent (YAML permits
   * `key:` with `- item` not indented further), or null.
   */
  private nested(minIndent: number, parentIndent = -1): YamlValue {
    const next = this.lines[this.i];
    if (next === undefined) return null;
    if (next.indent < minIndent) {
      if (
        next.indent === parentIndent &&
        (next.text.startsWith("- ") || next.text === "-")
      ) {
        return this.sequence(next.indent);
      }
      return null;
    }
    return this.block(next.indent);
  }
}

/** Parse a YAML document (the subset described in the file header). */
export function parseYaml(src: string): YamlValue {
  const clean = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  return new BlockParser(significantLines(clean)).parse();
}
