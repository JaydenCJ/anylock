// npm package-lock.json parser tests — v3 `packages` map and legacy v1
// nested `dependencies`, plus the edge cases that break naive parsers:
// scoped install paths, workspace links, dev/optional flags.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLockfile, ParseError } from "../dist/index.js";
import { fixture } from "./helpers.mjs";

const v3 = () => parseLockfile(fixture("package-lock.v3.json"), { filename: "package-lock.json" });

test("npm v3: root excluded; scoped names recovered from install paths", () => {
  const r = v3();
  assert.equal(r.lockfileVersion, "3");
  assert.deepEqual(
    r.packages.map((p) => p.name),
    ["@scope/util", "left-pad", "lodash", "tiny-emitter"]
  );
  const scoped = r.packages.find((p) => p.name === "@scope/util");
  assert.equal(scoped.version, "2.1.4");
  assert.equal(scoped.purl, "pkg:npm/%40scope/util@2.1.4");
});

test("npm v3: relation from the root's declared deps; dev/optional scopes", () => {
  const r = v3();
  assert.equal(r.packages.find((p) => p.name === "lodash").relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "left-pad").relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "tiny-emitter").relation, "transitive");
  assert.deepEqual(r.packages.find((p) => p.name === "left-pad").scopes, ["dev"]);
  assert.deepEqual(r.packages.find((p) => p.name === "tiny-emitter").scopes, ["optional"]);
  assert.deepEqual(r.packages.find((p) => p.name === "lodash").scopes, []);
});

test("npm v3: SRI integrity split, dependency edges keep requested specs", () => {
  const lodash = v3().packages.find((p) => p.name === "lodash");
  assert.equal(lodash.integrity.length, 1);
  assert.equal(lodash.integrity[0].algorithm, "sha512");
  assert.match(lodash.integrity[0].value, /^v2kDEe57/);
  const util = v3().packages.find((p) => p.name === "@scope/util");
  assert.deepEqual(util.dependencies, [{ name: "tiny-emitter", spec: "^2.1.0" }]);
});

test("npm v1: nested tree flattened and deduped; `requires` become edges", () => {
  const r = parseLockfile(fixture("package-lock.v1.json"), { filename: "package-lock.json" });
  assert.equal(r.lockfileVersion, "1");
  assert.deepEqual(
    r.packages.map((p) => `${p.name}@${p.version}`),
    ["accepts@1.3.8", "mime-types@2.1.35", "negotiator@0.6.3"]
  );
  // depth-0 entries are the root's resolved (direct) deps
  assert.equal(r.packages.find((p) => p.name === "accepts").relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "negotiator").relation, "transitive");
  assert.deepEqual(r.packages.find((p) => p.name === "accepts").dependencies, [
    { name: "mime-types", spec: "~2.1.34" },
    { name: "negotiator", spec: "0.6.3" },
  ]);
});

test("npm: workspace link entries are skipped, not duplicated", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "root", version: "1.0.0" },
      "packages/lib": { name: "lib", version: "1.0.0" },
      "node_modules/lib": { link: true, resolved: "packages/lib" },
      "node_modules/ms": { version: "2.1.3", integrity: "sha512-abc" },
    },
  });
  const r = parseLockfile(lock, { filename: "package-lock.json" });
  // `lib` appears once (the workspace source entry has a name), `ms` once.
  assert.deepEqual(r.packages.map((p) => p.name), ["lib", "ms"]);
});

test("npm: invalid JSON raises ParseError, not a raw SyntaxError", () => {
  assert.throws(
    () => parseLockfile("{not json", { filename: "package-lock.json" }),
    (e) => e instanceof ParseError && /not valid JSON/.test(e.message)
  );
});

test("npm: entries without a version are skipped with a warning", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: { "": {}, "node_modules/broken": { resolved: "x" } },
  });
  const r = parseLockfile(lock, { filename: "package-lock.json" });
  assert.equal(r.packages.length, 0);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].message, /no version/);
});
