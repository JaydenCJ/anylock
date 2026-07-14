// Cargo.lock and go.sum parser tests — the two "systems" formats.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLockfile, ParseError } from "../dist/index.js";
import { fixture } from "./helpers.mjs";

const cargo = () => parseLockfile(fixture("Cargo.lock"), { filename: "Cargo.lock" });

test("cargo: workspace member is excluded, registry crates kept", () => {
  const r = cargo();
  assert.equal(r.lockfileVersion, "4");
  assert.ok(r.packages.every((p) => p.name !== "fixture-crate"));
  assert.equal(r.packages.length, 8);
});

test("cargo: checksum -> sha256, source -> resolved, cargo-type purls", () => {
  const serde = cargo().packages.find((p) => p.name === "serde");
  assert.deepEqual(serde.integrity, [
    { algorithm: "sha256", value: "7253ab4de971e72fb7be983802300c30b5a7f0c2e56fab8abfc6a214307c0094" },
  ]);
  const uni = cargo().packages.find((p) => p.name === "unicode-ident");
  assert.equal(uni.resolved, "registry+https://github.com/rust-lang/crates.io-index");
  assert.equal(cargo().packages.find((p) => p.name === "proc-macro2").purl, "pkg:cargo/proc-macro2@1.0.86");
});

test("cargo: direct = declared by a workspace member, rest transitive", () => {
  const r = cargo();
  assert.equal(r.packages.find((p) => p.name === "serde").relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "thiserror").relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "syn").relation, "transitive");
});

test("cargo: disambiguated dependency strings (`name version`) split correctly", () => {
  const p = cargo().packages.find((p) => p.name === "serde_derive");
  assert.ok(p.dependencies.some((d) => d.name === "quote" && d.spec === "1.0.36"));
});

test("gosum: module and /go.mod lines fold into one record", () => {
  const r = parseLockfile(fixture("go.sum"), { filename: "go.sum" });
  assert.equal(r.packages.length, 5);
  const errors = r.packages.find((p) => p.name === "github.com/pkg/errors");
  assert.equal(errors.version, "v0.9.1");
  assert.deepEqual(
    errors.integrity.map((i) => i.algorithm),
    ["h1", "h1:go.mod"]
  );
});

test("gosum: golang purls split the module path; relation stays unknown", () => {
  const r = parseLockfile(fixture("go.sum"), { filename: "go.sum" });
  const p = r.packages.find((p) => p.name === "golang.org/x/sys");
  assert.equal(p.purl, "pkg:golang/golang.org/x/sys@v0.21.0");
  // go.sum has no dependency graph to read — anylock never guesses.
  for (const pkg of r.packages) assert.equal(pkg.relation, "unknown");
});

test("gosum: malformed lines raise ParseError with the line number", () => {
  assert.throws(
    () => parseLockfile("github.com/x/y v1.0.0\n", { format: "go-sum" }),
    (e) => e instanceof ParseError && /line 1/.test(e.message)
  );
  assert.throws(
    () => parseLockfile("github.com/x/y 1.0.0 h1:aaa=\n", { format: "go-sum" }),
    (e) => e instanceof ParseError && /does not start with 'v'/.test(e.message)
  );
  assert.throws(() => parseLockfile("# nothing here\n", { format: "go-sum" }), ParseError);
});
