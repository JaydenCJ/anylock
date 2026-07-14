// Unit tests for purl construction (src/purl.ts) — the type-specific rules
// are the part every ad-hoc implementation gets subtly wrong, so each rule
// from the purl spec that anylock implements is pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPurl, swiftNameFromLocation } from "../dist/index.js";

test("purl: npm — plain names, and scopes as percent-encoded namespaces", () => {
  assert.equal(buildPurl("npm", "lodash", "4.17.21"), "pkg:npm/lodash@4.17.21");
  assert.equal(buildPurl("npm", "@babel/core", "7.24.2"), "pkg:npm/%40babel/core@7.24.2");
});

test("purl: pypi names get PEP 503 normalization (case, _, .)", () => {
  assert.equal(buildPurl("pypi", "Typing_Extensions", "4.12.0"), "pkg:pypi/typing-extensions@4.12.0");
  assert.equal(buildPurl("pypi", "zope.interface", "6.4"), "pkg:pypi/zope-interface@6.4");
});

test("purl: golang and composer paths are lowercased and namespace-split", () => {
  assert.equal(
    buildPurl("golang", "github.com/Azure/azure-sdk-for-go", "v68.0.0"),
    "pkg:golang/github.com/azure/azure-sdk-for-go@v68.0.0"
  );
  assert.equal(buildPurl("composer", "Monolog/Monolog", "3.6.0"), "pkg:composer/monolog/monolog@3.6.0");
});

test("purl: cargo/gem are flat; versions with +build or platform tails survive", () => {
  assert.equal(buildPurl("cargo", "serde", "1.0.203"), "pkg:cargo/serde@1.0.203");
  assert.equal(buildPurl("gem", "nokogiri", "1.16.5"), "pkg:gem/nokogiri@1.16.5");
  assert.equal(buildPurl("npm", "pkg", "1.0.0+build.5"), "pkg:npm/pkg@1.0.0+build.5");
  assert.equal(buildPurl("gem", "nokogiri", "1.16.5-x86_64-linux"), "pkg:gem/nokogiri@1.16.5-x86_64-linux");
});

test("purl: swift uses host + repo path; swiftNameFromLocation derives it", () => {
  assert.equal(
    buildPurl("swift", "github.com/apple/swift-log", "1.5.4"),
    "pkg:swift/github.com/apple/swift-log@1.5.4"
  );
  assert.equal(
    swiftNameFromLocation("https://github.com/apple/swift-nio.git"),
    "github.com/apple/swift-nio"
  );
  assert.equal(swiftNameFromLocation("git@github.com:owner/repo.git"), "github.com/owner/repo");
  assert.equal(swiftNameFromLocation("../local-package"), null); // no fake purl for local paths
});

test("purl: empty or malformed coordinates return null, never a broken purl", () => {
  assert.equal(buildPurl("npm", "", "1.0.0"), null);
  assert.equal(buildPurl("npm", "x", "  "), null);
  assert.equal(buildPurl("npm", "@scope-without-name", "1.0.0"), null);
});
