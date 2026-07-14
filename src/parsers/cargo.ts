/**
 * Cargo.lock — TOML with one `[[package]]` per crate.
 *
 * Workspace members are the entries WITHOUT a `source` field; everything
 * they depend on directly is "direct", the rest "transitive". Dependency
 * strings are either `"name"` or `"name version"` (or
 * `"name version (source)"` when two versions coexist).
 */

import { parseToml } from "../toml.js";
import { ParseError } from "../types.js";
import type { DependencyRef, ParserOutput, RawPackage } from "../types.js";
import type { TomlTable, TomlValue } from "../toml.js";

function depRef(s: string): DependencyRef {
  const parts = s.trim().split(/\s+/);
  return { name: parts[0] ?? "", spec: parts[1] ?? "" };
}

export function parseCargo(content: string): ParserOutput {
  const doc = parseToml(content);
  const version = doc["version"];
  const lockfileVersion =
    typeof version === "number" || typeof version === "string" ? String(version) : null;

  const pkgs = doc["package"];
  if (!Array.isArray(pkgs)) {
    if (lockfileVersion !== null) {
      return { lockfileVersion, packages: [], warnings: [] };
    }
    throw new ParseError("Cargo.lock: no [[package]] entries and no version marker");
  }

  const out: ParserOutput = { lockfileVersion, packages: [], warnings: [] };

  // First pass: find workspace members and their direct dependency names.
  const workspaceMembers = new Set<string>();
  const directNames = new Set<string>();
  const entries: TomlTable[] = [];
  for (const p of pkgs as TomlValue[]) {
    if (typeof p !== "object" || p === null || Array.isArray(p)) continue;
    const entry = p as TomlTable;
    entries.push(entry);
    if (typeof entry["name"] === "string" && entry["source"] === undefined) {
      workspaceMembers.add(entry["name"]);
      const deps = entry["dependencies"];
      if (Array.isArray(deps)) {
        for (const d of deps) {
          if (typeof d === "string") directNames.add(depRef(d).name);
        }
      }
    }
  }

  for (const entry of entries) {
    const name = typeof entry["name"] === "string" ? entry["name"] : "";
    const ver = typeof entry["version"] === "string" ? entry["version"] : "";
    if (name === "" || ver === "") {
      out.warnings.push({ message: "package entry lacks name or version — skipped", line: null });
      continue;
    }
    if (workspaceMembers.has(name)) continue; // the project's own crates

    const deps: DependencyRef[] = [];
    const rawDeps = entry["dependencies"];
    if (Array.isArray(rawDeps)) {
      for (const d of rawDeps) {
        if (typeof d === "string") deps.push(depRef(d));
      }
    }
    const checksum = entry["checksum"];
    out.packages.push({
      name,
      version: ver,
      integrity:
        typeof checksum === "string" && checksum !== ""
          ? [{ algorithm: "sha256", value: checksum }]
          : [],
      resolved: typeof entry["source"] === "string" ? entry["source"] : null,
      relation: directNames.has(name) ? "direct" : "transitive",
      scopes: [],
      dependencies: deps,
    } satisfies RawPackage);
  }
  return out;
}
