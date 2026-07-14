// Unit tests for the embedded TOML subset reader (src/toml.ts).
// The reader only needs to be perfect for machine-written lockfiles, so the
// cases below mirror the constructs Cargo and Poetry actually emit — plus
// the malformed inputs that must fail loudly instead of misparsing.
import test from "node:test";
import assert from "node:assert/strict";
import { parseToml, ParseError } from "../dist/index.js";

test("toml: top-level key-value pairs of every scalar type", () => {
  const doc = parseToml('a = "text"\nb = 42\nc = true\nd = false\ne = 1.5\n');
  assert.deepEqual({ ...doc }, { a: "text", b: 42, c: true, d: false, e: 1.5 });
});

test("toml: [table] and [[array-of-tables]] headers build the tree", () => {
  const doc = parseToml(
    '[metadata]\nlock-version = "2.0"\n[metadata.extra]\nx = 1\n[[package]]\nname = "a"\n\n[[package]]\nname = "b"\n'
  );
  assert.equal(doc.metadata["lock-version"], "2.0");
  assert.equal(doc.metadata.extra.x, 1);
  assert.equal(doc.package.length, 2);
  assert.equal(doc.package[0].name, "a");
  assert.equal(doc.package[1].name, "b");
});

test("toml: [package.dependencies] attaches to the LAST [[package]] element", () => {
  // This is the construct poetry.lock relies on; getting it wrong would
  // silently glue every package's deps onto the first entry.
  const doc = parseToml(
    '[[package]]\nname = "a"\n[[package]]\nname = "b"\n[package.dependencies]\nurllib3 = ">=1.21"\n'
  );
  assert.equal(doc.package[0].dependencies, undefined);
  assert.equal(doc.package[1].dependencies.urllib3, ">=1.21");
});

test("toml: multi-line arrays, trailing commas, comments, inline tables", () => {
  const doc = parseToml(
    'deps = [\n "a", # first\n "b",\n]\nfiles = [\n    {file = "x.whl", hash = "sha256:abc"},\n    {file = "x.tar.gz", hash = "sha256:def"},\n]\n'
  );
  assert.deepEqual(doc.deps, ["a", "b"]);
  assert.equal(doc.files.length, 2);
  assert.equal(doc.files[1].hash, "sha256:def");
});

test("toml: string forms — escapes, literal backslashes, quoted keys", () => {
  const basic = parseToml('s = "he said \\"hi\\" \\u00e9"\n');
  assert.equal(basic.s, 'he said "hi" é');
  const literal = parseToml("p = 'C:\\registry\\index'\n");
  assert.equal(literal.p, "C:\\registry\\index");
  const quotedKey = parseToml('[metadata.files]\n"typing extensions" = []\n');
  assert.deepEqual(quotedKey.metadata.files["typing extensions"], []);
});

test("toml: malformed input raises ParseError instead of guessing", () => {
  // unterminated string — with a line number
  assert.throws(() => parseToml('a = "oops\n'), (e) => e instanceof ParseError && /line 1/.test(e.message));
  // unsupported bare value (a date)
  assert.throws(() => parseToml("d = 2026-07-13\n"), ParseError);
  // key with no '='
  assert.throws(() => parseToml("just-a-key\n"), ParseError);
});
