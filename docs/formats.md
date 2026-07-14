# Supported lockfile formats

Twelve formats, seven ecosystems, one output schema. "Version marker"
is what lands in `source.lockfileVersion`.

| Format id | File | Versions handled | Version marker | Directness | Hashes |
|---|---|---|---|---|---|
| `npm` | `package-lock.json`, `npm-shrinkwrap.json` | lockfileVersion 1, 2, 3 | `lockfileVersion` | yes (root entry / depth) | SRI |
| `yarn-classic` | `yarn.lock` | v1 | `1` | no | SRI |
| `yarn-berry` | `yarn.lock` | v2+ (`__metadata`) | `__metadata.version` | no | checksum (sha512) |
| `pnpm` | `pnpm-lock.yaml` | 5.x, 6.x, 9.x | `lockfileVersion` | yes (importers) | SRI |
| `cargo` | `Cargo.lock` | v1–v4 | `version` | yes (workspace members) | sha256 |
| `go-sum` | `go.sum` | all | — | no | h1 dirhash |
| `poetry` | `poetry.lock` | lock-version 1.x, 2.x | `metadata.lock-version` | no | sha256 per file |
| `pipfile` | `Pipfile.lock` | pipfile-spec 6 | `_meta.pipfile-spec` | no | sha256 |
| `pip-requirements` | `requirements*.txt` | pinned (`==`) lines only | — | no | `--hash` values |
| `gemfile` | `Gemfile.lock`, `gems.locked` | Bundler 1.x–2.x | `BUNDLED WITH` | yes (DEPENDENCIES) | CHECKSUMS (≥2.5) |
| `composer` | `composer.lock` | Composer 2.x | `plugin-api-version` | no | dist shasum (sha1) |
| `swiftpm` | `Package.resolved` | file version 1, 2, 3 | `version` | no | pinned revision |

## Detection

`detectFormat(content, filename)` routes on the basename first — a file
named `Cargo.lock` is Cargo's, full stop. Two names need content:

- **`yarn.lock`** — a `__metadata:` block means Berry; otherwise classic v1.
- **no recognized name / stdin** — `sniffContent` looks for structural
  markers unique to each format (the npm `lockfileVersion` + `packages`
  pair, `[[package]]` with vs without `python-versions`, go.sum's
  three-column `h1:` lines, Bundler's `GEM`/`specs:` skeleton, …).

When nothing matches, detection returns `null` and the CLI exits 1 —
anylock refuses to guess. Force a format with `--as <id>` (CLI) or
`{ format }` (API).

## Deliberate exclusions in 0.1.0

- **Unpinned requirements lines** (`flask>=2.0`, `-e .`, `-r other.txt`)
  are warnings, not records — a range is not a lock.
- **Workspace/root packages** (npm `""` entry and `link: true` twins,
  Berry `workspace:` resolutions, Cargo entries without `source`) are the
  project itself, not dependencies, and are excluded.
- **Peer-dependency suffixes** in pnpm keys (`foo@1.0.0(react@18.2.0)`,
  v5's `_react@16.0.0`) identify instantiations, not packages; they are
  stripped for identity.
- **`bun.lock`, `uv.lock`, `gradle.lockfile`, `mix.lock`** — planned;
  see the roadmap in the README.
