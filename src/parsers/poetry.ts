/**
 * poetry.lock — TOML, one `[[package]]` per locked distribution.
 *
 * Hashes live in the per-package `files` array (lock-version 2.x) or in
 * the legacy `[metadata.files]` table (1.x). Dependency edges come from
 * `[package.dependencies]`, whose values are either a constraint string
 * or an inline table with a `version` key. Poetry ≤1.2 recorded a
 * `category = "dev"`; newer lockfiles carry `groups`/optional markers —
 * both are mapped to the dev/optional scopes when present.
 */

import { parseToml } from "../toml.js";
import { ParseError } from "../types.js";
import type { DependencyRef, Integrity, ParserOutput, Scope } from "../types.js";
import type { TomlTable, TomlValue } from "../toml.js";

function isTable(v: TomlValue | undefined): v is TomlTable {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fileHashes(files: TomlValue | undefined): Integrity[] {
  if (!Array.isArray(files)) return [];
  const out: Integrity[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!isTable(f)) continue;
    const hash = f["hash"];
    if (typeof hash !== "string") continue;
    const colon = hash.indexOf(":");
    if (colon <= 0) continue;
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ algorithm: hash.slice(0, colon), value: hash.slice(colon + 1) });
  }
  return out;
}

export function parsePoetry(content: string): ParserOutput {
  const doc = parseToml(content);
  const meta = isTable(doc["metadata"]) ? (doc["metadata"] as TomlTable) : {};
  const lv = meta["lock-version"];
  const lockfileVersion = typeof lv === "string" || typeof lv === "number" ? String(lv) : null;

  const pkgs = doc["package"];
  if (!Array.isArray(pkgs)) {
    if (lockfileVersion !== null) return { lockfileVersion, packages: [], warnings: [] };
    throw new ParseError("poetry.lock: no [[package]] entries and no [metadata] table");
  }

  // Legacy 1.x: hashes under [metadata.files] keyed by package name.
  const legacyFiles = isTable(meta["files"]) ? (meta["files"] as TomlTable) : {};

  const out: ParserOutput = { lockfileVersion, packages: [], warnings: [] };
  for (const p of pkgs as TomlValue[]) {
    if (!isTable(p)) continue;
    const name = typeof p["name"] === "string" ? p["name"] : "";
    const version = typeof p["version"] === "string" ? p["version"] : "";
    if (name === "" || version === "") {
      out.warnings.push({ message: "package entry lacks name or version — skipped", line: null });
      continue;
    }

    const scopes: Scope[] = [];
    if (p["category"] === "dev") scopes.push("dev");
    const groups = p["groups"];
    if (
      Array.isArray(groups) &&
      groups.length > 0 &&
      groups.every((g) => g === "dev" || g === "test")
    ) {
      if (!scopes.includes("dev")) scopes.push("dev");
    }
    if (p["optional"] === true) scopes.push("optional");

    const deps: DependencyRef[] = [];
    const depTable = p["dependencies"];
    if (isTable(depTable)) {
      for (const [depName, spec] of Object.entries(depTable)) {
        if (typeof spec === "string") {
          deps.push({ name: depName, spec });
        } else if (isTable(spec)) {
          const v = spec["version"];
          deps.push({ name: depName, spec: typeof v === "string" ? v : "" });
        } else if (Array.isArray(spec)) {
          // Multiple constraints (per-marker); record the first version spec.
          const first = spec.find((s) => isTable(s) && typeof s["version"] === "string");
          deps.push({
            name: depName,
            spec: first !== undefined ? ((first as TomlTable)["version"] as string) : "",
          });
        }
      }
    }

    let integrity = fileHashes(p["files"]);
    if (integrity.length === 0) {
      integrity = fileHashes(legacyFiles[name]);
    }

    out.packages.push({
      name,
      version,
      integrity,
      resolved: null, // poetry.lock stores no per-file URLs
      relation: "unknown", // directness lives in pyproject.toml, not the lockfile
      scopes,
      dependencies: deps,
    });
  }
  return out;
}
