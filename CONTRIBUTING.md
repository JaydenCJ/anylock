# Contributing to anylock

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and honest about what a
lockfile does and does not say.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/anylock.git
cd anylock
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against fixtures + examples
```

`scripts/smoke.sh` exercises the real CLI (all twelve formats, detect,
stats, stdin, --as, --format json, exit codes, the NDJSON key-order
contract, determinism) and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (every parser is a pure `string -> records` function — only
   the CLI touches the filesystem and process state).
5. Schema changes are additive-only: never remove, rename or reorder an
   output key within schema revision 1. New formats need a fixture, a
   parser test file section, a `docs/formats.md` row and a smoke case.

## Ground rules

- **No runtime dependencies.** The embedded TOML/YAML subset readers
  exist precisely so anylock installs as a single audited package;
  adding a dependency needs justification in the PR and will usually be
  declined.
- No network calls, ever — anylock reads the bytes it is given, then
  prints. That is the whole I/O surface.
- Never guess: when a lockfile does not record directness, hashes or a
  resolvable purl, the record says `unknown` / `[]` / `null`. A wrong
  answer is worse than an honest gap.
- Determinism is a feature: same input bytes, same output bytes. Any
  ordering you introduce must be explicit and total.
- Parser subsets fail loudly: content outside the supported TOML/YAML
  subset must raise `ParseError`, not silently misparse.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `anylock --version` output, the exact command line, and a
minimal lockfile snippet that reproduces the problem (redact registry
URLs if private). If a record looks wrong, say what the package manager
itself reports for that entry — the ecosystem's own tooling is the
tiebreaker.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
