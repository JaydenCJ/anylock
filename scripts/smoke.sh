#!/usr/bin/env bash
# Smoke test for anylock: exercises the real CLI end to end against the
# bundled fixtures and examples, plus a freshly written temp lockfile.
# No network, idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in parse detect stats formats --as --format "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. formats lists all twelve.
COUNT="$($CLI formats | tail -n +2 | wc -l | tr -d ' ')"
[ "$COUNT" = "12" ] || fail "formats should list 12 formats, got $COUNT"
echo "[smoke] formats ok (12)"

# 4. Usage errors exit 2 (distinct from parse failures' exit 1).
set +e
$CLI --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI parse >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "no files should exit 2"; }
$CLI parse x --as nope >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "bad --as should exit 2"; }
set -e
echo "[smoke] usage errors ok (exit 2)"

# 5. Every bundled fixture parses; detect names the right format.
declare -a CASES=(
  "tests/fixtures/package-lock.v3.json npm 4"
  "tests/fixtures/package-lock.v1.json npm 3"
  "tests/fixtures/yarn-classic.lock yarn-classic 3"
  "tests/fixtures/yarn-berry.lock yarn-berry 2"
  "tests/fixtures/pnpm-lock.v9.yaml pnpm 3"
  "tests/fixtures/pnpm-lock.v6.yaml pnpm 3"
  "tests/fixtures/Cargo.lock cargo 8"
  "tests/fixtures/go.sum go-sum 5"
  "tests/fixtures/poetry.lock poetry 6"
  "tests/fixtures/Pipfile.lock pipfile 3"
  "tests/fixtures/requirements.txt pip-requirements 4"
  "tests/fixtures/Gemfile.lock gemfile 8"
  "tests/fixtures/composer.lock composer 3"
  "tests/fixtures/Package.resolved swiftpm 3"
)
for case in "${CASES[@]}"; do
  read -r file format expected <<<"$case"
  $CLI detect "$file" | grep -q "	$format$" || fail "detect $file != $format"
  GOT="$($CLI --quiet "$file" | wc -l | tr -d ' ')"
  [ "$GOT" = "$expected" ] || fail "$file should yield $expected records, got $GOT"
done
echo "[smoke] all 12 formats detect and parse (14 fixtures)"

# 6. NDJSON contract: every line is JSON with the fixed key order.
$CLI --quiet tests/fixtures/Cargo.lock | node -e '
  let src = "";
  process.stdin.on("data", (d) => (src += d)).on("end", () => {
    const KEYS = "schema,name,version,ecosystem,purl,integrity,resolved,relation,scopes,dependencies,source";
    for (const line of src.trimEnd().split("\n")) {
      const r = JSON.parse(line);
      if (Object.keys(r).join(",") !== KEYS) throw new Error("key order broken");
      if (r.schema !== 1) throw new Error("schema != 1");
    }
  });
' || fail "NDJSON key-order contract broken"
echo "[smoke] NDJSON schema contract ok"

# 7. The polyglot example merges four ecosystems into one stream.
POLY="$($CLI --quiet examples/polyglot/package-lock.json examples/polyglot/Cargo.lock examples/polyglot/go.sum examples/polyglot/requirements.txt)"
[ "$(echo "$POLY" | wc -l | tr -d ' ')" = "5" ] || fail "polyglot should yield 5 records"
for needle in '"pkg:npm/ms@2.1.3"' '"pkg:cargo/itoa@1.0.11"' '"pkg:golang/github.com/google/uuid@v1.6.0"' '"pkg:pypi/httpx@0.27.0"'; do
  echo "$POLY" | grep -qF "$needle" || fail "polyglot output missing $needle"
done
echo "[smoke] polyglot example ok (npm+cargo+golang+pypi)"

# 8. stdin + --as, and --format json round-trips through JSON.parse.
echo "github.com/x/y v1.2.3 h1:Zm9vYmFyCg==" | $CLI parse - --as go-sum | grep -qF '"pkg:golang/github.com/x/y@v1.2.3"' \
  || fail "stdin --as go-sum failed"
$CLI parse tests/fixtures/composer.lock --format json | node -e '
  let s = ""; process.stdin.on("data",(d)=>s+=d).on("end",()=>{const a=JSON.parse(s); if(a.length!==3) throw new Error("bad array")});
' || fail "--format json is not a valid 3-element array"
echo "[smoke] stdin / --format json ok"

# 9. Fresh temp lockfile: write, parse, verify dev scope survives.
cat > "$WORKDIR/package-lock.json" <<'EOF'
{"lockfileVersion": 3, "packages": {"": {"devDependencies": {"tap": "^18.0.0"}},
 "node_modules/tap": {"version": "18.7.2", "dev": true, "integrity": "sha512-dGVsbGFsbGE="}}}
EOF
TMP_OUT="$($CLI "$WORKDIR/package-lock.json")"
echo "$TMP_OUT" | grep -qF '"name":"tap"' || fail "temp lockfile: tap missing"
echo "$TMP_OUT" | grep -qF '"scopes":["dev"]' || fail "temp lockfile: dev scope missing"
echo "$TMP_OUT" | grep -qF '"relation":"direct"' || fail "temp lockfile: relation missing"
echo "[smoke] temp lockfile ok (dev scope, relation)"

# 10. Failure semantics: unparseable content exits 1, stdout still clean.
set +e
printf 'not toml at all [[[' > "$WORKDIR/Cargo.lock"
$CLI "$WORKDIR/Cargo.lock" >"$WORKDIR/out.txt" 2>"$WORKDIR/err.txt"; CODE=$?
set -e
[ "$CODE" -eq 1 ] || fail "broken lockfile should exit 1, got $CODE"
[ ! -s "$WORKDIR/out.txt" ] || fail "broken lockfile should emit no records"
grep -q "anylock:" "$WORKDIR/err.txt" || fail "broken lockfile should explain on stderr"
echo "[smoke] failure semantics ok (exit 1)"

# 11. Determinism: two runs over the same inputs are byte-identical.
$CLI --quiet tests/fixtures/poetry.lock tests/fixtures/Gemfile.lock > "$WORKDIR/run1.txt"
$CLI --quiet tests/fixtures/poetry.lock tests/fixtures/Gemfile.lock > "$WORKDIR/run2.txt"
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
