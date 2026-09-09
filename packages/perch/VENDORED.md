# Vendored: @stellar-registry/perch

This package is a **verbatim vendored copy** of perch's TypeScript surface,
pinned to an exact upstream revision. Do not edit `src/` or `testdata/` here —
fix upstream and re-vendor.

| | |
|---|---|
| Upstream repo | <https://github.com/stellar-registry/perch> |
| Subdirectory | `packages/perch-js` (sources), `testdata/` (golden vectors) |
| Pinned revision | `f5676a6cfb7ae02e9ae487be18cf6247653124b0` |

## Why vendored instead of a git dependency

`@stellar-registry/perch` is not on npm yet, and npm cannot install a git
dependency that lives in a subdirectory of its repo (the perch repo root is a
Rust workspace with no `package.json`). Vendoring the package at a pinned rev
into this npm workspace is the closest workspace-compatible equivalent of a
pinned git dependency: `@nidohq/passkey-sdk` depends on the final package name,
so imports never change when the swap below happens.

## TODO: swap to the npm release (perch-publish-p1)

The upstream task `perch-publish-p1` (branch `chore/publish-perch-js`) is
making `@stellar-registry/perch` npm-publishable. Once it is published:

1. Delete this directory (`packages/perch/`).
2. In `packages/passkey-sdk/package.json`, change
   `"@stellar-registry/perch": "^0.1.0"` to the published version.
3. Remove `-w @stellar-registry/perch` from the root `build:packages` script.
4. Re-point the doc-hash parity tests' `testdata/` path if the published
   package does not ship the golden vectors (they currently live only in the
   upstream repo's `testdata/`; the copies here are the frozen CANON v1
   vectors, safe to keep as local fixtures).

## Local deltas vs upstream

- `package.json` / `tsconfig.json` are nido-authored (upstream's package is
  `"private": true` with no build; this copy compiles to `dist/` so
  `tsc`-built consumers can resolve declarations). Kept `private: true` so
  nido's npm-publish workflow can never publish it.
- Upstream's `test/` suite is not vendored (it reads `../../../testdata`);
  parity against the vendored golden vectors is covered by
  `@nidohq/passkey-sdk`'s policyDoc tests instead.
- `testdata/` holds the frozen doc-hash vectors (`ci-publish*`) and
  `testdata/golden/` the wire-format vectors (`manifest.json` + `*.xdr`,
  lowercase-hex XDR bytes), copied verbatim from the same revision.
