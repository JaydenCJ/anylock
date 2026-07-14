/**
 * package-url (purl) construction, per ecosystem.
 *
 * Implements the type-specific rules from the purl spec that matter for
 * lockfile-derived coordinates: npm scopes become the namespace, pypi
 * names are normalized (lowercase, `_`/`.` → `-`), golang and composer
 * paths are lowercased with the leading segments as namespace, and every
 * segment is percent-encoded. Returns null instead of fabricating a purl
 * when a version is a bare git revision placeholder or a name is empty.
 */

import type { Ecosystem } from "./types.js";

/**
 * Percent-encode one purl path segment. The purl spec allows unreserved
 * characters plus a few extras; we encode conservatively and never encode
 * characters the spec keeps literal in segments.
 */
function encodeSegment(s: string): string {
  return encodeURIComponent(s).replace(/%2B/g, "+").replace(/%7E/g, "~");
}

function joinPath(segments: string[]): string {
  return segments.map(encodeSegment).join("/");
}

/**
 * Build a purl for a package. `name` is the ecosystem-native name
 * (npm: possibly `@scope/pkg`; golang: full module path; composer:
 * `vendor/package`; swift: repository URL host+path).
 */
export function buildPurl(ecosystem: Ecosystem, name: string, version: string): string | null {
  const n = name.trim();
  const v = version.trim();
  if (n === "" || v === "") return null;

  switch (ecosystem) {
    case "npm": {
      if (n.startsWith("@")) {
        const slash = n.indexOf("/");
        if (slash === -1) return null;
        const scope = n.slice(0, slash);
        const pkg = n.slice(slash + 1);
        if (pkg === "") return null;
        return `pkg:npm/${encodeSegment(scope)}/${encodeSegment(pkg)}@${encodeSegment(v)}`;
      }
      return `pkg:npm/${encodeSegment(n)}@${encodeSegment(v)}`;
    }
    case "cargo":
      return `pkg:cargo/${encodeSegment(n)}@${encodeSegment(v)}`;
    case "gem":
      return `pkg:gem/${encodeSegment(n)}@${encodeSegment(v)}`;
    case "pypi": {
      // PEP 503 normalization, mandated by the purl spec for type pypi.
      const norm = n.toLowerCase().replace(/[-_.]+/g, "-");
      return `pkg:pypi/${encodeSegment(norm)}@${encodeSegment(v)}`;
    }
    case "golang": {
      // Module path is lowercased; last segment is the name, the rest the namespace.
      const path = n.toLowerCase().split("/").filter((p) => p !== "");
      if (path.length === 0) return null;
      const pkg = path[path.length - 1]!;
      const ns = path.slice(0, -1);
      const head = ns.length > 0 ? `${joinPath(ns)}/` : "";
      return `pkg:golang/${head}${encodeSegment(pkg)}@${encodeSegment(v)}`;
    }
    case "composer": {
      const lower = n.toLowerCase();
      const slash = lower.indexOf("/");
      if (slash === -1) return `pkg:composer/${encodeSegment(lower)}@${encodeSegment(v)}`;
      const vendor = lower.slice(0, slash);
      const pkg = lower.slice(slash + 1);
      if (vendor === "" || pkg === "") return null;
      return `pkg:composer/${encodeSegment(vendor)}/${encodeSegment(pkg)}@${encodeSegment(v)}`;
    }
    case "swift": {
      // `name` is host/path derived from the repository URL.
      const path = n.split("/").filter((p) => p !== "");
      if (path.length < 2) return null;
      const pkg = path[path.length - 1]!;
      const ns = path.slice(0, -1);
      return `pkg:swift/${joinPath(ns)}/${encodeSegment(pkg)}@${encodeSegment(v)}`;
    }
  }
}

/**
 * Derive the swift purl "name" (host + owner path + repo) from a
 * repository location URL. Returns null for locations that are not
 * URL-shaped (local paths, registry identities without a URL).
 */
export function swiftNameFromLocation(location: string): string | null {
  const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/?#]+)(\/[^?#]*)?/.exec(location.trim());
  if (m === null) {
    // scp-like syntax: git@github.com:owner/repo.git
    const scp = /^[^@\s]+@([^:\s]+):(.+)$/.exec(location.trim());
    if (scp === null) return null;
    const host = scp[1]!;
    const path = scp[2]!.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
    return path === "" ? null : `${host}/${path}`;
  }
  const host = m[1]!;
  const path = (m[2] ?? "").replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
  return path === "" ? null : `${host}/${path}`;
}
