# Initial authority verification run

Date: 2026-11-10. Branch: `codex/g-account-authority` in the isolated
`nido-g-account-verification` checkout. The original Nido working tree is untouched.

The first real implementation slice now exists in `crates/g-account-core`.
It is an independently buildable candidate library, not yet connected to the
wallet/service. Recovery lifecycle, policy and fee-budget modules remain absent.
Do not report this campaign as proof of those modules or the deployed wallet.

Authority campaign targets are the production-intended functions in
`src/authority.rs`: `validate`, `authorization_weight`, `can_authorize`, and
`rotate`, with helpers `roles_distinct` and `contains_key`. Public keys in
`evidence` are assumed to have been authenticated by an adapter against the exact
request; no cryptography is implemented here. `rotate` computes a final authority
state and never emits signatures or executes ledger operations. Its RecoverLocal
variant checks S+R authority, not the deferred recovery delay/operator workflow.

This run uses the prepared authority brief and covers G-01..G-04 to the extent
the generated theorems actually establish them. `formal_SPEC.md` documents the
historical research baseline; this run supplies its previously missing authority
target. Preserve all missing-coverage and adapter assumptions in the report.

Validation before verification: seven Rust tests (exhaustive finite coalition,
byte-weight/threshold and mutation cases), Cargo formatting, Clippy with warnings
denied, and release-mode tests. These tests are not formal proofs.

Lusterna is pinned at `3524051e8b0e31caaad135e719eec1d9e6c73c68` and Aeneas at
`0d21a9ec7bbbb110110cacc14464a47fd71c8705`. The operational checkout at
`/Users/willem/c/theahaco/lean-agent` stores the run configuration, logs,
checkpoints and budget ledger. Its credential reference points to 1Password;
the key is never copied into this repository.

The user authorized unattended execution and agent review of intermediate
outputs. The supervising Codex chat reviews inference scope and theorem coverage;
no human approval is required between stages. This does not remove mechanical
proof gates or constitute a mainnet/security approval. Initial spend ceiling is
$50; further spending requires a new allowance. No merging, deployment or
automatic purchase of additional credits is part of this run.
