// Python-ecosystem parser tests: poetry.lock, Pipfile.lock and pinned
// requirements.txt — three very different files that must land in the
// same normalized shape.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLockfile, ParseError } from "../dist/index.js";
import { fixture } from "./helpers.mjs";

const poetry = () => parseLockfile(fixture("poetry.lock"), { filename: "poetry.lock" });

test("poetry: all packages, lock-version from [metadata], pypi ecosystem", () => {
  const r = poetry();
  assert.equal(r.lockfileVersion, "2.0");
  assert.equal(r.packages.length, 6);
  assert.equal(r.ecosystem, "pypi");
});

test("poetry: file hashes split per package; purls PEP 503 normalized", () => {
  const certifi = poetry().packages.find((p) => p.name === "certifi");
  assert.equal(certifi.integrity.length, 2);
  assert.equal(certifi.integrity[0].algorithm, "sha256");
  const cn = poetry().packages.find((p) => p.name === "charset-normalizer");
  assert.equal(cn.purl, "pkg:pypi/charset-normalizer@3.3.2");
});

test("poetry: [package.dependencies] handles string, table and multi-constraint", () => {
  const req = poetry().packages.find((p) => p.name === "requests");
  assert.deepEqual(req.dependencies, [
    { name: "certifi", spec: ">=2017.4.17" },
    { name: "charset-normalizer", spec: ">=2,<4" },
    { name: "idna", spec: ">=2.5,<4" },
    { name: "urllib3", spec: ">=1.21.1,<3" },
  ]);
  const pytest = poetry().packages.find((p) => p.name === "pytest");
  // pluggy is declared via an inline table with markers
  assert.ok(pytest.dependencies.some((d) => d.name === "pluggy" && d.spec === ">=1.5,<2.0"));
});

test("poetry: legacy `category = \"dev\"` maps to the dev scope", () => {
  assert.deepEqual(poetry().packages.find((p) => p.name === "pytest").scopes, ["dev"]);
  assert.deepEqual(poetry().packages.find((p) => p.name === "requests").scopes, []);
});

test("pipfile: default/develop merge with dev scopes and pipfile-spec version", () => {
  const r = parseLockfile(fixture("Pipfile.lock"), { filename: "Pipfile.lock" });
  assert.equal(r.lockfileVersion, "6");
  assert.deepEqual(
    r.packages.map((p) => [p.name, p.scopes.join(",")]),
    [["black", "dev"], ["click", ""], ["flask", ""]]
  );
});

test("pipfile: `==` stripped, hashes kept, unpinned entries warned and skipped", () => {
  const r = parseLockfile(fixture("Pipfile.lock"), { filename: "Pipfile.lock" });
  assert.equal(r.packages.find((p) => p.name === "flask").version, "3.0.3");
  assert.ok(r.packages.every((p) => p.name !== "sqlalchemy"));
  assert.ok(r.warnings.some((w) => /sqlalchemy/.test(w.message)));
  const click = r.packages.find((p) => p.name === "click");
  assert.equal(click.integrity.length, 2);
  assert.equal(click.integrity[0].algorithm, "sha256");
});

test("requirements: pins with hash continuations; extras and markers stripped", () => {
  const r = parseLockfile(fixture("requirements.txt"), { filename: "requirements.txt" });
  assert.deepEqual(
    r.packages.map((p) => `${p.name}@${p.version}`),
    ["certifi@2024.6.2", "charset-normalizer@3.3.2", "requests@2.32.3", "urllib3@2.2.1"]
  );
  assert.equal(r.packages.find((p) => p.name === "certifi").integrity.length, 2);
  // requests[socks] parses as requests; urllib3's `; python_version` marker is dropped
  assert.ok(r.packages.find((p) => p.name === "requests"));
  assert.equal(r.packages.find((p) => p.name === "urllib3").version, "2.2.1");
});

test("requirements: ranges, editables and -r lines warn instead of pinning", () => {
  const content = "flask>=2.0\n-r base.txt\n-e ./local\npkg==1.0.0\n";
  const r = parseLockfile(content, { filename: "requirements.txt" });
  assert.deepEqual(r.packages.map((p) => p.name), ["pkg"]);
  assert.equal(r.warnings.length, 3);
});

test("requirements: duplicates keep the first; comment-only files raise", () => {
  const r = parseLockfile("a==1.0\na==1.0\n", { filename: "requirements.txt" });
  assert.equal(r.packages.length, 1);
  assert.ok(r.warnings.some((w) => /duplicate/.test(w.message)));
  assert.throws(
    () => parseLockfile("# only comments\n\n", { filename: "requirements.txt" }),
    ParseError
  );
});
