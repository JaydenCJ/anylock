// Gemfile.lock, composer.lock and Package.resolved parser tests.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLockfile, ParseError } from "../dist/index.js";
import { fixture } from "./helpers.mjs";

const gemfile = () => parseLockfile(fixture("Gemfile.lock"), { filename: "Gemfile.lock" });
const composer = () => parseLockfile(fixture("composer.lock"), { filename: "composer.lock" });

test("gemfile: GEM specs parse, BUNDLED WITH becomes lockfileVersion", () => {
  const r = gemfile();
  assert.equal(r.lockfileVersion, "2.5.10");
  assert.equal(r.packages.length, 8);
});

test("gemfile: DEPENDENCIES decides direct — including bang-suffixed git gems", () => {
  const r = gemfile();
  assert.equal(r.packages.find((p) => p.name === "i18n").relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "minitest").relation, "direct");
  assert.equal(r.packages.find((p) => p.name === "rack").relation, "transitive");
  assert.equal(r.packages.find((p) => p.name === "concurrent-ruby").relation, "transitive");
  // `custom-middleware!` in DEPENDENCIES refers to the GIT-section gem.
  const git = r.packages.find((p) => p.name === "custom-middleware");
  assert.equal(git.relation, "direct");
  // GIT gems resolve to remote#revision
  assert.equal(
    git.resolved,
    "https://github.com/example/custom-middleware.git#5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a"
  );
});

test("gemfile: sub-lines become edges; platform-suffixed versions kept verbatim", () => {
  const i18n = gemfile().packages.find((p) => p.name === "i18n");
  assert.deepEqual(i18n.dependencies, [{ name: "concurrent-ruby", spec: "~> 1.0" }]);
  assert.equal(gemfile().packages.find((p) => p.name === "nokogiri").version, "1.16.5-x86_64-linux");
  // CHECKSUMS section (Bundler >= 2.5) attaches sha256
  assert.deepEqual(gemfile().packages.find((p) => p.name === "concurrent-ruby").integrity, [
    { algorithm: "sha256", value: "82fdd3f8a0816e28d513e637bb2b90a45d7b982bdf4f3a0511722d2e495801e2" },
  ]);
});

test("gemfile: content without Bundler sections raises ParseError", () => {
  assert.throws(() => parseLockfile("just text\n", { format: "gemfile" }), ParseError);
});

test("composer: packages/packages-dev merge; lowercased vendor purls", () => {
  const r = composer();
  assert.equal(r.lockfileVersion, "2.6.0");
  assert.deepEqual(
    r.packages.map((p) => [p.name, p.scopes.join(",")]),
    [["monolog/monolog", ""], ["phpunit/phpunit", "dev"], ["psr/log", ""]]
  );
  assert.equal(r.packages[0].purl, "pkg:composer/monolog/monolog@3.6.0");
});

test("composer: dist url/shasum recorded; empty shasum means no integrity", () => {
  const monolog = composer().packages.find((p) => p.name === "monolog/monolog");
  assert.match(monolog.resolved, /^https:\/\/api\.github\.com\/repos\/Seldaek\/monolog/);
  assert.deepEqual(monolog.integrity, [
    { algorithm: "sha1", value: "3a91b3c9a0f04d5db94e4d5b184843870d8f9c53" },
  ]);
  assert.deepEqual(composer().packages.find((p) => p.name === "psr/log").integrity, []);
});

test("composer: platform requirements (php, ext-*) are not dependencies", () => {
  const p = composer().packages.find((p) => p.name === "phpunit/phpunit");
  assert.deepEqual(p.dependencies, [{ name: "myclabs/deep-copy", spec: "^1.11" }]);
});

test("swiftpm v3: url-derived names, git-revision integrity, branch pins", () => {
  const r = parseLockfile(fixture("Package.resolved"), { filename: "Package.resolved" });
  assert.equal(r.lockfileVersion, "3");
  const p = r.packages.find((p) => p.name === "github.com/apple/swift-argument-parser");
  assert.equal(p.version, "1.3.1");
  assert.equal(p.purl, "pkg:swift/github.com/apple/swift-argument-parser@1.3.1");
  assert.deepEqual(p.integrity, [
    { algorithm: "git-revision", value: "46989693916f56d1186bd59ac15124caef896560" },
  ]);
  // a branch pin has no version — the commit is the only exact identity
  const nio = r.packages.find((p) => p.name === "github.com/apple/swift-nio");
  assert.equal(nio.version, "9b2848d76f5caafb140e386b0d1352b63aa073af");
});

test("swiftpm v1: legacy object.pins layout parses", () => {
  const r = parseLockfile(fixture("Package.resolved.v1"), { format: "swiftpm" });
  assert.equal(r.lockfileVersion, "1");
  assert.equal(r.packages.length, 1);
  assert.equal(r.packages[0].name, "github.com/Alamofire/Alamofire");
  assert.equal(r.packages[0].version, "5.9.1");
});

test("swiftpm: JSON without pins raises ParseError", () => {
  assert.throws(
    () => parseLockfile('{"version": 2}', { format: "swiftpm" }),
    (e) => e instanceof ParseError && /pins/.test(e.message)
  );
});
