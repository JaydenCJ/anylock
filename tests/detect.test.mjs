// Format detection tests (src/detect.ts): filename routing, the
// yarn classic/Berry split, and pure content sniffing for stdin.
import test from "node:test";
import assert from "node:assert/strict";
import { detectFormat, sniffContent, FORMATS, listFormats } from "../dist/index.js";
import { fixture } from "./helpers.mjs";

test("detect: canonical filenames route without looking at content", () => {
  assert.equal(detectFormat("{}", "some/dir/package-lock.json"), "npm");
  assert.equal(detectFormat("{}", "npm-shrinkwrap.json"), "npm");
  assert.equal(detectFormat("", "a/b/Cargo.lock"), "cargo");
  assert.equal(detectFormat("", "go.sum"), "go-sum");
  assert.equal(detectFormat("", "poetry.lock"), "poetry");
  assert.equal(detectFormat("{}", "Pipfile.lock"), "pipfile");
  assert.equal(detectFormat("", "Gemfile.lock"), "gemfile");
  assert.equal(detectFormat("{}", "composer.lock"), "composer");
  assert.equal(detectFormat("{}", "Package.resolved"), "swiftpm");
  assert.equal(detectFormat("", "pnpm-lock.yaml"), "pnpm");
});

test("detect: yarn.lock splits on content — classic vs Berry", () => {
  assert.equal(detectFormat(fixture("yarn-classic.lock"), "yarn.lock"), "yarn-classic");
  assert.equal(detectFormat(fixture("yarn-berry.lock"), "yarn.lock"), "yarn-berry");
});

test("detect: requirements name variants and Windows-style paths", () => {
  assert.equal(detectFormat("a==1.0", "requirements.txt"), "pip-requirements");
  assert.equal(detectFormat("a==1.0", "requirements-dev.txt"), "pip-requirements");
  assert.equal(detectFormat("a==1.0", "pip/requirements.prod.txt"), "pip-requirements");
  assert.equal(detectFormat("{}", "C:\\proj\\package-lock.json"), "npm");
});

test("sniff: every bundled fixture detects from content alone", () => {
  const cases = [
    ["package-lock.v3.json", "npm"],
    ["package-lock.v1.json", "npm"],
    ["yarn-classic.lock", "yarn-classic"],
    ["yarn-berry.lock", "yarn-berry"],
    ["pnpm-lock.v9.yaml", "pnpm"],
    ["Cargo.lock", "cargo"],
    ["go.sum", "go-sum"],
    ["poetry.lock", "poetry"],
    ["Pipfile.lock", "pipfile"],
    ["requirements.txt", "pip-requirements"],
    ["Gemfile.lock", "gemfile"],
    ["composer.lock", "composer"],
    ["Package.resolved", "swiftpm"],
    ["Package.resolved.v1", "swiftpm"],
  ];
  for (const [file, expected] of cases) {
    assert.equal(sniffContent(fixture(file)), expected, `${file} should sniff as ${expected}`);
  }
});

test("sniff: Cargo vs Poetry disambiguation on shared [[package]] skeleton", () => {
  // Both are TOML with [[package]]; poetry's python-versions is the discriminator.
  assert.equal(sniffContent('[[package]]\nname = "x"\nversion = "1"\nchecksum = "aa"\n'), "cargo");
  assert.equal(
    sniffContent('[[package]]\nname = "x"\nversion = "1"\npython-versions = ">=3.9"\n'),
    "poetry"
  );
});

test("detect: unknown content returns null instead of guessing", () => {
  assert.equal(detectFormat("SELECT * FROM users;", "dump.sql"), null);
  assert.equal(sniffContent('{"random": "json"}'), null);
  assert.equal(sniffContent(""), null);
});

test("formats: exactly twelve, ids unique, every id listed", () => {
  assert.equal(FORMATS.length, 12);
  const ids = FORMATS.map((f) => f.id);
  assert.equal(new Set(ids).size, 12);
  assert.deepEqual(listFormats(), ids);
});
