# Continuation authorized on 2026-11-11

The initial attempt is preserved alongside this note: **0/41 campaign claims
verified**, no counterexample, no authority guarantee. The user authorized
continuation to **$100 total**, including the $44.1328054 already charged, and
pushing the existing work. No merge or account deployment is included.

The next proof attempt reuses the same seed, immutable runtime, six real Rust
targets, generated extraction, and 41 accepted theorem fingerprints. Only proof
completion markers are reopened in a new audited local checkpoint. All original
mechanical gates, assumption accounting and G-01..G-04 scope remain mandatory.
Proof feedback asks for small compiling commits so an unfinished final edit
cannot discard an entire batch of work.

The runner and selected visual evidence are in the private
[theahaco/lean-agent repository](https://github.com/theahaco/lean-agent).
Authentication uses the 1Password CLI, once per worker launch. This published
snapshot precedes the new paid proof attempt; consult a subsequent reviewed
report before making any stronger claim.

## Snapshot layout

This branch includes SPEC.md, formal_SPEC.md, the candidate authority crate,
Lusterna's extracted Lean and accepted statements, proof attempts, and reports.
It is an exported verification workspace, not a merge-ready wallet integration.
The export removes the workspace and example Rust toolchain override files so
the pinned verification container can use its own toolchain. The original Nido
working tree and its toolchain files remain unchanged. The Rust authority crate
itself remains byte-for-byte the original verification seed.

The live local result branch is lusterna/nido-authority-20261110-01. This review
snapshot starts at dad952c775d29d12bc741329f92873ed2a960073 and adds only the saved
initial reports and this continuation note. It does not move the accepted seed
or the live result branch, and does not imply that any of the 41 open proof
bodies is established.
