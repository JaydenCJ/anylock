/**
 * Gemfile.lock — Bundler's indented section format.
 *
 *     GEM
 *       remote: https://rubygems.org/
 *       specs:
 *         rails (7.1.3)
 *           actionpack (= 7.1.3)
 *         rake (13.1.0)
 *
 *     DEPENDENCIES
 *       rails (~> 7.1)
 *
 * Two-space-indented lines under `specs:` are packages; four-space lines
 * are their dependencies. The DEPENDENCIES section lists what the Gemfile
 * asked for — that is the direct set. GIT/PATH sections contribute
 * packages too (resolved = the remote/revision), CHECKSUMS (Bundler ≥2.5)
 * contributes sha256 integrity values.
 */

import { ParseError } from "../types.js";
import type { DependencyRef, ParserOutput, RawPackage } from "../types.js";

const SPEC = /^([^\s(]+)(?:\s+\(([^)]*)\))?$/;

export function parseGemfileLock(content: string): ParserOutput {
  const out: ParserOutput = { lockfileVersion: null, packages: [], warnings: [] };
  const lines = content.split(/\r?\n/);

  let section = "";
  let inSpecs = false;
  let remote: string | null = null;
  let revision: string | null = null;
  let bundledWith: string | null = null;
  let current: RawPackage | null = null;
  const packages: RawPackage[] = [];
  const direct = new Set<string>();
  const checksums = new Map<string, { algorithm: string; value: string }>();

  const flush = (): void => {
    if (current !== null) packages.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();

    if (indent === 0) {
      flush();
      section = text;
      inSpecs = false;
      remote = null;
      revision = null;
      continue;
    }

    if (section === "BUNDLED WITH") {
      bundledWith = text;
      continue;
    }

    if (section === "DEPENDENCIES") {
      const m = SPEC.exec(text);
      if (m !== null) direct.add(m[1]!.replace(/!$/, ""));
      continue;
    }

    if (section === "CHECKSUMS") {
      // `name (1.2.3) sha256=abcdef…`
      const m = /^([^\s(]+)\s+\(([^)]*)\)\s+([a-z0-9]+)=([0-9a-f]+)/.exec(text);
      if (m !== null) {
        checksums.set(`${m[1]}@${m[2]}`, { algorithm: m[3]!, value: m[4]! });
      }
      continue;
    }

    if (section === "GEM" || section === "GIT" || section === "PATH") {
      if (indent === 2) {
        if (text === "specs:") {
          inSpecs = true;
          continue;
        }
        const kv = /^([a-z ]+):\s*(.*)$/.exec(text);
        if (kv !== null) {
          if (kv[1] === "remote") remote = kv[2]!;
          if (kv[1] === "revision") revision = kv[2]!;
        }
        continue;
      }
      if (!inSpecs) continue;
      if (indent === 4) {
        flush();
        const m = SPEC.exec(text);
        if (m === null || m[2] === undefined || m[2] === "") {
          out.warnings.push({ message: `unversioned spec \`${text}\` — skipped`, line: i + 1 });
          continue;
        }
        // Platform-suffixed versions ("1.16.3-x86_64-linux") keep the suffix verbatim.
        current = {
          name: m[1]!,
          version: m[2],
          integrity: [],
          resolved:
            section === "GIT" && remote !== null
              ? revision !== null
                ? `${remote}#${revision}`
                : remote
              : remote,
          relation: "transitive",
          scopes: [],
          dependencies: [],
        };
        continue;
      }
      if (indent >= 6 && current !== null) {
        const m = SPEC.exec(text);
        if (m !== null) {
          current.dependencies!.push({ name: m[1]!, spec: m[2] ?? "" } satisfies DependencyRef);
        }
        continue;
      }
    }
    // PLATFORMS / RUBY VERSION and unknown sections: ignored.
  }
  flush();

  if (packages.length === 0 && !/^(GEM|DEPENDENCIES|PLATFORMS)$/m.test(content)) {
    throw new ParseError("Gemfile.lock: no recognizable Bundler sections");
  }

  for (const pkg of packages) {
    if (direct.has(pkg.name)) pkg.relation = "direct";
    const sum = checksums.get(`${pkg.name}@${pkg.version}`);
    if (sum !== undefined) pkg.integrity = [sum];
    out.packages.push(pkg);
  }
  out.lockfileVersion = bundledWith;
  return out;
}
