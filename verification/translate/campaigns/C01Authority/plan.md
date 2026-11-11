# C01Authority Translation Plan

## Strategy: IN-PLACE

The `g-account-core` crate is completely self-contained — zero external crate
dependencies, all types and functions defined in `authority.rs`. The target's
type/call closure is entirely within `relevant_state`. No Display/serde/Pubkey/
formatting garbage will be dragged in. In-place translation is ideal.

## Crate
- Path: `/workspace/repo/crates/g-account-core`
- Package: `g-account-core`
- Source: `src/authority.rs` (single file, ~275 lines)

## Target functions (all in `crate::authority`)
1. `validate` — enforces MVP configuration invariant
2. `authorization_weight` — sums signer weights for evidence keys
3. `can_authorize` — compares accumulated weight to category threshold
4. `rotate` — validates, checks request, applies single-role replacement
5. `roles_distinct` — checks all five role keys pairwise unequal
6. `contains_key` — linear search in key slice

## Dependency classification (ONE pass)
- **No external crates** — Cargo.toml has zero `[dependencies]`
- Only stdlib: `Vec`, `Option`, `Result`, basic comparisons — all in Aeneas's
  builtin registry
- Derived traits: `Clone`, `Copy`, `Debug`, `PartialEq`, `Eq` — `Debug` will be
  excluded; `PartialEq`/`Eq`/`Clone`/`Copy` are structural and translate cleanly
- **opaque_boundary**: `core::fmt::Debug::*` and `core::fmt::Formatter` (never
  used by any target function, but derived on types)
- **must_model**: nothing — all types are simple enums/structs with primitive
  fields and `[u8; 32]` arrays

## Overflow posture
- `[profile.release] overflow-checks = true` — deployed binary checks overflow
- Will compile with `--release` so Charon reads checked arithmetic from MIR
- The only arithmetic: `weight += s.weight as u16` (max 4, cannot overflow u16)
  and loop index `i += 1`
- Posture: FALLIBLE (checked), matching deployment

## Charon invocation
```
cd /workspace/repo/crates/g-account-core && \
charon cargo --preset=aeneas \
  --start-from crate::authority \
  --exclude core::fmt::Debug::* \
  --exclude core::fmt::Formatter \
  -- -p g-account-core --release
```

## Aeneas invocation
```
rm -rf /workspace/out/lean/* && \
aeneas -backend lean -dest /workspace/out/lean <path>.llbc
```

## Expected outcome
All 6 functions as real `def`s. No opaque axioms needed (the crate has no
untranslatable dependencies). The only exclusions are Debug/Formatter which
no target touches.
