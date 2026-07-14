// Normalization and serialization contract tests: fixed key order,
// stable sorting, determinism, dedupe — the properties downstream tools
// are allowed to rely on.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLockfile, recordToJson, toNdjson } from "../dist/index.js";
import { fixture } from "./helpers.mjs";

const KEYS = [
  "schema",
  "name",
  "version",
  "ecosystem",
  "purl",
  "integrity",
  "resolved",
  "relation",
  "scopes",
  "dependencies",
  "source",
];

test("normalize: every record carries schema 1 and the full key set in order", () => {
  const r = parseLockfile(fixture("package-lock.v3.json"), { filename: "package-lock.json" });
  for (const p of r.packages) {
    assert.equal(p.schema, 1);
    const line = JSON.parse(recordToJson(p));
    assert.deepEqual(Object.keys(line), KEYS);
    assert.deepEqual(Object.keys(line.source), ["format", "path", "lockfileVersion"]);
  }
});

test("normalize: records sorted by (name, version); dependencies by name", () => {
  const r = parseLockfile(fixture("Cargo.lock"), { filename: "Cargo.lock" });
  const pairs = r.packages.map((p) => [p.name, p.version]);
  const sorted = [...pairs].sort((a, b) =>
    a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
  );
  assert.deepEqual(pairs, sorted);
  const poetry = parseLockfile(fixture("poetry.lock"), { filename: "poetry.lock" });
  for (const p of poetry.packages) {
    const names = p.dependencies.map((d) => d.name);
    assert.deepEqual(names, [...names].sort());
  }
});

test("normalize: parsing twice yields byte-identical NDJSON", () => {
  for (const [file, name] of [
    ["package-lock.v3.json", "package-lock.json"],
    ["pnpm-lock.v9.yaml", "pnpm-lock.yaml"],
    ["Gemfile.lock", "Gemfile.lock"],
  ]) {
    const a = toNdjson(parseLockfile(fixture(file), { filename: name }).packages);
    const b = toNdjson(parseLockfile(fixture(file), { filename: name }).packages);
    assert.equal(a, b, `${file} must serialize deterministically`);
  }
});

test("normalize: identical (name, version) pairs are deduped", () => {
  // yarn classic can express the same resolution under two groups.
  const lock = [
    "# yarn lockfile v1",
    "",
    'ms@^2.0.0:',
    '  version "2.1.3"',
    '  resolved "https://registry.yarnpkg.com/ms/-/ms-2.1.3.tgz#x"',
    "",
    'ms@^2.1.0:',
    '  version "2.1.3"',
    '  resolved "https://registry.yarnpkg.com/ms/-/ms-2.1.3.tgz#x"',
    "",
  ].join("\n");
  const r = parseLockfile(lock, { format: "yarn-classic" });
  assert.equal(r.packages.length, 1);
});

test("normalize: source.path records what the caller passed", () => {
  const r = parseLockfile(fixture("go.sum"), { filename: "backend/go.sum" });
  assert.ok(r.packages.every((p) => p.source.path === "backend/go.sum"));
  const anon = parseLockfile(fixture("go.sum"), { format: "go-sum" });
  assert.ok(anon.packages.every((p) => p.source.path === ""));
});

test("toNdjson: one line per record, trailing newline, empty list -> empty string", () => {
  const r = parseLockfile(fixture("composer.lock"), { filename: "composer.lock" });
  const text = toNdjson(r.packages);
  assert.ok(text.endsWith("\n"));
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, r.packages.length);
  for (const line of lines) JSON.parse(line); // every line is standalone JSON
  assert.equal(toNdjson([]), "");
});

test("parseLockfile: explicit format overrides detection; unknown input names the file", () => {
  const r = parseLockfile(fixture("yarn-berry.lock"), { format: "yarn-berry" });
  assert.equal(r.format, "yarn-berry");
  assert.throws(
    () => parseLockfile("hello world", { filename: "notes.md" }),
    (e) => /notes\.md/.test(e.message)
  );
});
