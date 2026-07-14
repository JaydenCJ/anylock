/**
 * Minimal TOML reader — just enough of TOML 1.0 for the lockfiles anylock
 * parses (Cargo.lock, poetry.lock). Supported: comments, bare/quoted keys,
 * `[table]` and `[[array-of-tables]]` headers with dotted names, basic and
 * literal strings (single- and multi-line), booleans, integers, floats,
 * arrays (including multi-line) and inline tables. Unsupported TOML
 * (dates, exotic escapes) raises ParseError instead of misparsing —
 * lockfiles are machine-written, so a hard error means the input is not
 * the lockfile we think it is.
 */

import { ParseError } from "./types.js";

export type TomlValue =
  | string
  | number
  | boolean
  | TomlValue[]
  | { [key: string]: TomlValue };

export type TomlTable = { [key: string]: TomlValue };

class Scanner {
  readonly src: string;
  pos = 0;
  constructor(src: string) {
    this.src = src;
  }
  /** 1-based line of the current position, for error messages. */
  line(): number {
    let n = 1;
    for (let i = 0; i < this.pos && i < this.src.length; i++) {
      if (this.src[i] === "\n") n++;
    }
    return n;
  }
  peek(): string {
    return this.src[this.pos] ?? "";
  }
  eof(): boolean {
    return this.pos >= this.src.length;
  }
  /** Skip spaces and tabs on the current line. */
  skipInline(): void {
    while (this.peek() === " " || this.peek() === "\t") this.pos++;
  }
  /** Skip whitespace, newlines and comments. */
  skipTrivia(): void {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.pos++;
      } else if (c === "#") {
        while (!this.eof() && this.peek() !== "\n") this.pos++;
      } else {
        return;
      }
    }
  }
  expect(c: string, what: string): void {
    if (this.peek() !== c) {
      throw new ParseError(`TOML: expected ${what}`, this.line());
    }
    this.pos++;
  }
}

const BARE_KEY = /[A-Za-z0-9_-]/;

function readBasicString(s: Scanner): string {
  // s.pos is at the opening quote.
  if (s.src.startsWith('"""', s.pos)) return readMultiline(s, '"""', true);
  s.pos++; // opening "
  let out = "";
  for (;;) {
    if (s.eof()) throw new ParseError("TOML: unterminated string", s.line());
    const c = s.src[s.pos]!;
    if (c === '"') {
      s.pos++;
      return out;
    }
    if (c === "\n") throw new ParseError("TOML: newline in single-line string", s.line());
    if (c === "\\") {
      s.pos++;
      out += readEscape(s);
    } else {
      out += c;
      s.pos++;
    }
  }
}

function readLiteralString(s: Scanner): string {
  if (s.src.startsWith("'''", s.pos)) return readMultiline(s, "'''", false);
  s.pos++; // opening '
  const end = s.src.indexOf("'", s.pos);
  if (end === -1 || s.src.slice(s.pos, end).includes("\n")) {
    throw new ParseError("TOML: unterminated literal string", s.line());
  }
  const out = s.src.slice(s.pos, end);
  s.pos = end + 1;
  return out;
}

function readMultiline(s: Scanner, delim: string, basic: boolean): string {
  s.pos += 3;
  // A newline immediately after the opening delimiter is trimmed (TOML spec).
  if (s.peek() === "\r") s.pos++;
  if (s.peek() === "\n") s.pos++;
  let out = "";
  for (;;) {
    if (s.eof()) throw new ParseError("TOML: unterminated multi-line string", s.line());
    if (s.src.startsWith(delim, s.pos)) {
      s.pos += 3;
      return out;
    }
    const c = s.src[s.pos]!;
    if (basic && c === "\\") {
      s.pos++;
      // Line-ending backslash: trim whitespace through the newline.
      if (s.peek() === "\n" || s.peek() === "\r" || s.peek() === " " || s.peek() === "\t") {
        while (!s.eof() && /[ \t\r\n]/.test(s.peek())) s.pos++;
      } else {
        out += readEscape(s);
      }
    } else {
      out += c;
      s.pos++;
    }
  }
}

function readEscape(s: Scanner): string {
  const c = s.src[s.pos] ?? "";
  s.pos++;
  switch (c) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case '"':
      return '"';
    case "\\":
      return "\\";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "u":
    case "U": {
      const len = c === "u" ? 4 : 8;
      const hex = s.src.slice(s.pos, s.pos + len);
      if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) {
        throw new ParseError("TOML: bad unicode escape", s.line());
      }
      s.pos += len;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    default:
      throw new ParseError(`TOML: unsupported escape \\${c}`, s.line());
  }
}

function readKey(s: Scanner): string {
  const c = s.peek();
  if (c === '"') return readBasicString(s);
  if (c === "'") return readLiteralString(s);
  let out = "";
  while (BARE_KEY.test(s.peek())) {
    out += s.peek();
    s.pos++;
  }
  if (out === "") throw new ParseError("TOML: expected key", s.line());
  return out;
}

