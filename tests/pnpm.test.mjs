// pnpm-lock.yaml parser tests — v9 (snapshots section) and v6 (slash
// keys, per-package dev flags), plus the key-grammar edge cases.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLockfile } from "../dist/index.js";
import { fixture } from "./helpers.mjs";

const v9 = () => parseLockfile(fixture("pnpm-lock.v9.yaml"), { filename: "pnpm-lock.yaml" });
const v6 = () => parseLockfile(fixture("pnpm-lock.v6.yaml"), { filename: "pnpm-lock.yaml" });

test("pnpm v9: catalog keys split into name and version", () => {
  const r = v9();
  assert.equal(r.lockfileVersion, "9.0");
  assert.deepEqual(
    r.packages.map((p) => `${p.name}@${p.version}`),
    ["debug@4.3.4", "ms@2.1.2", "typescript@5.4.5"]
  );
});

test("pnpm v9: integrity from `resolution`, edges from `snapshots`", () => {
  const p = v9().packages.find((p) => p.name === "debug");
  assert.equal(p.integrity[0].algorithm, "sha512");
  assert.match(p.integrity[0].value, /^PRWFHuSU3eDtQJPvnNY7/);
  assert.deepEqual(p.dependencies, [{ name: "ms", spec: "2.1.2" }]);
});

test("pnpm v9: importer maps decide direct vs transitive and dev scope", () => {
  const r = v9();
  assert.equal(r.packages.find((p) => p.name === "debug").relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "ms").relation, "transitive");
  const ts = r.packages.find((p) => p.name === "typescript");
  assert.equal(ts.relation, "direct");
  assert.deepEqual(ts.scopes, ["dev"]);
});

test("pnpm v6: slash keys, scoped names, direct set, in-entry deps", () => {
  const r = v6();
  assert.equal(r.lockfileVersion, "6.0");
  assert.deepEqual(
    r.packages.map((p) => p.name),
    ["@fastify/cookie", "cookie-signature", "fastify-plugin"]
  );
  const cookie = r.packages[0];
  assert.equal(cookie.purl, "pkg:npm/%40fastify/cookie@9.3.1");
  assert.equal(cookie.relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "cookie-signature").relation, "transitive");
  // v6 has no snapshots section — edges come from the entry itself.
  assert.deepEqual(cookie.dependencies, [
    { name: "cookie-signature", spec: "1.2.1" },
    { name: "fastify-plugin", spec: "4.5.1" },
  ]);
});

test("pnpm: peer suffixes are stripped from v6+ keys and dep versions", () => {
  const lock = [
    "lockfileVersion: '9.0'",
    "importers:",
    "  .:",
    "    dependencies:",
    "      uses-peer:",
    "        specifier: ^1.0.0",
    "        version: 1.0.0(react@18.2.0)",
    "packages:",
    "  uses-peer@1.0.0(react@18.2.0):",
    "    resolution: {integrity: sha512-aaa}",
    "  react@18.2.0:",
    "    resolution: {integrity: sha512-bbb}",
    "snapshots:",
    "  uses-peer@1.0.0(react@18.2.0):",
    "    dependencies:",
    "      react: 18.2.0",
    "  react@18.2.0: {}",
    "",
  ].join("\n");
  const r = parseLockfile(lock, { filename: "pnpm-lock.yaml" });
  const p = r.packages.find((p) => p.name === "uses-peer");
  assert.equal(p.version, "1.0.0");
  assert.deepEqual(p.dependencies, [{ name: "react", spec: "18.2.0" }]);
});

test("pnpm: v5 slash-and-underscore keys parse with the legacy grammar", () => {
  const lock = [
    "lockfileVersion: 5.4",
    "dependencies:",
    "  foo: 1.0.0_react@16.0.0",
    "packages:",
    "  /foo/1.0.0_react@16.0.0:",
    "    resolution: {integrity: sha512-ccc}",
    "  /@types/node/20.12.0:",
    "    resolution: {integrity: sha512-ddd}",
    "",
  ].join("\n");
  const r = parseLockfile(lock, { filename: "pnpm-lock.yaml" });
  assert.deepEqual(
    r.packages.map((p) => `${p.name}@${p.version}`),
    ["@types/node@20.12.0", "foo@1.0.0"]
  );
});

test("pnpm: unparseable package keys produce a warning, not a crash", () => {
  const lock = "lockfileVersion: '9.0'\npackages:\n  '???':\n    resolution: {integrity: sha512-x}\n";
  const r = parseLockfile(lock, { filename: "pnpm-lock.yaml" });
  assert.equal(r.packages.length, 0);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].message, /unrecognized package key/);
});
