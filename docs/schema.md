# The anylock record schema (revision 1)

anylock emits one NDJSON line per locked package. The line is a JSON
object with a **fixed key set and a fixed key order** — both are part of
the public contract, so downstream tools may diff, hash and cache the
output byte-for-byte. Fields are additive-only across minor versions; a
breaking change bumps the `schema` number.

## Fields, in serialization order

| Key | Type | Meaning |
|---|---|---|
| `schema` | `1` | Record schema revision. Gate on this before anything else. |
| `name` | string | Ecosystem-native package name (`@scope/pkg`, `vendor/pkg`, a Go module path, …). |
| `version` | string | Locked version, verbatim from the lockfile (leading `v` for Go/Composer tags is preserved). |
| `ecosystem` | string | One of `npm`, `cargo`, `golang`, `pypi`, `gem`, `composer`, `swift`. Doubles as the purl type. |
| `purl` | string \| null | [package-url](https://github.com/package-url/purl-spec) computed with the type-specific rules below, or `null` when one cannot be formed honestly. |
| `integrity` | array | Zero or more `{algorithm, value}` hashes, digest bytes verbatim (never re-encoded). |
| `resolved` | string \| null | Resolution URL / registry source / repository location, when the lockfile records one. |
| `relation` | string | `direct`, `transitive`, or `unknown` (see below). |
| `scopes` | array | Subset of `["dev", "optional", "peer"]` as flagged by the lockfile itself. |
| `dependencies` | array | `{name, spec}` edges as declared, sorted by name. Empty for graph-less formats. |
| `source` | object | `{format, path, lockfileVersion}` — which parser, which file, which lockfile revision. |

## Honesty rules

Three fields are allowed to say "I don't know", and do:

- **`relation: "unknown"`** — go.sum, yarn.lock (both variants),
  Package.resolved, composer.lock, poetry.lock, Pipfile.lock and pinned
  requirements files do not record which packages the project asked for
  directly. anylock never reconstructs that from heuristics.
- **`purl: null`** — a SwiftPM pin at a local path, or a package whose
  coordinates are structurally incomplete, gets no fabricated purl.
- **`integrity: []`** — formats or entries without hashes report none.
  (`examples/pin-check.sh` shows how to gate on this.)

## Integrity algorithms

The `algorithm` is taken from the source format:

| Value | Emitted by | Notes |
|---|---|---|
| `sha512`, `sha1` | npm, yarn, pnpm | from SRI strings; Berry checksums are sha512 with the cache-key prefix stripped |
| `sha256` | Cargo, Poetry, Pipenv, pip, Bundler | hex digests, verbatim |
| `h1` | go.sum | Go dirhash of the module tree (base64) |
| `h1:go.mod` | go.sum | dirhash of the module's go.mod only — folded into the same record, not a phantom package |
| `git-revision` | SwiftPM | the pinned commit; it is exactly what SwiftPM verifies on fetch |

## purl construction rules implemented

- **npm** — `@scope` becomes the namespace, percent-encoded (`pkg:npm/%40babel/core@7.24.2`).
- **pypi** — names are PEP 503-normalized: lowercased, runs of `-_.` collapse to `-`.
- **golang** — module path lowercased; last segment is the name, the rest the namespace.
- **composer** — `vendor/name` lowercased into namespace/name.
- **swift** — repository URL host + path (`.git` stripped) becomes namespace/name.
- **cargo / gem** — flat `name@version`.

## Determinism contract

For the same input bytes and the same anylock version: records are sorted
by `(name, version, purl)`, dependency lists by name, duplicate
`(name, version)` pairs are collapsed to one record, and serialization is
key-ordered. Two runs produce identical bytes — `scripts/smoke.sh`
asserts this with `cmp`.
