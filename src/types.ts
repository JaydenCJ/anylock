/**
 * Public types for anylock.
 *
 * The normalized record shape (`PackageRecord`) is the whole point of the
 * project: twelve lockfile formats in, one stable schema out. Fields are
 * additive-only across minor versions; `schema` names the record revision
 * so downstream tools can gate on it.
 */

/** Identifier of a supported lockfile format. Stable API — never renamed. */
export type FormatId =
  | "npm"
  | "yarn-classic"
  | "yarn-berry"
  | "pnpm"
  | "cargo"
  | "go-sum"
  | "poetry"
  | "pipfile"
  | "pip-requirements"
  | "gemfile"
  | "composer"
  | "swiftpm";

/** Package ecosystem a record belongs to (also the purl type). */
export type Ecosystem =
  | "npm"
  | "cargo"
  | "golang"
  | "pypi"
  | "gem"
  | "composer"
  | "swift";

/**
 * How the package relates to the project the lockfile belongs to.
 * `"unknown"` is deliberate honesty: several formats (go.sum, yarn v1
 * without a manifest) do not record directness, and anylock never guesses.
 */
export type Relation = "direct" | "transitive" | "unknown";

/** A dependency scope flag recorded by the lockfile itself. */
export type Scope = "dev" | "optional" | "peer";

/** One content hash, algorithm kept verbatim from the source format. */
export interface Integrity {
  /** e.g. "sha512", "sha256", "h1" (Go dirhash), "sha1". */
  algorithm: string;
  /** Digest exactly as written in the lockfile (base64 or hex — not re-encoded). */
  value: string;
}

/** An edge to another package as the lockfile declares it. */
export interface DependencyRef {
  name: string;
  /** Version constraint or pinned version, verbatim (may be empty when the format omits it). */
  spec: string;
}

/** Where a record came from. */
export interface SourceInfo {
  /** Which parser produced the record. */
  format: FormatId;
  /** Path or filename the caller supplied (empty string when parsing anonymous content). */
  path: string;
  /** The lockfile's own version marker, when it has one ("3", "9.0", "2.0", …). */
  lockfileVersion: string | null;
}

/**
 * The normalized package record — one NDJSON line per locked package.
 * Key order in serialized output is fixed (see normalize.ts) so that
 * output is byte-stable across runs and machines.
 */
export interface PackageRecord {
  /** Record schema revision. Always 1 for anylock 0.1.x. */
  schema: 1;
  name: string;
  version: string;
  ecosystem: Ecosystem;
  /** package-url (purl) computed from name/version/ecosystem, or null when a purl cannot be formed. */
  purl: string | null;
  integrity: Integrity[];
  /** Resolution URL / registry tarball / repository location, when recorded. */
  resolved: string | null;
  relation: Relation;
  scopes: Scope[];
  dependencies: DependencyRef[];
  source: SourceInfo;
}

/** A non-fatal problem encountered while parsing (fatal ones throw ParseError). */
export interface ParseWarning {
  message: string;
  /** 1-based line number when known. */
  line: number | null;
}

/** Result of parsing one lockfile. */
export interface ParseResult {
  format: FormatId;
  ecosystem: Ecosystem;
  lockfileVersion: string | null;
  packages: PackageRecord[];
  warnings: ParseWarning[];
}

/** Thrown when content cannot be parsed as the (detected or forced) format. */
export class ParseError extends Error {
  /** 1-based line number when known. */
  readonly line: number | null;
  constructor(message: string, line: number | null = null) {
    super(line === null ? message : `${message} (line ${line})`);
    this.name = "ParseError";
    this.line = line;
  }
}

/** Internal: what a format parser returns as a whole. */
export interface ParserOutput {
  lockfileVersion: string | null;
  packages: RawPackage[];
  warnings: ParseWarning[];
}

/** Internal: what a format parser returns before normalization fills in schema/purl/sorting. */
export interface RawPackage {
  name: string;
  version: string;
  integrity?: Integrity[];
  resolved?: string | null;
  relation?: Relation;
  scopes?: Scope[];
  dependencies?: DependencyRef[];
}
