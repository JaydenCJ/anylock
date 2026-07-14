// Unit tests for the embedded YAML subset reader (src/yaml.ts).
// Scope = exactly what pnpm-lock.yaml and Yarn Berry lockfiles contain;
// anything outside that subset (anchors, block scalars) must throw.
import test from "node:test";
import assert from "node:assert/strict";
import { parseYaml, ParseError } from "../dist/index.js";

test("yaml: nested block mappings by indentation", () => {
  const doc = parseYaml("a:\n  b:\n    c: 1\n  d: two\n");
  assert.equal(doc.a.b.c, 1);
  assert.equal(doc.a.d, "two");
});

test("yaml: plain scalars coerce, quoted scalars never do", () => {
  const doc = parseYaml("t: true\nf: false\nn: null\ni: 42\nfl: 1.5\ns: hello world\n");
  assert.equal(doc.t, true);
  assert.equal(doc.f, false);
  assert.equal(doc.n, null);
  assert.equal(doc.i, 42);
  assert.equal(doc.fl, 1.5);
  assert.equal(doc.s, "hello world");
  const quoted = parseYaml("v: '9.0'\nw: \"true\"\n");
  assert.equal(quoted.v, "9.0"); // pnpm's lockfileVersion must stay a string
  assert.equal(quoted.w, "true");
});

test("yaml: lockfile-style keys — Berry quoted descriptors, pnpm @/keys", () => {
  const berry = parseYaml('"lodash@npm:^4.17.20, lodash@npm:^4.17.21":\n  version: 4.17.21\n');
  assert.equal(berry["lodash@npm:^4.17.20, lodash@npm:^4.17.21"].version, "4.17.21");
  const pnpm = parseYaml("packages:\n  '@babel/core@7.24.0':\n    x: 1\n  debug@4.3.4:\n    y: 2\n");
  assert.equal(pnpm.packages["@babel/core@7.24.0"].x, 1);
  assert.equal(pnpm.packages["debug@4.3.4"].y, 2);
});

test("yaml: flow mappings (incl. empty {}), flow and block sequences", () => {
  const doc = parseYaml(
    "resolution: {integrity: sha512-abc+def/ghi==, tarball: https://example.test/x.tgz}\n" +
      "snapshots:\n  ms@2.1.2: {}\nflow: [a, b, 3]\nblock:\n  - supports-color\n  - chalk\n"
  );
  assert.equal(doc.resolution.integrity, "sha512-abc+def/ghi==");
  assert.equal(doc.resolution.tarball, "https://example.test/x.tgz");
  assert.deepEqual({ ...doc.snapshots["ms@2.1.2"] }, {});
  assert.deepEqual(doc.flow, ["a", "b", 3]);
  assert.deepEqual(doc.block, ["supports-color", "chalk"]);
});

test("yaml: comments stripped, but not inside quotes; '' escapes a quote", () => {
  const doc = parseYaml("# header\n\na: 1 # trailing\n\n# middle\nb: 2\n");
  assert.equal(doc.a, 1);
  assert.equal(doc.b, 2);
  const hash = parseYaml("url: 'https://example.test/repo#main'\n");
  assert.equal(hash.url, "https://example.test/repo#main");
  const sq = parseYaml("s: 'it''s locked'\n");
  assert.equal(sq.s, "it's locked");
});

test("yaml: out-of-subset constructs raise ParseError, never misparse", () => {
  assert.throws(() => parseYaml("a:\n\tb: 1\n"), ParseError); // tab indentation
  assert.throws(() => parseYaml("a: &anchor 1\n"), ParseError); // anchor
  assert.throws(() => parseYaml("a: |\n  text\n"), ParseError); // block scalar
  assert.throws(() => parseYaml("a:\n  b: 1\n    c: 2\n"), ParseError); // bad indent
});
