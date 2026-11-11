# C01Authority -- Translation

## Source and scope

- **Entry crate**: `g-account-core` (`crates/g-account-core/`), a standalone no-dependency
  crate containing the pure authority kernel.
- **Entry file**: `src/authority.rs` (275 lines).
- **Charon scope**: `--start-from crate::authority` -- only the `authority` module.
- **Charon invocation** (from `translate/campaigns/C01Authority/accountability.md`):
  ```
  cd /workspace/repo/crates/g-account-core && \
  charon cargo --preset=aeneas \
    --start-from crate::authority \
    -- -p g-account-core --release
  ```
- **Strategy**: IN-PLACE on the real crate -- no extraction crate. The crate has zero
  external dependencies; all types are local.
- **Aeneas output**: single file `lean/GAccountCore.lean` (no `-split-files`).

## Accountability summary

The translation agent's accountability record
(`translate/campaigns/C01Authority/accountability.md`) states:

1. **No `--opaque` or `--exclude` flags** were passed. The crate needed none.
2. **No source edits**. The crate translated cleanly as-is.
3. **Post-generation cleanup**: 30 blocks (373 lines) of `core::fmt::Debug` surface were
   stripped from `GAccountCore.lean` by a Python filter. Rationale: Debug impls are
   non-value rendering surface; no target function calls any Debug impl and no inferred
   property depends on Debug formatting. The agent notes `--exclude core::fmt::Debug::*`
   crashed Aeneas, so post-generation stripping was used instead.
4. **All six target functions** are real `def`s with bodies in the generated Lean:

   | Target | Lean line | Status |
   |---|---|---|
   | `authority.contains_key` | `GAccountCore.lean:862` | `def` with body |
   | `authority.roles_distinct` | `GAccountCore.lean:869` | `def` with body |
   | `authority.validate` | `GAccountCore.lean:1181` | `def` with body |
   | `authority.authorization_weight` | `GAccountCore.lean:1276` | `def` with body |
   | `authority.can_authorize` | `GAccountCore.lean:1293` | `def` with body |
   | `authority.rotate` | `GAccountCore.lean:1707` | `def` with body |

5. **No rung-3 hand-modelled types**. All types are Charon-translated from the crate.

## Trust boundary

### Opaqued primitives

One axiom remains in the generated Lean after cleanup:

- `core.option.Option.Insts.CoreCmpPartialEqOption.eq`
  (`GAccountCore.lean:32`): the `PartialEq` impl for `Option<T>`.

The agent's accountability states this axiom is referenced only by the derived
`PartialEq` for `Operation` and is **not transitively reachable from any target
function**. This is consistent with `axioms.json`: it appears in
`opaque_assumptions` but is listed as a `declared_assumption` (empty list) --
meaning no theorem declares it as part of its trusted base. Therefore any theorem
whose proof chain touches this axiom would be tainted, not verified-modulo-base.
Since all 41 theorems are `sorry`-bodied and already tainted by `sorryAx`, this
axiom's status is moot for now but will matter once proofs are attempted.

### Untranslated holes

`axioms.holes`: **empty**. No functions were left as untranslated stubs.

### Declared assumptions

`axioms.declared_assumptions`: **empty**. No axioms are declared as part of the
trusted base for any theorem.

## Overflow posture

- **Deployed profile**: `[profile.release] overflow-checks = true` at two levels:
  - Workspace root: `/workspace/repo/Cargo.toml:62` -- `overflow-checks = true`
  - Crate-level: `/workspace/repo/crates/g-account-core/Cargo.toml:12` --
    `overflow-checks = true`
- **Charon compile**: `--release` flag was passed, so Charon read the
  `[profile.release]` section with `overflow-checks = true`.
- **Harness verification** (`overflow_posture` in `axioms.json`):
  - `deploy_profile.overflow-checks`: `true`
    (source: `/workspace/repo/Cargo.toml`)
  - `compiled_profile.overflow-checks`: `true`
    (source: `/workspace/repo/crates/g-account-core/Cargo.toml`)
  - `model_checked_ops`: `true`
  - `could_not_verify`: `false`
  - `block`: `false`

The model's `+`/`-` operations are **fallible** (checked, returning `Result`, failing
on overflow) because the deployed binary ships with `overflow-checks = true` in its
release profile, and the Charon compile reproduced that posture via `--release`. The
harness confirmed the two match. This means the Lean model's arithmetic operations
(`weight + i2` at `GAccountCore.lean:1253`, `i + 1#usize` at `GAccountCore.lean:1255`)
return `Result` and will `fail` on overflow -- faithfully reflecting the deployed
binary's panic-on-overflow behaviour.

**No hand-modelled value types** exist in this campaign (no rung-3 modelling), so there
is nothing for the harness to be unable to enforce on this front.
