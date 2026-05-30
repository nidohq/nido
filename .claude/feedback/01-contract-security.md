# Contract Security Reviewers (1-15)

## Reviewer 1 — Soroban Security Auditor
**Severity: CRITICAL** — `extend_ttl` is fully permissionless. Anyone can keep any name alive forever, defeating TTL-based reclamation. An attacker calls `extend_ttl("alice")` in a loop and the original owner can never let it expire. Add `owner.require_auth()` or restrict to owner-only.

## Reviewer 2 — Smart Contract Exploit Researcher
**Severity: HIGH** — No events emitted on any state change. `register`, `release`, `transfer` all silently mutate storage. This makes on-chain auditing impossible. You cannot detect squatting campaigns, suspicious transfers, or anomalous registration patterns without events. Add `env.events().publish(...)` for all mutations.

## Reviewer 3 — Formal Verification Specialist
**Severity: MEDIUM** — The bidirectional map invariant (names↔owners is always 1:1) is maintained by convention, not enforcement. In `transfer`, there's a transient state between `registry.owners.remove(owner)` (line 78) and `registry.owners.set(new_owner, &name)` (line 79) where the forward map points to `new_owner` but the reverse map doesn't have `new_owner`. Soroban atomicity prevents observation, but a formal proof should verify this.

## Reviewer 4 — DeFi Protocol Security Lead
**Severity: HIGH** — No reentrancy guard. While Soroban doesn't have the same reentrancy model as EVM, the `require_auth()` pattern means the smart account's `__check_auth` runs during registration. If a malicious smart account's `__check_auth` calls back into the registry, it could observe intermediate state. Verify that Soroban prevents this.

## Reviewer 5 — Cryptographic Protocol Reviewer
**Severity: LOW** — Name validation uses `is_ascii_lowercase()` and `is_ascii_digit()` which are sound. However, the 15-byte stack buffer `let mut buf = [0u8; 15]` with `copy_into_slice` could panic if `name.len()` returns a value > 15 after the assert. The assert should guarantee this, but a debug_assert would be safer.

## Reviewer 6 — Stellar Core Developer
**Severity: MEDIUM** — The `PersistentMap` from `soroban-sdk-tools` (a third-party crate pinned to a git rev by an individual developer) is used for all storage. If this crate has a bug in key serialization, both maps could collide or corrupt. Consider using `soroban-sdk`'s native storage directly for such a critical contract.

## Reviewer 7 — Smart Contract Upgrade Specialist
**Severity: MEDIUM** — No upgrade mechanism. If a vulnerability is found post-deployment, the contract cannot be patched. No admin address, no proxy pattern, no governance. Every registered name is permanently locked to this implementation.

## Reviewer 8 — Gas Optimization Specialist
**Severity: LOW** — `Registry::new(e)` is called in every function, creating a fresh struct each time. For `resolve()` and `lookup()` (read-only), this is wasteful. Consider caching or using static dispatch.

## Reviewer 9 — Storage Economics Researcher
**Severity: MEDIUM** — Each name costs 2 storage entries (forward + reverse). With 518,400 ledger TTL (~30 days at 5s/block), the storage rent for 10,000 names could be significant. No economic model exists to cover these costs. Who pays for extend_ttl? The permissionless design means anyone pays, but no one is incentivized to.

## Reviewer 10 — Soroban Footprint Analyst
**Severity: LOW** — The contract WASM is only 2,546 bytes (excellent). But the `extend_ttl` function reads both maps to find the owner, then extends both entries. This doubles the read footprint unnecessarily — could extend the name entry only and let the owner entry expire naturally (if reverse lookup is optional).

## Reviewer 11 — Access Control Specialist
**Severity: HIGH** — No admin role. Cannot: pause contract in emergency, blacklist squatted names, force-release offensive names, adjust TTL constants. This is acceptable for a fully decentralized protocol but problematic for a young project that may need operational control.

## Reviewer 12 — State Machine Correctness Reviewer
**Severity: LOW** — `transfer` requires both `owner.require_auth()` and `new_owner.require_auth()`. This is correct for preventing unauthorized transfers, but it means a transfer requires two parties to coordinate a single atomic transaction. Consider a two-step claim pattern (offer/accept) for better UX.

## Reviewer 13 — Error Handling Specialist
**Severity: LOW** — All errors use `assert!` with string messages that get wrapped in Soroban's `HostError`. No custom error enum. This means callers can't programmatically distinguish error types (e.g., "name taken" vs "owner has name" vs "validation failed"). Use `#[contracterror]` for typed errors.

## Reviewer 14 — Namespace Collision Researcher
**Severity: MEDIUM** — Names are globally unique within this contract but there's no cross-contract namespace. If another name registry contract is deployed, names could collide across registries, confusing users. Consider adding a namespace prefix or on-chain registry-of-registries.

## Reviewer 15 — Test Coverage Analyst
**Severity: HIGH** — `extend_ttl` is completely untested. No unit test, no integration test. The permissionless nature is unvalidated. Authorization failure paths (calling without auth) are untested because `mock_all_auths()` is used everywhere. Transfer to self (owner == new_owner) is untested. Integration tests don't cover `transfer` or `lookup`.
