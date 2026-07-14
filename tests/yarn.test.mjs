// yarn.lock parser tests — the classic v1 indent format and the Berry
// YAML format, which share a filename but almost nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLockfile, ParseError } from "../dist/index.js";
import { fixture } from "./helpers.mjs";

const classic = () => parseLockfile(fixture("yarn-classic.lock"), { filename: "yarn.lock" });
const berry = () => parseLockfile(fixture("yarn-berry.lock"), { filename: "yarn.lock" });

test("yarn classic: multi-descriptor group is one package; relation unknown", () => {
  const r = classic();
  // `lodash@^4.17.20, lodash@^4.17.21:` is a single 4.17.21 record.
  const lodash = r.packages.filter((p) => p.name === "lodash");
  assert.equal(lodash.length, 1);
  assert.equal(lodash[0].version, "4.17.21");
  // v1 lockfiles carry no manifest, so directness is honestly unknown.
  for (const p of r.packages) assert.equal(p.relation, "unknown");
});

test("yarn classic: scoped quoted descriptors recover the right name", () => {
  const p = classic().packages.find((p) => p.name === "@babel/code-frame");
  assert.equal(p.version, "7.24.2");
  assert.equal(p.purl, "pkg:npm/%40babel/code-frame@7.24.2");
});

test("yarn classic: resolved, integrity and dependency sub-blocks parse", () => {
  const pico = classic().packages.find((p) => p.name === "picocolors");
  assert.match(pico.resolved, /^https:\/\/registry\.yarnpkg\.com\/picocolors/);
  assert.equal(pico.integrity[0].algorithm, "sha512");
  const babel = classic().packages.find((p) => p.name === "@babel/code-frame");
  assert.deepEqual(babel.dependencies, [
    { name: "@babel/highlight", spec: "^7.24.2" },
    { name: "picocolors", spec: "^1.0.0" },
  ]);
});

test("yarn classic: garbage without the v1 header raises ParseError", () => {
  assert.throws(() => parseLockfile("random text\n", { format: "yarn-classic" }), ParseError);
});

test("yarn berry: __metadata version kept; workspace entries excluded", () => {
  const r = berry();
  assert.equal(r.lockfileVersion, "8");
  assert.deepEqual(r.packages.map((p) => p.name), ["lodash", "ms"]);
});

test("yarn berry: name from resolution; cache-key prefix stripped from checksum", () => {
  const lodash = berry().packages.find((p) => p.name === "lodash");
  assert.equal(lodash.version, "4.17.21");
  assert.equal(lodash.resolved, "lodash@npm:4.17.21");
  const ms = berry().packages.find((p) => p.name === "ms");
  assert.equal(ms.integrity[0].algorithm, "sha512");
  assert.match(ms.integrity[0].value, /^aa92de/);
  assert.ok(!ms.integrity[0].value.includes("/"));
});

test("yarn berry: missing __metadata raises ParseError", () => {
  assert.throws(
    () => parseLockfile('"x@npm:^1":\n  version: 1.0.0\n', { format: "yarn-berry" }),
    (e) => e instanceof ParseError && /__metadata/.test(e.message)
  );
});
