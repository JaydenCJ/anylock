/**
 * Yarn Berry (v2+) yarn.lock — YAML with quoted multi-descriptor keys:
 *
 *     "lodash@npm:^4.17.21":
 *       version: 4.17.21
 *       resolution: "lodash@npm:4.17.21"
 *       checksum: 10c0/…
 *       languageName: node
 *       linkType: hard
 *
 * The `resolution` field carries the authoritative name (descriptors can
 * alias); `__metadata.version` is the lockfile version. Entries whose
 * resolution protocol is `workspace:` are the project's own packages and
 * are skipped, matching what every consumer of the lockfile wants.
 */

import { parseYaml } from "../yaml.js";
import { ParseError } from "../types.js";
import type { DependencyRef, ParserOutput, RawPackage } from "../types.js";
import type { YamlMap, YamlValue } from "../yaml.js";
import { checksumToIntegrity, descriptorName } from "./yarnClassic.js";

/** `"lodash@npm:4.17.21"` → { name: "lodash", protocol: "npm", ref: "4.17.21" }. */
function splitResolution(resolution: string): { name: string; protocol: string; ref: string } {
  const at = resolution.lastIndexOf("@");
  const name = at <= 0 ? resolution : resolution.slice(0, at);
  const tail = at <= 0 ? "" : resolution.slice(at + 1);
  const colon = tail.indexOf(":");
  if (colon === -1) return { name, protocol: "", ref: tail };
  return { name, protocol: tail.slice(0, colon), ref: tail.slice(colon + 1) };
}

function isMap(v: YamlValue | undefined): v is YamlMap {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseYarnBerry(content: string): ParserOutput {
  const doc = parseYaml(content);
  if (!isMap(doc)) throw new ParseError("yarn.lock (Berry): top level is not a mapping");

  const meta = doc["__metadata"];
  const lockfileVersion =
    isMap(meta) && (typeof meta["version"] === "number" || typeof meta["version"] === "string")
      ? String(meta["version"])
      : null;
  if (lockfileVersion === null) {
    throw new ParseError("yarn.lock (Berry): missing __metadata.version");
  }

  const out: ParserOutput = { lockfileVersion, packages: [], warnings: [] };

  for (const [key, value] of Object.entries(doc)) {
    if (key === "__metadata") continue;
    if (!isMap(value)) continue;

    const resolutionRaw = value["resolution"];
    const resolution = typeof resolutionRaw === "string" ? resolutionRaw : "";
    const { name, protocol } = resolution !== ""
      ? splitResolution(resolution)
      : { name: descriptorName(key.split(",")[0] ?? key), protocol: "" };
    if (protocol === "workspace") continue; // the project's own workspaces

    const versionRaw = value["version"];
    const version =
      typeof versionRaw === "string" || typeof versionRaw === "number" ? String(versionRaw) : "";
    if (name === "" || version === "") {
      out.warnings.push({ message: `entry \`${key}\` lacks a name or version — skipped`, line: null });
      continue;
    }

    const dependencies: DependencyRef[] = [];
    for (const depsKey of ["dependencies", "optionalDependencies"]) {
      const deps = value[depsKey];
      if (!isMap(deps)) continue;
      for (const [depName, spec] of Object.entries(deps)) {
        dependencies.push({
          name: depName,
          spec: typeof spec === "string" || typeof spec === "number" ? String(spec) : "",
        });
      }
    }

    const checksum = value["checksum"];
    const pkg: RawPackage = {
      name,
      version,
      integrity: typeof checksum === "string" ? checksumToIntegrity(checksum) : [],
      // Berry does not store a URL; the resolution locator is the closest thing.
      resolved: resolution !== "" ? resolution : null,
      relation: "unknown", // directness lives in package.json, not the lockfile
      scopes: [],
      dependencies,
    };
    out.packages.push(pkg);
  }
  return out;
}
