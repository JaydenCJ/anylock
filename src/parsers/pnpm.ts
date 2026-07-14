/**
 * pnpm-lock.yaml — lockfileVersion 5.x ("/name/1.0.0" keys), 6.x
 * ("/name@1.0.0") and 9.x ("name@1.0.0" + a separate `snapshots` section).
 *
 * The `packages` section is the catalog (resolution, integrity, flags);
 * v9 moved the dependency edges out to `snapshots`. Keys may carry a peer
 * suffix — `foo@1.2.3(react@18.2.0)` — which is stripped for the version
 * but kept in mind when matching snapshot keys to catalog keys.
 * Direct packages are those named by any importer's dependency maps.
 */

import { parseYaml } from "../yaml.js";
import { ParseError } from "../types.js";
import type { DependencyRef, Integrity, ParserOutput, RawPackage, Scope } from "../types.js";
import type { YamlMap, YamlValue } from "../yaml.js";

function isMap(v: YamlValue | undefined): v is YamlMap {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strip a trailing peer-dependency suffix: `foo@1.0.0(bar@2.0.0)` → `foo@1.0.0`. */
function stripPeers(key: string): string {
  const paren = key.indexOf("(");
  return paren === -1 ? key : key.slice(0, paren);
}

/**
 * Parse a catalog/snapshot key into name and version.
 * v5: `/@scope/name/1.2.3_peer@1.0.0`; v6: `/@scope/name@1.2.3(peer@1.0.0)`;
 * v9: `@scope/name@1.2.3(peer@1.0.0)`. The two peer-suffix styles make the
 * key grammar ambiguous, so the caller passes `atStyle` (true for v6+),
 * decided once from lockfileVersion.
 */
export function splitPnpmKey(
  rawKey: string,
  atStyle: boolean
): { name: string; version: string } | null {
  let key = rawKey.trim();
  if (key.startsWith("/")) key = key.slice(1);
  if (key === "") return null;
  if (atStyle) {
    key = stripPeers(key);
    const at = key.lastIndexOf("@");
    if (at <= 0) return null; // @ at index 0 is a scope, not a separator
    return { name: key.slice(0, at), version: key.slice(at + 1) };
  }
  // v5 style `name/version[_peersuffix]`.
  const slash = key.lastIndexOf("/");
  if (slash <= 0) return null;
  let version = key.slice(slash + 1);
  const us = version.indexOf("_");
  if (us !== -1) version = version.slice(0, us);
  return { name: key.slice(0, slash), version };
}

function depsFromMap(deps: YamlValue | undefined): DependencyRef[] {
  if (!isMap(deps)) return [];
  const out: DependencyRef[] = [];
  for (const [name, v] of Object.entries(deps)) {
    out.push({
      name,
      spec: typeof v === "string" || typeof v === "number" ? stripPeers(String(v)) : "",
    });
  }
  return out;
}

const IMPORTER_DEP_KEYS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

export function parsePnpm(content: string): ParserOutput {
  const doc = parseYaml(content);
  if (!isMap(doc)) throw new ParseError("pnpm-lock.yaml: top level is not a mapping");

  const lv = doc["lockfileVersion"];
  const lockfileVersion =
    typeof lv === "string" || typeof lv === "number" ? String(lv) : null;
  if (lockfileVersion === null) {
    throw new ParseError("pnpm-lock.yaml: missing lockfileVersion");
  }

  const out: ParserOutput = { lockfileVersion, packages: [], warnings: [] };
  const major = parseInt(lockfileVersion, 10);
  const atStyle = Number.isFinite(major) && major >= 6;

  // Which names are direct, and whether every importer referencing them used devDependencies.
  const direct = new Set<string>();
  const directDevOnly = new Map<string, boolean>();
  const importers = isMap(doc["importers"])
    ? (doc["importers"] as YamlMap)
    : ({ ".": doc } as YamlMap); // v5 top-level project shorthand
  for (const importer of Object.values(importers)) {
    if (!isMap(importer)) continue;
    for (const depKey of IMPORTER_DEP_KEYS) {
      const deps = importer[depKey];
      if (!isMap(deps)) continue;
      for (const name of Object.keys(deps)) {
        direct.add(name);
        const dev = depKey === "devDependencies";
        directDevOnly.set(name, (directDevOnly.get(name) ?? true) && dev);
      }
    }
  }

  const packages = isMap(doc["packages"]) ? (doc["packages"] as YamlMap) : {};
  const snapshots = isMap(doc["snapshots"]) ? (doc["snapshots"] as YamlMap) : {};

  // v9 edges live in snapshots, keyed with peer suffixes; index by bare key.
  const snapshotDeps = new Map<string, DependencyRef[]>();
  for (const [key, snap] of Object.entries(snapshots)) {
    if (!isMap(snap)) continue;
    const bare = stripPeers(key.startsWith("/") ? key.slice(1) : key);
    if (!snapshotDeps.has(bare)) {
      snapshotDeps.set(bare, [
        ...depsFromMap(snap["dependencies"]),
        ...depsFromMap(snap["optionalDependencies"]),
      ]);
    }
  }

  for (const [rawKey, value] of Object.entries(packages)) {
    const split = splitPnpmKey(rawKey, atStyle);
    if (split === null) {
      out.warnings.push({ message: `unrecognized package key \`${rawKey}\` — skipped`, line: null });
      continue;
    }
    const entry = isMap(value) ? value : ({} as YamlMap);

    const integrity: Integrity[] = [];
    let resolved: string | null = null;
    const resolution = entry["resolution"];
    if (isMap(resolution)) {
      const sri = resolution["integrity"];
      if (typeof sri === "string") {
        const dash = sri.indexOf("-");
        if (dash > 0) integrity.push({ algorithm: sri.slice(0, dash), value: sri.slice(dash + 1) });
      }
      const tarball = resolution["tarball"];
      if (typeof tarball === "string") resolved = tarball;
    }

    const scopes: Scope[] = [];
    if (entry["dev"] === true || (direct.has(split.name) && directDevOnly.get(split.name) === true)) {
      scopes.push("dev");
    }
    if (entry["optional"] === true) scopes.push("optional");

    const bare = stripPeers(rawKey.startsWith("/") ? rawKey.slice(1) : rawKey);
    const dependencies =
      snapshotDeps.get(bare) ??
      [...depsFromMap(entry["dependencies"]), ...depsFromMap(entry["optionalDependencies"])];

    out.packages.push({
      name: split.name,
      version: split.version,
      integrity,
      resolved,
      relation: direct.has(split.name) ? "direct" : "transitive",
      scopes,
      dependencies,
    } satisfies RawPackage);
  }
  return out;
}
