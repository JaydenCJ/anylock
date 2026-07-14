# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- Twelve lockfile parsers behind one API: npm `package-lock.json` /
  `npm-shrinkwrap.json` (lockfileVersion 1–3), Yarn classic `yarn.lock`
  (v1), Yarn Berry `yarn.lock` (v2+), `pnpm-lock.yaml` (5.x/6.x/9.x),
  `Cargo.lock`, `go.sum`, `poetry.lock` (lock-version 1.x/2.x),
  `Pipfile.lock`, pinned `requirements*.txt`, Bundler `Gemfile.lock`,
  `composer.lock`, and SwiftPM `Package.resolved` (file versions 1–3).
- Normalized record schema (revision 1): fixed key set and key order,
  `(name, version, purl)` sorting, sorted dependency edges, duplicate
  collapsing — byte-stable NDJSON that can be diffed, hashed and cached
  (documented in `docs/schema.md`).
- package-url (purl) construction with the type-specific rules: npm
  scope namespaces, PEP 503 normalization for pypi, lowercased
  namespace-split golang and composer paths, repository-URL-derived
  swift coordinates; `null` instead of a fabricated purl.
- Direct/transitive resolution where the lockfile actually records it
  (npm root entry, pnpm importers, Cargo workspace members, Bundler
  DEPENDENCIES) and an honest `unknown` everywhere else; dev/optional
  scopes from per-format flags.
- Format detection: basename routing, the classic-vs-Berry `yarn.lock`
  content split, and structural content sniffing for stdin/renamed
  files; refuses to guess (`null` + exit 1) when nothing matches.
- Embedded zero-dependency TOML and YAML subset readers that cover
  exactly what Cargo/Poetry/pnpm/Berry emit and raise `ParseError` on
  anything outside the subset.
- CLI: `parse` (default, NDJSON or `--format json`), `detect`, `stats`,
  `formats`, stdin via `-`, `--as` to force a format, `--quiet`;
  warnings on stderr so stdout stays pure NDJSON; exit codes 0 (success)
  / 1 (parse or detect failure) / 2 (usage error).
- Programmatic API (`parseLockfile`, `detectFormat`, `sniffContent`,
  `buildPurl`, `toNdjson`, `listFormats`, the embedded `parseToml` /
  `parseYaml`) with full type declarations.
- Examples: a four-ecosystem `examples/polyglot/` mini-repo and
  `examples/pin-check.sh`, a copy-paste CI gate that fails the build
  when packages ship without integrity hashes.
- Test suite: 90 node:test tests (parser units on 15 realistic fixtures
  plus CLI integration) and an end-to-end `scripts/smoke.sh` covering
  all twelve formats, the schema contract and determinism.

[0.1.0]: https://github.com/JaydenCJ/anylock/releases/tag/v0.1.0
