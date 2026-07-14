/**
 * go.sum — three columns per line: module, version, hash.
 *
 *     github.com/pkg/errors v0.9.1 h1:FEBL…=
 *     github.com/pkg/errors v0.9.1/go.mod h1:bwaw…=
 *
 * The `/go.mod` lines hash only the module manifest; they are folded into
 * the same package record (a second integrity entry with algorithm
 * `h1:go.mod`) rather than emitted as a phantom package. go.sum records
 * every module in the build list's transitive closure and says nothing
 * about directness, so relation is honestly `unknown`.
 */

import { ParseError } from "../types.js";
import type { Integrity, ParserOutput } from "../types.js";

export function parseGoSum(content: string): ParserOutput {
  const out: ParserOutput = { lockfileVersion: null, packages: [], warnings: [] };
  const byKey = new Map<string, { name: string; version: string; integrity: Integrity[] }>();

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3) {
      throw new ParseError(`go.sum: expected 3 fields, got ${parts.length}`, i + 1);
    }
    const [module, versionField, hash] = parts as [string, string, string];
    if (!versionField.startsWith("v")) {
      throw new ParseError(`go.sum: version \`${versionField}\` does not start with 'v'`, i + 1);
    }
    const isGoMod = versionField.endsWith("/go.mod");
    const version = isGoMod ? versionField.slice(0, -"/go.mod".length) : versionField;
    const colon = hash.indexOf(":");
    if (colon <= 0) {
      throw new ParseError(`go.sum: malformed hash \`${hash}\``, i + 1);
    }
    const algorithm = isGoMod ? `${hash.slice(0, colon)}:go.mod` : hash.slice(0, colon);
    const value = hash.slice(colon + 1);

    const key = `${module}@${version}`;
    let rec = byKey.get(key);
    if (rec === undefined) {
      rec = { name: module, version, integrity: [] };
      byKey.set(key, rec);
    }
    rec.integrity.push({ algorithm, value });
  }

  if (byKey.size === 0 && content.trim() !== "") {
    throw new ParseError("go.sum: no module lines found");
  }
  for (const rec of byKey.values()) {
    // Keep the full-module hash first, the go.mod-only hash second.
    rec.integrity.sort((a, b) => a.algorithm.localeCompare(b.algorithm));
    out.packages.push({
      name: rec.name,
      version: rec.version,
      integrity: rec.integrity,
      resolved: null,
      relation: "unknown",
      scopes: [],
      dependencies: [],
    });
  }
  return out;
}
