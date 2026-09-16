# Perch golden test vectors (frozen)

Copied verbatim from <https://github.com/stellar-registry/perch> `testdata/`
at rev `f5676a6cfb7ae02e9ae487be18cf6247653124b0` (the published
`@stellar-registry/perch` npm package ships only `dist/`, not these vectors).

- `ci-publish*.{json,canonical.json,doc-hash}` — CANON v1 doc-hash parity
  pairs; a change here is an upstream canonical-form break requiring a
  `CANON_VERSION` bump, so these are safe to keep as frozen local fixtures.
- `golden/` — wire-format vectors (`manifest.json` + lowercase-hex XDR bytes)
  pinning the `#[contracttype]` encodings of interpreter programs and OZ
  policy install params.

Used by `parity.test.ts`, `lower.test.ts`, and `params.test.ts`. Do not edit;
re-copy from upstream if perch ever re-blesses them.
