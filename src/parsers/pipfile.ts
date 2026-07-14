/**
 * Pipfile.lock — JSON with `default` (runtime) and `develop` (dev) maps.
 *
 * Versions are stored as pip specifiers (`"==2.31.0"`); the leading `==`
 * is stripped for the normalized record but any other operator means the
 * entry is not fully pinned and is surfaced as a warning instead of a
 * made-up version. Both sections list the full transitive closure, so
 * relation is `unknown` — Pipenv does not mark directness in the lock.
 */

import { ParseError } from "../types.js";
import type { Integrity, ParserOutput, Scope } from "../types.js";

function hashList(hashes: unknown): Integrity[] {
  if (!Array.isArray(hashes)) return [];
  const out: Integrity[] = [];
  for (const h of hashes) {
    if (typeof h !== "string") continue;
    const colon = h.indexOf(":");
    if (colon <= 0) continue;
    out.push({ algorithm: h.slice(0, colon), value: h.slice(colon + 1) });
  }
  return out;
}

export function parsePipfile(content: string): ParserOutput {
  let doc: unknown;
  try {
    doc = JSON.parse(content) as unknown;
  } catch (e) {
    throw new ParseError(`Pipfile.lock is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new ParseError("Pipfile.lock: top level is not an object");
  }
  const root = doc as Record<string, unknown>;
  const meta = root["_meta"];
  let lockfileVersion: string | null = null;
  if (typeof meta === "object" && meta !== null) {
    const spec = (meta as Record<string, unknown>)["pipfile-spec"];
    if (typeof spec === "number" || typeof spec === "string") lockfileVersion = String(spec);
  }
  if (lockfileVersion === null && root["default"] === undefined && root["develop"] === undefined) {
    throw new ParseError("Pipfile.lock: neither _meta nor default/develop sections present");
  }

  const out: ParserOutput = { lockfileVersion, packages: [], warnings: [] };
  for (const [section, scopes] of [
    ["default", []],
    ["develop", ["dev"]],
  ] as Array<[string, Scope[]]>) {
    const map = root[section];
    if (typeof map !== "object" || map === null || Array.isArray(map)) continue;
    for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      const spec = typeof entry["version"] === "string" ? entry["version"] : "";
      if (!spec.startsWith("==")) {
        out.warnings.push({
          message: `\`${name}\` is not pinned (\`${spec === "" ? "no version" : spec}\`) — skipped`,
          line: null,
        });
        continue;
      }
      out.packages.push({
        name,
        version: spec.slice(2),
        integrity: hashList(entry["hashes"]),
        resolved: null, // Pipfile.lock records index names, not URLs
        relation: "unknown",
        scopes,
        dependencies: [],
      });
    }
  }
  return out;
}
