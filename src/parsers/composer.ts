/**
 * composer.lock — JSON with `packages` (runtime) and `packages-dev` arrays.
 *
 * Every entry is a full package object; `dist.shasum` (sha1 of the zip)
 * and `dist.url` provide integrity and resolution. Composer prefixes
 * plain versions with nothing but tags often carry a leading `v`, which
 * is preserved verbatim — normalizing it would break byte-for-byte
 * round-trips against the registry. The lock does not say which packages
 * the root composer.json required, so relation is `unknown`.
 */

import { ParseError } from "../types.js";
import type { DependencyRef, ParserOutput, Scope } from "../types.js";

const PLATFORM = /^(php|hhvm|ext-[a-z0-9_-]+|lib-[a-z0-9_-]+|composer(-.+)?)$/i;

function requires(entry: Record<string, unknown>): DependencyRef[] {
  const req = entry["require"];
  if (typeof req !== "object" || req === null || Array.isArray(req)) return [];
  const out: DependencyRef[] = [];
  for (const [name, spec] of Object.entries(req as Record<string, unknown>)) {
    // php version / extensions are platform constraints, not packages.
    if (PLATFORM.test(name)) continue;
    out.push({ name, spec: typeof spec === "string" ? spec : "" });
  }
  return out;
}

export function parseComposer(content: string): ParserOutput {
  let doc: unknown;
  try {
    doc = JSON.parse(content) as unknown;
  } catch (e) {
    throw new ParseError(`composer.lock is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new ParseError("composer.lock: top level is not an object");
  }
  const root = doc as Record<string, unknown>;
  if (root["packages"] === undefined && root["packages-dev"] === undefined) {
    throw new ParseError("composer.lock: no packages / packages-dev arrays");
  }
  const pluginVersion = root["plugin-api-version"];
  const out: ParserOutput = {
    lockfileVersion: typeof pluginVersion === "string" ? pluginVersion : null,
    packages: [],
    warnings: [],
  };

  for (const [section, scopes] of [
    ["packages", []],
    ["packages-dev", ["dev"]],
  ] as Array<[string, Scope[]]>) {
    const arr = root[section];
    if (!Array.isArray(arr)) continue;
    for (const value of arr) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      const name = typeof entry["name"] === "string" ? entry["name"] : "";
      const version = typeof entry["version"] === "string" ? entry["version"] : "";
      if (name === "" || version === "") {
        out.warnings.push({ message: "package entry lacks name or version — skipped", line: null });
        continue;
      }
      let resolved: string | null = null;
      let shasum = "";
      const dist = entry["dist"];
      if (typeof dist === "object" && dist !== null) {
        const d = dist as Record<string, unknown>;
        if (typeof d["url"] === "string") resolved = d["url"];
        if (typeof d["shasum"] === "string") shasum = d["shasum"];
      }
      if (resolved === null) {
        const source = entry["source"];
        if (typeof source === "object" && source !== null) {
          const s = source as Record<string, unknown>;
          if (typeof s["url"] === "string") resolved = s["url"];
        }
      }
      out.packages.push({
        name,
        version,
        integrity: shasum !== "" ? [{ algorithm: "sha1", value: shasum }] : [],
        resolved,
        relation: "unknown",
        scopes,
        dependencies: requires(entry),
      });
    }
  }
  return out;
}
