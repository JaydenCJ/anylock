/**
 * anylock — public programmatic API.
 *
 *     import { parseLockfile } from "anylock";
 *     const result = parseLockfile(content, { filename: "package-lock.json" });
 *     for (const pkg of result.packages) console.log(pkg.purl);
 */

import { detectFormat, sniffContent, FORMATS, formatInfo } from "./detect.js";
import { normalize, recordToJson, toNdjson } from "./normalize.js";
import { buildPurl } from "./purl.js";
import { ParseError } from "./types.js";
import { parseNpm } from "./parsers/npm.js";
import { parseYarnClassic } from "./parsers/yarnClassic.js";
import { parseYarnBerry } from "./parsers/yarnBerry.js";
import { parsePnpm } from "./parsers/pnpm.js";
import { parseCargo } from "./parsers/cargo.js";
import { parseGoSum } from "./parsers/gosum.js";
import { parsePoetry } from "./parsers/poetry.js";
import { parsePipfile } from "./parsers/pipfile.js";
import { parseRequirements } from "./parsers/requirements.js";
import { parseGemfileLock } from "./parsers/gemfile.js";
import { parseComposer } from "./parsers/composer.js";
import { parseSwiftPm } from "./parsers/swiftpm.js";
import type { FormatId, ParserOutput, ParseResult } from "./types.js";

export { detectFormat, sniffContent, FORMATS, formatInfo } from "./detect.js";
export { buildPurl, swiftNameFromLocation } from "./purl.js";
export { recordToJson, toNdjson } from "./normalize.js";
export { parseToml } from "./toml.js";
export { parseYaml } from "./yaml.js";
export { ParseError } from "./types.js";
export type {
  DependencyRef,
  Ecosystem,
  FormatId,
  Integrity,
  PackageRecord,
  ParseResult,
  ParseWarning,
  Relation,
  Scope,
  SourceInfo,
} from "./types.js";
export type { FormatInfo } from "./detect.js";

const PARSERS: Record<FormatId, (content: string) => ParserOutput> = {
  "npm": parseNpm,
  "yarn-classic": parseYarnClassic,
  "yarn-berry": parseYarnBerry,
  "pnpm": parsePnpm,
  "cargo": parseCargo,
  "go-sum": parseGoSum,
  "poetry": parsePoetry,
  "pipfile": parsePipfile,
  "pip-requirements": parseRequirements,
  "gemfile": parseGemfileLock,
  "composer": parseComposer,
  "swiftpm": parseSwiftPm,
};

export interface ParseOptions {
  /** Filename or path used for detection and recorded in `source.path`. */
  filename?: string;
  /** Skip detection and force a specific format. */
  format?: FormatId;
}

/**
 * Parse lockfile content into normalized package records.
 * Throws ParseError when the format cannot be detected or the content
 * does not parse as that format.
 */
export function parseLockfile(content: string, options: ParseOptions = {}): ParseResult {
  const format = options.format ?? detectFormat(content, options.filename);
  if (format === null) {
    throw new ParseError(
      options.filename === undefined || options.filename === ""
        ? "could not detect the lockfile format from content"
        : `could not detect the lockfile format of \`${options.filename}\``
    );
  }
  const parser = PARSERS[format];
  if (parser === undefined) {
    throw new ParseError(`unsupported format: ${format}`);
  }
  const raw = parser(content);
  return normalize(raw, format, options.filename ?? "");
}

/** All supported format ids, in canonical listing order. */
export function listFormats(): FormatId[] {
  return FORMATS.map((f) => f.id);
}