/** Dotted key path inside a [header] or [[header]]. */
function readKeyPath(s: Scanner): string[] {
  const parts: string[] = [];
  for (;;) {
    s.skipInline();
    parts.push(readKey(s));
    s.skipInline();
    if (s.peek() === ".") {
      s.pos++;
      continue;
    }
    return parts;
  }
}

function readValue(s: Scanner): TomlValue {
  s.skipTrivia();
  const c = s.peek();
  if (c === '"') return readBasicString(s);
  if (c === "'") return readLiteralString(s);
  if (c === "[") return readArray(s);
  if (c === "{") return readInlineTable(s);
  // Bare scalar: read to a terminator, then classify.
  let raw = "";
  while (!s.eof() && !/[,\]\}\n#\r]/.test(s.peek())) {
    raw += s.peek();
    s.pos++;
  }
  raw = raw.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^[+-]?\d[\d_]*$/.test(raw)) return parseInt(raw.replace(/_/g, ""), 10);
  if (/^[+-]?\d[\d_]*\.\d[\d_]*([eE][+-]?\d+)?$/.test(raw)) {
    return parseFloat(raw.replace(/_/g, ""));
  }
  throw new ParseError(`TOML: unsupported value \`${raw}\``, s.line());
}

function readArray(s: Scanner): TomlValue[] {
  s.expect("[", "'['");
  const out: TomlValue[] = [];
  for (;;) {
    s.skipTrivia();
    if (s.peek() === "]") {
      s.pos++;
      return out;
    }
    out.push(readValue(s));
    s.skipTrivia();
    if (s.peek() === ",") {
      s.pos++;
      continue;
    }
    if (s.peek() === "]") {
      s.pos++;
      return out;
    }
    throw new ParseError("TOML: expected ',' or ']' in array", s.line());
  }
}

function readInlineTable(s: Scanner): TomlTable {
  s.expect("{", "'{'");
  const out: TomlTable = Object.create(null) as TomlTable;
  s.skipInline();
  if (s.peek() === "}") {
    s.pos++;
    return out;
  }
  for (;;) {
    s.skipInline();
    const key = readKey(s);
    s.skipInline();
    s.expect("=", "'=' in inline table");
    out[key] = readValue(s);
    s.skipInline();
    if (s.peek() === ",") {
      s.pos++;
      continue;
    }
    s.expect("}", "'}' closing inline table");
    return out;
  }
}

/** Walk (creating as needed) to the table a dotted header names. */
function descend(root: TomlTable, path: string[], line: number): TomlTable {
  let cur: TomlTable = root;
  for (const part of path) {
    const existing = cur[part];
    if (existing === undefined) {
      const next: TomlTable = Object.create(null) as TomlTable;
      cur[part] = next;
      cur = next;
    } else if (Array.isArray(existing)) {
      // Header names an array-of-tables: descend into its last element.
      const last = existing[existing.length - 1];
      if (typeof last !== "object" || last === null || Array.isArray(last)) {
        throw new ParseError(`TOML: cannot extend array \`${part}\``, line);
      }
      cur = last as TomlTable;
    } else if (typeof existing === "object") {
      cur = existing as TomlTable;
    } else {
      throw new ParseError(`TOML: key \`${part}\` is not a table`, line);
    }
  }
  return cur;
}

/** Parse a TOML document into a plain object tree. */
export function parseToml(src: string): TomlTable {
  const s = new Scanner(src.charCodeAt(0) === 0xfeff ? src.slice(1) : src);
  const root: TomlTable = Object.create(null) as TomlTable;
  let current: TomlTable = root;
  for (;;) {
    s.skipTrivia();
    if (s.eof()) return root;
    if (s.peek() === "[") {
      const isArray = s.src.startsWith("[[", s.pos);
      s.pos += isArray ? 2 : 1;
      const path = readKeyPath(s);
      const line = s.line();
      if (isArray) {
        s.expect("]", "']]'");
        s.expect("]", "']]'");
        const parent = descend(root, path.slice(0, -1), line);
        const leaf = path[path.length - 1]!;
        let arr = parent[leaf];
        if (arr === undefined) {
          arr = [];
          parent[leaf] = arr;
        }
        if (!Array.isArray(arr)) {
          throw new ParseError(`TOML: \`${leaf}\` is not an array of tables`, line);
        }
        const table: TomlTable = Object.create(null) as TomlTable;
        arr.push(table);
        current = table;
      } else {
        s.expect("]", "']'");
        current = descend(root, path, line);
      }
      continue;
    }
    // key = value
    const key = readKey(s);
    s.skipInline();
    s.expect("=", "'=' after key");
    current[key] = readValue(s);
  }
}
