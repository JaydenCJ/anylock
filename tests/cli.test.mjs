// End-to-end CLI tests against the compiled dist/cli.js — commands, exit
// codes, stdout purity, stdin, and multi-file behavior. Everything runs
// against bundled fixtures; no network, no temp state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLI, fixturePath } from "./helpers.mjs";

function run(args, input) {
  const res = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    input: input ?? "",
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("cli: --version matches package.json; --help documents the surface", () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
  );
  const v = run(["--version"]);
  assert.equal(v.code, 0);
  assert.equal(v.stdout.trim(), pkg.version);
  const h = run(["--help"]);
  assert.equal(h.code, 0);
  for (const word of ["parse", "detect", "stats", "formats", "--as", "--format", "Exit codes"]) {
    assert.ok(h.stdout.includes(word), `help should mention ${word}`);
  }
});

test("cli: default command parses a lockfile to NDJSON on stdout", () => {
  const r = run([fixturePath("Cargo.lock")]);
  assert.equal(r.code, 0);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 8);
  const first = JSON.parse(lines[0]);
  assert.equal(first.ecosystem, "cargo");
  assert.equal(first.schema, 1);
});

test("cli: multiple files concatenate into one NDJSON stream", () => {
  const r = run([fixturePath("go.sum"), fixturePath("composer.lock")]);
  assert.equal(r.code, 0);
  const records = r.stdout.trimEnd().split("\n").map((l) => JSON.parse(l));
  assert.equal(records.length, 5 + 3);
  const ecosystems = new Set(records.map((x) => x.ecosystem));
  assert.deepEqual([...ecosystems].sort(), ["composer", "golang"]);
});

test("cli: --format json emits one valid JSON array", () => {
  const r = run(["parse", fixturePath("Package.resolved"), "--format", "json"]);
  assert.equal(r.code, 0);
  const arr = JSON.parse(r.stdout);
  assert.equal(arr.length, 3);
  assert.equal(arr[0].ecosystem, "swift");
});

test("cli: warnings go to stderr (stdout stays pure NDJSON); --quiet silences them", () => {
  const r = run([fixturePath("Pipfile.lock")]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /sqlalchemy/);
  for (const line of r.stdout.trimEnd().split("\n")) JSON.parse(line);
  const q = run(["--quiet", fixturePath("Pipfile.lock")]);
  assert.equal(q.code, 0);
  assert.equal(q.stderr, "");
});

test("cli: stdin via `-` with content sniffing", () => {
  const yarn = readFileSync(fixturePath("yarn-classic.lock"), "utf8");
  const r = run(["parse", "-"], yarn);
  assert.equal(r.code, 0);
  const records = r.stdout.trimEnd().split("\n").map((l) => JSON.parse(l));
  assert.equal(records.length, 3);
  assert.equal(records[0].source.format, "yarn-classic");
  assert.equal(records[0].source.path, "");
});

test("cli: --as forces a format for ambiguous stdin", () => {
  const r = run(["parse", "-", "--as", "go-sum"], "github.com/x/y v1.0.0 h1:Zm9vYmFyCg==\n");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /"pkg:golang\/github.com\/x\/y@v1.0.0"/);
});

test("cli: detect prints file<TAB>format; unknown reports and exits 1", () => {
  const ok = run(["detect", fixturePath("poetry.lock"), fixturePath("Gemfile.lock")]);
  assert.equal(ok.code, 0);
  const lines = ok.stdout.trimEnd().split("\n");
  assert.match(lines[0], /poetry\.lock\tpoetry$/);
  assert.match(lines[1], /Gemfile\.lock\tgemfile$/);
  const unk = run(["detect", "-"], "not a lockfile at all");
  assert.equal(unk.code, 1);
  assert.match(unk.stdout, /\tunknown$/m);
});

test("cli: stats prints per-file counts; formats lists all twelve", () => {
  const s = run(["stats", fixturePath("pnpm-lock.v9.yaml")]);
  assert.equal(s.code, 0);
  assert.match(s.stdout, /pnpm\tnpm\t3 packages/);
  // Singular counts read "1 package", not "1 packages".
  const one = run(["stats", fileURLToPath(new URL("../examples/polyglot/Cargo.lock", import.meta.url))]);
  assert.equal(one.code, 0);
  assert.match(one.stdout, /cargo\tcargo\t1 package$/m);
  const f = run(["formats"]);
  assert.equal(f.code, 0);
  const body = f.stdout.trimEnd().split("\n").slice(1);
  assert.equal(body.length, 12);
  assert.match(f.stdout, /swiftpm/);
  assert.match(f.stdout, /go-sum/);
});

test("cli: failures exit 1 — unreadable file (others still parse) and bad content", () => {
  const r = run([fixturePath("go.sum"), "/does/not/exist.lock"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /cannot read/);
  assert.equal(r.stdout.trimEnd().split("\n").length, 5); // go.sum records still emitted
  const bad = run(["parse", "-", "--as", "cargo"], "definitely not toml [[[");
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /anylock: -:/);
});

test("cli: usage errors exit 2; repeat runs stay byte-identical", () => {
  assert.equal(run(["--frobnicate"]).code, 2);
  assert.equal(run(["parse", "x", "--as", "nope"]).code, 2);
  assert.equal(run(["parse", "x", "--format", "xml"]).code, 2);
  assert.equal(run(["parse"]).code, 2);
  // and repeat runs over the same inputs stay byte-identical
  const args = [fixturePath("package-lock.v3.json"), fixturePath("poetry.lock")];
  assert.equal(run(args).stdout, run(args).stdout);
});
