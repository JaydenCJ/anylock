/**
 * requirements.txt — only the PINNED subset counts as a lockfile.
 *
 * pip-compile / `pip freeze` output is `name==version` with optional
 * `--hash=sha256:…` continuation lines. Anything not pinned with `==`
 * (ranges, bare names, editable installs, `-r` includes, VCS URLs) is not
 * lockfile material and becomes a warning, never a fabricated record.
 * Environment markers (`; python_version < "3.11"`) and extras
 * (`requests[socks]`) are stripped from the name.
 */

import { ParseError } from "../types.js";
import type { Integrity, ParserOutput } from "../types.js";

/** Join backslash-continued physical lines into logical lines. */
function logicalLines(content: string): Array<{ text: string; no: number }> {
  const out: Array<{ text: string; no: number }> = [];
  const raw = content.split(/\r?\n/);
  let buf = "";
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]!;
    if (buf === "") start = i + 1;
    if (line.endsWith("\\")) {
      buf += line.slice(0, -1) + " ";
      continue;
    }
    buf += line;
    const text = buf.trim();
    buf = "";
    if (text !== "") out.push({ text, no: start });
  }
  if (buf.trim() !== "") out.push({ text: buf.trim(), no: start });
  return out;
}

const PIN = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(\[[^\]]*\])?\s*==\s*([^\s;#]+)/;

export function parseRequirements(content: string): ParserOutput {
  const out: ParserOutput = { lockfileVersion: null, packages: [], warnings: [] };
  const seen = new Set<string>();
  let sawAnyDirective = false;

  for (const { text, no } of logicalLines(content)) {
    if (text.startsWith("#")) continue;
    sawAnyDirective = true;

    if (text.startsWith("-")) {
      // -r/-c includes, --index-url, -e editables: not pins.
      out.warnings.push({ message: `directive \`${text.split(/\s+/)[0]}\` skipped`, line: no });
      continue;
    }
    const m = PIN.exec(text);
    if (m === null) {
      out.warnings.push({ message: `\`${text.split(/\s+/)[0]}\` is not pinned with == — skipped`, line: no });
      continue;
    }
    const name = m[1]!;
    const version = m[3]!;

    const integrity: Integrity[] = [];
    const hashRe = /--hash[= ]([A-Za-z0-9_]+):([A-Za-z0-9+/=]+)/g;
    let hm: RegExpExecArray | null;
    while ((hm = hashRe.exec(text)) !== null) {
      integrity.push({ algorithm: hm[1]!, value: hm[2]! });
    }

    const key = `${name.toLowerCase()}@${version}`;
    if (seen.has(key)) {
      out.warnings.push({ message: `duplicate pin for \`${name}\` — first one kept`, line: no });
      continue;
    }
    seen.add(key);
    out.packages.push({
      name,
      version,
      integrity,
      resolved: null,
      relation: "unknown", // a flat pin list has no dependency graph
      scopes: [],
      dependencies: [],
    });
  }

  if (!sawAnyDirective) {
    throw new ParseError("requirements.txt: file contains no requirement lines");
  }
  return out;
}
