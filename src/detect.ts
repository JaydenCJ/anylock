/**
 * Lockfile format detection: filename first, content sniffing second.
 *
 * Filenames are authoritative for the well-known names (a file called
 * `Cargo.lock` is Cargo's, full stop) except where one name covers two
 * formats — `yarn.lock` is classic (v1) or Berry depending on content.
 * When the filename says nothing (stdin, renamed files), the content
 * sniffers below look for structural markers unique to each format.
 */

import type { FormatId, Ecosystem } from "./types.js";

/** Descriptor for one supported format (also drives `anylock formats`). */
export interface FormatInfo {
  id: FormatId;
  ecosystem: Ecosystem;
  /** Canonical filename(s) the ecosystem writes. */
  filenames: string[];
  /** Human label for tables and docs. */
  label: string;
}

/** All supported formats, in the order `anylock formats` lists them. */
export const FORMATS: readonly FormatInfo[] = [
  { id: "npm", ecosystem: "npm", filenames: ["package-lock.json", "npm-shrinkwrap.json"], label: "npm package-lock.json (v1-v3)" },
  { id: "yarn-classic", ecosystem: "npm", filenames: ["yarn.lock"], label: "Yarn classic yarn.lock (v1)" },
  { id: "yarn-berry", ecosystem: "npm", filenames: ["yarn.lock"], label: "Yarn Berry yarn.lock (v2+)" },
  { id: "pnpm", ecosystem: "npm", filenames: ["pnpm-lock.yaml"], label: "pnpm pnpm-lock.yaml (v5-v9)" },
  { id: "cargo", ecosystem: "cargo", filenames: ["Cargo.lock"], label: "Cargo Cargo.lock" },
  { id: "go-sum", ecosystem: "golang", filenames: ["go.sum"], label: "Go go.sum" },
  { id: "poetry", ecosystem: "pypi", filenames: ["poetry.lock"], label: "Poetry poetry.lock" },
  { id: "pipfile", ecosystem: "pypi", filenames: ["Pipfile.lock"], label: "Pipenv Pipfile.lock" },
  { id: "pip-requirements", ecosystem: "pypi", filenames: ["requirements.txt"], label: "pip requirements.txt (pinned)" },
  { id: "gemfile", ecosystem: "gem", filenames: ["Gemfile.lock"], label: "Bundler Gemfile.lock" },
  { id: "composer", ecosystem: "composer", filenames: ["composer.lock"], label: "Composer composer.lock" },
  { id: "swiftpm", ecosystem: "swift", filenames: ["Package.resolved"], label: "SwiftPM Package.resolved" },
];

const BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

/** Look up a format descriptor by id (undefined for unknown ids). */
export function formatInfo(id: string): FormatInfo | undefined {
  return BY_ID.get(id as FormatId);
}

function isYarnBerry(content: string): boolean {
  return /^__metadata:/m.test(content);
}

/** Best-effort JSON sniff without throwing. */
function tryJson(content: string): unknown {
  const t = content.trimStart();
  if (!t.startsWith("{")) return undefined;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Detect the format of `content`, optionally hinted by `filename`
 * (a basename or any path — only the last component is considered).
 * Returns null when nothing matches; anylock refuses to guess further.
 */
export function detectFormat(content: string, filename?: string): FormatId | null {
  const base = filename === undefined ? "" : filename.replace(/\\/g, "/").split("/").pop() ?? "";

  switch (base) {
    case "package-lock.json":
    case "npm-shrinkwrap.json":
      return "npm";
    case "yarn.lock":
      return isYarnBerry(content) ? "yarn-berry" : "yarn-classic";
    case "pnpm-lock.yaml":
    case "pnpm-lock.yml":
      return "pnpm";
    case "Cargo.lock":
      return "cargo";
    case "go.sum":
      return "go-sum";
    case "poetry.lock":
      return "poetry";
    case "Pipfile.lock":
      return "pipfile";
    case "Gemfile.lock":
    case "gems.locked":
      return "gemfile";
    case "composer.lock":
      return "composer";
    case "Package.resolved":
      return "swiftpm";
    default:
      break;
  }
  // requirements.txt and friends (requirements-dev.txt, requirements/prod.txt).
  if (/^requirements[^/]*\.txt$/.test(base)) return "pip-requirements";

  return sniffContent(content);
}

/** Content-only detection, used for stdin and unrecognized filenames. */
export function sniffContent(content: string): FormatId | null {
  const json = tryJson(content);
  if (json !== undefined && typeof json === "object" && json !== null) {
    const o = json as Record<string, unknown>;
    if ("lockfileVersion" in o && ("packages" in o || "dependencies" in o)) return "npm";
    if ("_meta" in o && ("default" in o || "develop" in o)) return "pipfile";
    if ("content-hash" in o && ("packages" in o || "packages-dev" in o)) return "composer";
    if ("pins" in o && Array.isArray(o["pins"])) return "swiftpm";
    const obj = o["object"];
    if (typeof obj === "object" && obj !== null && "pins" in (obj as Record<string, unknown>)) {
      return "swiftpm";
    }
    return null;
  }

  if (/^#\s*yarn lockfile v1/m.test(content)) return "yarn-classic";
  if (isYarnBerry(content)) return "yarn-berry";
  if (/^lockfileVersion:/m.test(content)) return "pnpm";

  if (/^\[\[package\]\]/m.test(content)) {
    // Cargo.lock and poetry.lock share the [[package]] skeleton; poetry
    // always records python-versions / [package.*] subtables, Cargo never does.
    if (/^python-versions\s*=/m.test(content) || /^\[package\./m.test(content)) return "poetry";
    return "cargo";
  }

  if (/^[^\s]+\s+v\d[^\s]*(\/go\.mod)?\s+h1:[A-Za-z0-9+/=]+$/m.test(content)) return "go-sum";
  if (/^GEM\r?\n/m.test(content) && /^ {2}specs:/m.test(content)) return "gemfile";
  if (/^\s*[A-Za-z0-9_.-]+(\[[^\]]*\])?==[^\s;]+/m.test(content)) return "pip-requirements";

  return null;
}
