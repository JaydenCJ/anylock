# anylock examples

## `polyglot/` — one repo, four ecosystems

A miniature monorepo with an npm `package-lock.json`, a `Cargo.lock`, a
`go.sum` and a pinned `requirements.txt`. Parse them all into one stream:

```bash
node dist/cli.js examples/polyglot/package-lock.json \
                 examples/polyglot/Cargo.lock \
                 examples/polyglot/go.sum \
                 examples/polyglot/requirements.txt
```

Every line is one package in the same schema, whatever the source format —
pipe it straight into `jq`:

```bash
# every purl in the whole repository
node dist/cli.js examples/polyglot/* | jq -r .purl

# only packages with no recorded integrity hash
node dist/cli.js examples/polyglot/* | jq -r 'select(.integrity == []) | .name'
```

## `pin-check.sh` — a copy-paste CI gate

Fails the build when a lockfile contains packages without integrity
hashes (a common supply-chain review requirement):

```bash
bash examples/pin-check.sh examples/polyglot/package-lock.json
```

Exit code 0 when every package carries a hash, 1 otherwise, with the
offending names on stderr. See the script for the pattern: `anylock`
piped through a node one-liner (jq works just as well).
