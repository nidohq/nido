# G-account core — authority slice

This is the first implementation slice of `SPEC.md`, not a deployed wallet or
recovery service. It is a dependency-free Rust library intended to be consumed by
the future G-account service and adapter. It has its own Cargo workspace so the
verification toolchain need not resolve unrelated Soroban contracts.

`authority::validate` checks decoded snapshots. `authorization_weight` and
`can_authorize` calculate native quorum authority without double-counting repeated
keys. `rotate` validates the four exact replacement templates and computes their
final authority states without changing inputs or signing anything.

Evidence keys must come from signatures verified against the exact request by an
adapter. `RecoverLocal` checks the S+R coalition only; the future recovery lifecycle
must additionally enforce delay, operator approval, revisions and persistence.
This crate currently supplies neither that lifecycle nor XDR/crypto/ledger
verification. Do not expose `rotate` directly as a recovery signing API.

Run `cargo test --manifest-path crates/g-account-core/Cargo.toml` and the authority
Lusterna campaign. Any generated proofs are evidence only for their stated
functions, revision and assumptions. The crate is not wired into Nido yet.
