/**
 * npm package-lock.json / npm-shrinkwrap.json — lockfileVersion 1, 2 and 3.
 *
 * v2/v3 carry the flat `packages` map keyed by install path
 * (`node_modules/foo`, `node_modules/foo/node_modules/bar`); v1 only has
 * the nested `dependencies` tree. When both exist (v2) the `packages` map
 * wins — it is richer (per-entry dev/optional flags and dependency specs).
 */

import { ParseError } from "../types.js";
import type { DependencyRef, Integrity, ParserOutput, RawPackage, Scope } from "../types.js";

function splitIntegrity(integrity: unknown): Integrity[] {
  if (typeof integrity !== "string" || integrity === "") return [];
  const out: Integrity[] = [];
  // SRI allows space-separated multi-hash strings.
  for (const part of integrity.split(/\s+/)) {
    const dash = part.indexOf("-");
    if (dash <= 0) continue;
    out.push({ algorithm: part.slice(0, dash), value: part.slice(dash + 1) });
  }
  return out;
}

function depsOf(entry: Record<string, unknown>, key: string): DependencyRef[] {
  const deps = entry[key];
  if (typeof deps !== "object" || deps === null || Array.isArray(deps)) return [];
  const out: DependencyRef[] = [];
  for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
    out.push({ name, spec: typeof spec === "string" ? spec : "" });
  }
  return out;
}

/** Package name from an install path: last `node_modules/` component (scopes span two segments). */
function nameFromPath(installPath: string): string | null {
  const idx = installPath.lastIndexOf("node_modules/");
  if (idx === -1) return null;
  const name = installPath.slice(idx + "node_modules/".length);
  return name === "" ? null : name;
}

export function parseNpm(content: string): ParserOutput {
  let doc: unknown;
  try {
    doc = JSON.parse(content) as unknown;
  } catch (e) {
    throw new ParseError(`package-lock.json is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new ParseError("package-lock.json: top level is not an object");
  }
  const root = doc as Record<string, unknown>;
  const lockfileVersion =
    typeof root["lockfileVersion"] === "number" || typeof root["lockfileVersion"] === "string"
      ? String(root["lockfileVersion"])
      : null;

  const out: ParserOutput = { lockfileVersion, packages: [], warnings: [] };

  const packagesMap = root["packages"];
  if (typeof packagesMap === "object" && packagesMap !== null && !Array.isArray(packagesMap)) {
    parseV23(packagesMap as Record<string, unknown>, out);
    return out;
  }
  const depsTree = root["dependencies"];
  if (typeof depsTree === "object" && depsTree !== null && !Array.isArray(depsTree)) {
    parseV1(depsTree as Record<string, unknown>, out, new Set());
    return out;
  }
  if (lockfileVersion === null) {
    throw new ParseError("package-lock.json: neither `packages` nor `dependencies` present");
  }
  return out; // an empty but valid lockfile
}

function parseV23(packages: Record<string, unknown>, out: ParserOutput): void {
  // The root project's declared deps make the direct/transitive call.
  const rootEntry = packages[""];
  const direct = new Set<string>();
  if (typeof rootEntry === "object" && rootEntry !== null) {
    const r = rootEntry as Record<string, unknown>;
    for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const d of depsOf(r, key)) direct.add(d.name);
    }
  }

  for (const [installPath, value] of Object.entries(packages)) {
    if (installPath === "") continue; // the root project itself
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (entry["link"] === true) continue; // workspace symlink duplicates its target
    const name =
      typeof entry["name"] === "string" && entry["name"] !== ""
        ? entry["name"]
        : nameFromPath(installPath);
    if (name === null) {
      // Not under node_modules and no name: a workspace directory entry.
      continue;
    }
    const version = typeof entry["version"] === "string" ? entry["version"] : "";
    if (version === "") {
      out.warnings.push({ message: `entry \`${installPath}\` has no version — skipped`, line: null });
      continue;
    }
    const scopes: Scope[] = [];
    if (entry["dev"] === true) scopes.push("dev");
    if (entry["optional"] === true) scopes.push("optional");
    const isTopLevel = installPath === `node_modules/${name}`;
    const pkg: RawPackage = {
      name,
      version,
      integrity: splitIntegrity(entry["integrity"]),
      resolved: typeof entry["resolved"] === "string" ? entry["resolved"] : null,
      relation: isTopLevel && direct.has(name) ? "direct" : "transitive",
      scopes,
      dependencies: [
        ...depsOf(entry, "dependencies"),
        ...depsOf(entry, "optionalDependencies"),
      ],
    };
    out.packages.push(pkg);
  }
}

function parseV1(
  deps: Record<string, unknown>,
  out: ParserOutput,
  seen: Set<string>,
  depth = 0
): void {
  for (const [name, value] of Object.entries(deps)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    const version = typeof entry["version"] === "string" ? entry["version"] : "";
    if (version === "") continue;
    const dedupeKey = `${name}@${version}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      const scopes: Scope[] = [];
      if (entry["dev"] === true) scopes.push("dev");
      if (entry["optional"] === true) scopes.push("optional");
      out.packages.push({
        name,
        version,
        integrity: splitIntegrity(entry["integrity"]),
        resolved: typeof entry["resolved"] === "string" ? entry["resolved"] : null,
        // v1's top level = the root's resolved deps, which are the direct ones.
        relation: depth === 0 ? "direct" : "transitive",
        scopes,
        dependencies: depsOf(entry, "requires"),
      });
    }
    const nested = entry["dependencies"];
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      parseV1(nested as Record<string, unknown>, out, seen, depth + 1);
    }
  }
}
