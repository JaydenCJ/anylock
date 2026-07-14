/**
 * SwiftPM Package.resolved — versions 1 (object.pins), 2 and 3 (pins).
 *
 * A pin's `state` has `version` + `revision` for release pins, or
 * `branch`/`revision` only for branch pins; branch pins use the revision
 * as the version so the record still identifies an exact snapshot. The
 * purl name is derived from the repository URL (host/owner/repo); the
 * revision is recorded as integrity with algorithm `git-revision` since
 * that commit hash is exactly what SwiftPM verifies on fetch.
 */

import { ParseError } from "../types.js";
import { swiftNameFromLocation } from "../purl.js";
import type { Integrity, ParserOutput } from "../types.js";

interface Pin {
  identity: string;
  location: string;
  version: string;
  revision: string;
}

function readPin(value: unknown): Pin | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  // v2/v3: identity + location; v1: package + repositoryURL.
  const identity =
    typeof p["identity"] === "string"
      ? p["identity"]
      : typeof p["package"] === "string"
        ? p["package"].toLowerCase()
        : "";
  const location =
    typeof p["location"] === "string"
      ? p["location"]
      : typeof p["repositoryURL"] === "string"
        ? p["repositoryURL"]
        : "";
  const state = p["state"];
  let version = "";
  let revision = "";
  if (typeof state === "object" && state !== null) {
    const s = state as Record<string, unknown>;
    if (typeof s["version"] === "string" && s["version"] !== "") version = s["version"];
    if (typeof s["revision"] === "string") revision = s["revision"];
    if (version === "" && typeof s["branch"] === "string" && revision !== "") {
      version = revision; // branch pin: the commit is the only exact identity
    }
  }
  if (identity === "" && location === "") return null;
  return { identity, location, version, revision };
}

export function parseSwiftPm(content: string): ParserOutput {
  let doc: unknown;
  try {
    doc = JSON.parse(content) as unknown;
  } catch (e) {
    throw new ParseError(`Package.resolved is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new ParseError("Package.resolved: top level is not an object");
  }
  const root = doc as Record<string, unknown>;
  const fileVersion = root["version"];
  const lockfileVersion =
    typeof fileVersion === "number" || typeof fileVersion === "string"
      ? String(fileVersion)
      : null;

  let pins: unknown = root["pins"];
  if (pins === undefined) {
    const obj = root["object"];
    if (typeof obj === "object" && obj !== null) {
      pins = (obj as Record<string, unknown>)["pins"];
    }
  }
  if (!Array.isArray(pins)) {
    throw new ParseError("Package.resolved: no pins array (looked at `pins` and `object.pins`)");
  }

  const out: ParserOutput = { lockfileVersion, packages: [], warnings: [] };
  for (const value of pins) {
    const pin = readPin(value);
    if (pin === null) {
      out.warnings.push({ message: "unrecognized pin entry — skipped", line: null });
      continue;
    }
    if (pin.version === "") {
      out.warnings.push({
        message: `pin \`${pin.identity}\` has neither version nor revision — skipped`,
        line: null,
      });
      continue;
    }
    const urlName = swiftNameFromLocation(pin.location);
    const integrity: Integrity[] =
      pin.revision !== "" ? [{ algorithm: "git-revision", value: pin.revision }] : [];
    out.packages.push({
      // Prefer the URL-derived name (purl-compatible); fall back to the identity.
      name: urlName ?? pin.identity,
      version: pin.version,
      integrity,
      resolved: pin.location !== "" ? pin.location : null,
      relation: "unknown", // Package.resolved flattens the whole graph
      scopes: [],
      dependencies: [],
    });
  }
  return out;
}
