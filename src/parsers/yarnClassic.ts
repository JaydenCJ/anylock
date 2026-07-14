/**
 * Yarn classic (v1) yarn.lock — the indentation format that predates YAML.
 *
 * Shape:
 *
 *     lodash@^4.17.20, lodash@^4.17.21:
 *       version "4.17.21"
 *       resolved "https://registry.yarnpkg.com/…"
 *       integrity sha512-…
 *       dependencies:
 *         once "^1.4.0"
 *
 * One block may satisfy several requested ranges (comma-separated
 * descriptors); the name is recovered from the descriptor, which is the
 * part before the last `@` (scoped names contain a leading `@`).
 */

import { ParseError } from "../types.js";
import type { DependencyRef, Integrity, ParserOutput, RawPackage } from "../types.js";

/** `"@babel/core@^7.0.0"` → name `@babel/core`; `lodash@^4` → `lodash`. */
export function descriptorName(descriptor: string): string {
  const d = unquote(descriptor.trim());
  const at = d.lastIndexOf("@");
  if (at <= 0) return d; // no version part, or a scoped name with no range
  return d.slice(0, at);
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/** Split a `key "value"` property line of a block body. */
function splitProp(text: string): { key: string; value: string } {
  const sp = text.indexOf(" ");
  if (sp === -1) return { key: text, value: "" };
  return { key: text.slice(0, sp), value: unquote(text.slice(sp + 1).trim()) };
}

export function parseYarnClassic(content: string): ParserOutput {
  const out: ParserOutput = { lockfileVersion: "1", packages: [], warnings: [] };
  const lines = content.split(/\r?\n/);

  let current: RawPackage | null = null;
  let inDeps = false;
  let sawHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const no = i + 1;
    if (raw.trim() === "") continue;
    if (raw.trimStart().startsWith("#")) {
      if (/yarn lockfile v1/.test(raw)) sawHeader = true;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();

    if (indent === 0) {
      // New descriptor group: `foo@^1.0.0, foo@~1.2.0:`
      if (!text.endsWith(":")) {
        throw new ParseError(`yarn.lock: expected a descriptor line ending in ':'`, no);
      }
      flush(out, current);
      const descriptors = splitDescriptors(text.slice(0, -1));
      const names = new Set(descriptors.map(descriptorName));
      if (names.size !== 1) {
        throw new ParseError(
          `yarn.lock: descriptor group resolves to multiple names (${[...names].join(", ")})`,
          no
        );
      }
      current = {
        name: [...names][0]!,
        version: "",
        integrity: [],
        resolved: null,
        relation: "unknown", // v1 lockfiles do not record who asked for what
        scopes: [],
        dependencies: [],
      };
      inDeps = false;
      continue;
    }

    if (current === null) {
      throw new ParseError("yarn.lock: property line outside a package block", no);
    }

    if (indent === 2) {
      inDeps = false;
      if (text === "dependencies:" || text === "optionalDependencies:") {
        inDeps = true;
        continue;
      }
      const { key, value } = splitProp(text);
      if (key === "version") current.version = value;
      else if (key === "resolved") current.resolved = value;
      else if (key === "integrity") {
        for (const part of value.split(/\s+/)) {
          const dash = part.indexOf("-");
          if (dash > 0) {
            current.integrity!.push({ algorithm: part.slice(0, dash), value: part.slice(dash + 1) });
          }
        }
      }
      // other keys (e.g. `uid`, `os`) are ignored on purpose
      continue;
    }

    if (indent >= 4 && inDeps) {
      const { key, value } = splitProp(text);
      current.dependencies!.push({ name: unquote(key), spec: value } satisfies DependencyRef);
      continue;
    }
    // Deeper unknown structure — tolerate rather than fail (forward compatibility).
  }
  flush(out, current);

  if (!sawHeader && out.packages.length === 0) {
    throw new ParseError("yarn.lock: no `# yarn lockfile v1` header and no package blocks");
  }
  return out;
}

function splitDescriptors(s: string): string[] {
  // Descriptors are comma-separated; quoted ones may contain commas — none
  // that matter for name recovery, but split respecting quotes anyway.
  const parts: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const c of s) {
    if (c === '"') inQuote = !inQuote;
    if (c === "," && !inQuote) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts.map((p) => p.trim());
}

function flush(out: ParserOutput, pkg: RawPackage | null): void {
  if (pkg === null) return;
  if (pkg.version === "") {
    out.warnings.push({ message: `package \`${pkg.name}\` has no version — skipped`, line: null });
    return;
  }
  // The same name@version may be reachable through several descriptor
  // groups in pathological lockfiles; keep the first occurrence only.
  const dup = out.packages.some((p) => p.name === pkg.name && p.version === pkg.version);
  if (!dup) out.packages.push(pkg);
}

/** Shared by yarn-berry: integrity entries from a checksum-ish string. */
export function checksumToIntegrity(checksum: string): Integrity[] {
  const c = checksum.trim();
  if (c === "") return [];
  // Berry ≥4 prefixes the cache key: `10c0/<hex>`; older is bare hex (sha512).
  const slash = c.indexOf("/");
  const value = slash === -1 ? c : c.slice(slash + 1);
  return [{ algorithm: "sha512", value }];
}
