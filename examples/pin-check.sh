#!/usr/bin/env bash
# pin-check.sh <lockfile…> — fail (exit 1) if any locked package has no
# integrity hash. A copy-paste supply-chain gate built on anylock's NDJSON:
# one record per package, `integrity` always present, so a node one-liner
# is enough (jq works just as well — node is used because anylock already
# requires it).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

MISSING="$(node dist/cli.js --quiet "$@" | node -e '
  let src = "";
  process.stdin.on("data", (d) => (src += d)).on("end", () => {
    for (const line of src.split("\n")) {
      if (line === "") continue;
      const r = JSON.parse(line);
      if (r.integrity.length === 0) console.log(`${r.ecosystem}: ${r.name}@${r.version}`);
    }
  });
')"

if [ -n "$MISSING" ]; then
  echo "packages without integrity hashes:" >&2
  echo "$MISSING" >&2
  exit 1
fi
echo "pin-check: every package carries an integrity hash"
