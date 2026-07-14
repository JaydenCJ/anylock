/**
 * Normalization: raw parser output → sorted, schema-stamped PackageRecords,
 * and the byte-stable NDJSON serializer.
 *
 * Determinism contract: for the same input bytes, the same anylock version
 * produces the same output bytes — records are sorted (name, version,
 * purl), dependency lists are sorted by name, and serialized key order is
 * fixed. Downstream tools can diff, hash and cache the output.
 */

import { buildPurl } from "./purl.js";
import { formatInfo } from "./detect.js";
import type {
  DependencyRef,
  FormatId,
  PackageRecord,
  ParserOutput,
  ParseResult,
  RawPackage,
} from "./types.js";

function compareRecords(a: PackageRecord, b: PackageRecord): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.version !== b.version) return a.version < b.version ? -1 : 1;
  const ap = a.purl ?? "";
  const bp = b.purl ?? "";
  if (ap !== bp) return ap < bp ? -1 : 1;
  return 0;
}

function sortDeps(deps: DependencyRef[]): DependencyRef[] {
  return [...deps].sort((a, b) =>
    a.name !== b.name ? (a.name < b.name ? -1 : 1) : a.spec < b.spec ? -1 : a.spec > b.spec ? 1 : 0
  );
}

/** Stamp, sort and dedupe raw parser output into the public result shape. */
export function normalize(raw: ParserOutput, format: FormatId, path: string): ParseResult {
  const info = formatInfo(format);
  if (info === undefined) throw new Error(`unknown format id: ${format}`);

  const records: PackageRecord[] = raw.packages.map((p: RawPackage) => ({
    schema: 1,
    name: p.name,
    version: p.version,
    ecosystem: info.ecosystem,
    purl: buildPurl(info.ecosystem, p.name, p.version),
    integrity: p.integrity ?? [],
    resolved: p.resolved ?? null,
    relation: p.relation ?? "unknown",
    scopes: p.scopes ?? [],
    dependencies: sortDeps(p.dependencies ?? []),
    source: { format, path, lockfileVersion: raw.lockfileVersion },
  }));

  records.sort(compareRecords);

  // Dedupe identical (name, version) pairs that some formats can emit twice.
  const deduped: PackageRecord[] = [];
  for (const r of records) {
    const prev = deduped[deduped.length - 1];
    if (prev !== undefined && prev.name === r.name && prev.version === r.version) continue;
    deduped.push(r);
  }

  return {
    format,
    ecosystem: info.ecosystem,
    lockfileVersion: raw.lockfileVersion,
    packages: deduped,
    warnings: raw.warnings,
  };
}

/**
 * Serialize one record as a single NDJSON line (no trailing newline).
 * Key order is part of the schema contract — do not reorder.
 */
export function recordToJson(r: PackageRecord): string {
  return JSON.stringify({
    schema: r.schema,
    name: r.name,
    version: r.version,
    ecosystem: r.ecosystem,
    purl: r.purl,
    integrity: r.integrity.map((i) => ({ algorithm: i.algorithm, value: i.value })),
    resolved: r.resolved,
    relation: r.relation,
    scopes: r.scopes,
    dependencies: r.dependencies.map((d) => ({ name: d.name, spec: d.spec })),
    source: {
      format: r.source.format,
      path: r.source.path,
      lockfileVersion: r.source.lockfileVersion,
    },
  });
}

/** Serialize a list of records as NDJSON (one line each, trailing newline). */
export function toNdjson(records: PackageRecord[]): string {
  return records.map(recordToJson).join("\n") + (records.length > 0 ? "\n" : "");
}
