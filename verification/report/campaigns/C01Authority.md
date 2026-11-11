# Campaign report — C01Authority

# C01Authority -- Overview

## Executive Summary

Campaign C01Authority targets the pure authority kernel of the Nido `g-account-core` crate
(`src/authority.rs`): six functions (`validate`, `authorization_weight`, `can_authorize`,
`rotate`, `roles_distinct`, `contains_key`) governing signer validation, weight
accumulation, authorization decisions, and key rotation for self-directed Stellar
G-accounts. 41 theorem statements were written covering validation, authorization,
rotation success/rejection, coalition preservation, recovery, and unrecoverability.
**All 41 theorems are tainted** (`sorry`-bodied): the Lean project builds, but no
property has been proved. Zero properties of the implementation have been verified.
Both measurement anchors (`authorization_weight`, `can_authorize`) are **ungrounded**:
no established bridge ties the projected quantities in the properties back to the real
translated functions. The pre-proof spec-judge screen found 0 defects in the
statements.

## Overview Table

| Category | Count | Theorems |
|---|---|---|
| Implementation-verified (headline) | **0** | -- |
| Verified modulo trusted base | 0 | -- |
| Surface-only (names type/constant, runs no function) | 0 | -- |
| Abstract-only (no translated reference) | 0 | -- |
| **Tainted** (`sorry` / unestablished) | **41** | All 41 theorems |
| Refuted | 0 | -- |

### Grounding

| Anchor | Status |
|---|---|
| `authorization_weight` | **Ungrounded** -- no established bridge |
| `can_authorize` | **Ungrounded** -- no established bridge |

### Pre-proof spec-judge screen

`spec_judge.defects`: **none** (0 defects). All 41 statements passed the schema
conformance gate before proving was attempted.

### Statement drift

All 41 theorems are **stable** (no unaccounted drift between FORMALISE and PROVE
stages).


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


# C01Authority -- Implementation Spec

## Lake build

`lake build` exits 0. The Lean project compiles successfully with all 41 `sorry`-bodied
theorems (`axioms.lean_build_success: true`).

## Theorem inventory

41 theorems total: 24 checked (`@[lusterna]` -- WP triples over target functions) +
17 supporting (`@[lusterna_lemma]` -- composition lemmas, witnesses, or pure-arithmetic
facts).

All theorem statements live in `lean/GAccountCore/Spec/C01Authority.lean`.

## INFER properties and theorem mapping

Source: `infer/campaigns/C01Authority.json` (9 properties, 4 invariants, 10 edge cases).
The coverage map below traces each INFER property to the theorems that discharge it.

### Property 1: authorization_weight exact formula

> "authorization_weight iterates a.signers and sums each signer's weight as u16 when
> contains_key(evidence, signer.key) is true, contributing each registered key at most
> once; max 4, min 0."

- `authorization_weight_exact` (`C01Authority.lean:207`): exact per-role weight formula
  with `w.val = (if local in evidence then 2 else 0) + ...`
- `authorization_weight_bounded` (`C01Authority.lean:219`): unconditional `w.val <= 4`

### Property 2: can_authorize threshold comparison

> "can_authorize returns Ok(true) when authorization_weight >= the threshold for the
> given category; for valid authority with all thresholds 2, local alone authorizes,
> service+recovery authorizes, service alone does not."

- `can_authorize_iff` (`C01Authority.lean:230`): full iff -- `b = true <->
  local in evidence \/ (service in evidence /\ recovery in evidence)`
- `can_authorize_empty_evidence_denies` (`C01Authority.lean:243`): empty -> denied
- `can_authorize_only_service_denies` (`C01Authority.lean:254`): service alone -> denied

### Property 3: validate iff characterisation

> "validate returns Ok(()) iff: profile == SelfDirected, account.kind == StellarG,
> address == bootstrap, master 0, thresholds 2, roles_distinct, 3 signers exactly
> {local/2, service/1, recovery/1}."

- `validate_iff_valid_config` (`C01Authority.lean:105`): full iff
- `valid_config_inhabited` (`C01Authority.lean:160`): positive witness
- `five_distinct_keys_exist` (`C01Authority.lean:179`): Key type has >= 5 values

### Property 4: validate rejection variants

> "validate rejects: UnsupportedProfile, InvalidAccount, InvalidMaster,
> InvalidThresholds, AliasedRoles, InvalidSigners."

- `validate_rejects_wrong_profile` (`C01Authority.lean:111`)
- `validate_rejects_wrong_kind` (`C01Authority.lean:119`)
- `validate_rejects_wrong_master` (`C01Authority.lean:128`)
- `validate_rejects_aliased_roles` (`C01Authority.lean:139`)
- `roles_distinct_spec` (`C01Authority.lean:152`)

### Property 5: rotate ReplaceLocal success

> "rotate for ReplaceLocal with well-formed request succeeds when evidence contains the
> local key, producing identical Authority except roles.local and matching signer."

- `rotate_succeeds` (`C01Authority.lean:275`): general all-4-kinds success
- `rotate_signer_frame` (`C01Authority.lean:297`): unconditional signer-list frame
- `rotate_preserves_full_account_ref` (`C01Authority.lean:336`): AccountRef preservation
- `rotate_result_valid_config` (`C01Authority.lean:352`): ValidConfig on Ok result

### Property 6: rotate evidence requirements by kind

> "RecoverLocal requires service+recovery; ReplaceService/ReplaceRecovery require local."

- `rotate_recover_local_succeeds` (`C01Authority.lean:316`): RecoverLocal S+R
- `rotate_rejects_insufficient_evidence` (`C01Authority.lean:431`)

### Property 7: rotate rejection variants

> "WrongAccount, WrongSource, WrongOldKey, InvalidNewKey, InvalidOperations,
> InsufficientEvidence."

- `rotate_rejects_wrong_account` (`C01Authority.lean:363`)
- `rotate_rejects_wrong_source` (`C01Authority.lean:374`)
- `rotate_rejects_wrong_old_key` (`C01Authority.lean:386`)
- `rotate_rejects_invalid_new_key` (`C01Authority.lean:399`)
- `rotate_rejects_invalid_operations` (`C01Authority.lean:415`)
- `rotate_rejects_insufficient_evidence` (`C01Authority.lean:431`)

### Property 8: coalition preservation after rotation

> "After successful rotate, can_authorize preserves coalition for surviving keys."

- `coalition_sr_after_replace_local` (`C01Authority.lean:453`)
- `coalition_sr_after_recover_local` (`C01Authority.lean:463`)
- `new_key_authorizes_after_local_rotation` (`C01Authority.lean:475`)
- `retired_key_denial_replace_local` (`C01Authority.lean:489`)
- `retired_key_zero_weight` (`C01Authority.lean:505`)
- `local_authorizes_after_replace_service` (`C01Authority.lean:522`)
- `local_authorizes_after_replace_recovery` (`C01Authority.lean:532`)
- `new_sr_coalition_after_replace_service` (`C01Authority.lean:542`)
- `new_sr_coalition_after_replace_recovery` (`C01Authority.lean:554`)

### Property 9: recovery and unrecoverability

> "If only local is lost, RecoverLocal can restore. If local survives, Replace can fix
> service/recovery. If local plus either service or recovery is lost, authority is
> unrecoverable."

- `recovery_recover_local` (`C01Authority.lean:564`)
- `recovery_replace_service` (`C01Authority.lean:576`)
- `recovery_replace_recovery` (`C01Authority.lean:587`)
- `unrecoverable_local_service_lost` (`C01Authority.lean:600`)
- `unrecoverable_local_recovery_lost` (`C01Authority.lean:610`)

### Invariants

- **Signer weight sum = 4**: `valid_authority_signer_weight_sum` (`C01Authority.lean:626`)
- **ValidConfig inductively preserved by rotate**: `rotate_result_valid_config`
  (`C01Authority.lean:352`)
- **rotate never modifies account/profile/master_weight/thresholds**:
  `rotate_signer_frame` (`C01Authority.lean:297`),
  `rotate_preserves_full_account_ref` (`C01Authority.lean:336`)

### Edge cases

- Duplicate evidence: covered by `authorization_weight_exact` (iterates signers, not
  evidence -- each signer counted at most once).
- new_key collision with fee: covered by `rotate_rejects_invalid_new_key` (disjunction
  includes `request.new_key = a.roles.fee`).
- Self-replacement impossible: implied by `NewKeyFresh` requiring new_key != all five
  role keys.
- `contains_key_spec` and `contains_key_empty`: covers the membership bridge and empty-
  slice case.

### Coverage gaps

No INFER property lacks a corresponding theorem. All 9 properties, 4 invariants, and
10 edge cases are covered by at least one theorem statement.


# C01Authority -- Fidelity Review

This section asks: do the theorem statements actually say what they claim about the
real code? The answer matters even though every proof is `sorry` today, because the
statements define the contract that proofs will fill -- a wrong statement proved is
worse than a correct statement unproved.

## Preliminaries: how the properties talk about the code

### The triple notation `f args ⦃ r => P r ⦄`

Every `@[lusterna]` theorem is a **WP triple** (`Aeneas.Std.WP.spec`,
`Std/WP.lean:56`):

```
def spec (m : Result α) (p : Post α) : Prop :=
  DWP effectWP m (fun value _ => p value) ()
```

Key properties of `WP.spec`:
- `spec (fail e) p ↔ False` (`WP.lean:103`): a failing computation never satisfies
  the triple. So `f args ⦃ r => P r ⦄` **asserts the call is total** (does not fail
  or diverge) and the postcondition P holds on the result.
- `spec (ok v) p ↔ p v` (`WP.lean:97`): on success the postcondition is applied to
  the produced value.

This means every checked theorem simultaneously claims: (a) the target function
terminates without error on the given inputs, and (b) the result satisfies the
postcondition.

### The `.val` projection

The theorems that state numeric equalities (e.g. `authorization_weight_exact`,
`authorization_weight_bounded`) project machine integers through `.val`:
- `Std.U16` = `UScalar .U16` (`Scalar/Core.lean:670`), a wrapper around
  `BitVec 16` (`Scalar/Core.lean:71-73`).
- `UScalar.val` = `bv.toNat` (`Scalar/Core.lean:76`), returning a **`Nat`**
  (natural number, non-negative).
- `Std.U8` = `UScalar .U8` (`Scalar/Core.lean:669`), with the same `.val = bv.toNat : Nat`.

When a theorem says `w.val = (if ... then 2 else 0) + ...`, the right-hand side is
a `Nat` expression. The comparison is `Nat = Nat` with no coercion. This is the
faithful and only natural way to state a value-level property about unsigned
machine integers: the numbers are non-negative, the `.val` projection is the
identity-in-meaning extraction of the numeric value from the bit-vector wrapper, and
`Nat` arithmetic (non-negative, unbounded) is the right domain for stating equalities
about values that must hold regardless of width.

### The `as u16` cast in the Rust source

The Rust source (`authority.rs:157`) does `weight += a.signers[i].weight as u16`,
casting a `u8` signer weight to `u16` before accumulating. In the Lean translation
(`GAccountCore.lean:1252`), this becomes:
```
let i2 ← lift (UScalar.cast .U16 s.weight)
weight + i2
```

`UScalar.cast` (`Scalar/Casts.lean:20`) zero-extends the `BitVec 8` to `BitVec 16`.
For a U8 value at most 255, zero-extending to U16 is lossless -- and for the actual
signer weights (0, 1, or 2 after validation), this is trivially exact. The `+` on
U16 is a **checked** add (returns `Result`, fails on overflow) consistent with
`overflow-checks = true`. For the actual maximum sum of 4, overflow is impossible,
but the model faithfully represents the checked semantics.

---

## Fidelity of the two measurement anchors

The INFER stage designated two **anchor functions**: `authorization_weight` and
`can_authorize`. These are the functions whose numeric output the properties project
through `.val` to state value-level claims. The question is whether an established
bridge ties each projected quantity to the real translated function.

### Anchor: `authorization_weight`

**The projection the properties reason about**: `w.val` where `w : Std.U16` is the
weight returned by `authorization_weight`. In `authorization_weight_exact`
(`C01Authority.lean:207-215`):

```
authority.authorization_weight a evidence
  ⦃ (r : core.result.Result Std.U16 authority.Refusal) =>
  ∃ w, r = core.result.Result.Ok w ∧
    w.val = (if a.roles.local ∈ evidence.val then 2 else 0) +
            (if a.roles.service ∈ evidence.val then 1 else 0) +
            (if a.roles.recovery ∈ evidence.val then 1 else 0) ⦄
```

**The real function it stands in for**: `authority.authorization_weight`
(`GAccountCore.lean:1276`), the Aeneas-translated `def` with body. The triple runs
this function directly -- the computation inside the `⦃ ⦄` is
`authority.authorization_weight a evidence`, which IS the translated function, not a
model or projection of it.

**The bridge**: The triple IS the bridge. `WP.spec` applied to
`authority.authorization_weight a evidence` directly says: run this exact function
and the result satisfies the postcondition. There is no indirection -- the function
called in the triple is the same `def` Aeneas generated from Charon's LLBC of
`src/authority.rs:151-162`.

**Grounding status**: **Ungrounded** per `axioms.grounding`. This is because the
theorem is `sorry`-bodied (tainted), so no ESTABLISHED theorem ties the projected
formula to the function. The bridge structure is correct in the statement, but it
carries no force until proved.

### Anchor: `can_authorize`

**The projection**: In `can_authorize_iff` (`C01Authority.lean:230-239`), the property
reasons about whether `b = true`, where `b : Bool` is the authorization decision:

```
authority.can_authorize a evidence category
  ⦃ (r : core.result.Result Bool authority.Refusal) =>
  ∃ b, r = core.result.Result.Ok b ∧
    (b = true ↔
      a.roles.local ∈ evidence.val ∨
      (a.roles.service ∈ evidence.val ∧ a.roles.recovery ∈ evidence.val)) ⦄
```

**The real function**: `authority.can_authorize` (`GAccountCore.lean:1293`), which
calls `authorization_weight` and compares the weight to the threshold via `>=`.

**The bridge**: Again the triple runs the real function directly. The postcondition
characterises the boolean result via a pure logical iff.

**Grounding status**: **Ungrounded** per `axioms.grounding` -- same reason, `sorry`-
bodied.

---

## Fidelity walkthrough: do the projected formulas mirror the code?

### `authorization_weight_exact` vs the translated function

The theorem claims: for a valid authority, `authorization_weight` returns `Ok w` where
`w.val` equals the sum of per-role weights conditional on evidence membership.

Walking the translated function (`GAccountCore.lean:1276-1288`):
1. It calls `authority.validate a` and branches on the result (`:1280-1281`).
   The `?`-operator propagates validation errors. The theorem's precondition
   `hvalid : authority.validate a = ok (core.result.Result.Ok ())` matches.
2. On success, it calls `authorization_weight_loop a evidence 0#u16 0#usize`
   (`:1284`).
3. The loop body (`GAccountCore.lean:1237-1257`) iterates `i` from 0 to
   `a.signers.len`:
   - indexes `a.signers[i]` to get signer `s` (`:1245-1247`)
   - calls `contains_key evidence s.key` (`:1248`)
   - if true, casts `s.weight` to U16 and adds to `weight` (`:1251-1253`)
   - increments `i` (`:1255`)
4. Returns `Ok(weight)` (`:1285`).

The Rust source (`authority.rs:151-162`) does exactly this: validate, loop over
signers, accumulate weight. For a valid authority, `validate` establishes the signer
list is exactly `[{local, 2}, {service, 1}, {recovery, 1}]` (via `ValidConfig`). So
the loop accumulates:
- 2 if `contains_key(evidence, local)`, else 0
- 1 if `contains_key(evidence, service)`, else 0
- 1 if `contains_key(evidence, recovery)`, else 0

This matches the formula `(if local ∈ evidence.val then 2 else 0) + (if service ∈
evidence.val then 1 else 0) + (if recovery ∈ evidence.val then 1 else 0)` exactly.
The `.val` projection converts the U16 result to `Nat`, and the right-hand side is
also `Nat` (2, 1, 0 are `Nat` literals here since `.val : Nat`). No coercion issue.

**Subtlety: `contains_key` and `∈`**. The formula uses `a.roles.local ∈ evidence.val`
(list membership), but the code calls `authority.contains_key evidence s.key`. The
bridge between these is `contains_key_spec` (`C01Authority.lean:189-192`):
```
authority.contains_key keys key ⦃ (r : Bool) => r = true ↔ key ∈ keys.val ⦄
```
This theorem (itself `sorry`-bodied) claims `contains_key` returns true iff the key
is in the list. The formula in `authorization_weight_exact` relies on this bridge
being correct. Walking the translated `contains_key` (`GAccountCore.lean:831-864`):
it loops over the slice comparing each element via `PartialEqKey.eq`, returning true
on match, false at end. The Rust source (`authority.rs:82-91`) does the same. The
bridge formula is faithful.

### `can_authorize_iff` vs the translated function

The theorem claims: for a valid authority, `can_authorize` returns `Ok b` where
`b = true` iff `local ∈ evidence ∨ (service ∈ evidence ∧ recovery ∈ evidence)`.

Walking the translated function (`GAccountCore.lean:1293-1311`):
1. Calls `authorization_weight a evidence` (`:1298`), propagates errors.
2. On success (`val` = the weight), matches on `category` to get `threshold`
   (`:1302-1306`). For a valid authority all thresholds are `2#u8`.
3. Casts threshold to U16 via `UScalar.cast .U16 threshold` (`:1307`).
4. Returns `Ok (val >= i)` (`:1308`), i.e. `weight >= threshold_as_u16`.

For a valid authority with thresholds all 2: `weight >= 2` iff `weight ∈ {2, 3, 4}`.
From the weight formula: weight is 2 when local is present (contributes 2 alone),
weight is 2 when service + recovery are both present (1+1), weight is 3 when
local + one of {service, recovery}, weight is 4 when all three. So `weight >= 2`
iff `local ∈ evidence ∨ (service ∈ evidence ∧ recovery ∈ evidence)`.

The iff in the theorem matches this. The `>=` comparison is on U16 values
(`:1308` -- `val >= i` where both are `Std.U16`), which correctly corresponds to
the natural number comparison.

### `validate_iff_valid_config` vs the translated function

The theorem claims: `validate a` produces `Ok (Result.Ok ())` iff `ValidConfig a`.

Walking `authority.validate` (`GAccountCore.lean:1181-1231`):
- Checks profile (`:1186-1190`), account kind (`:1192-1197`), address (`:1199-1204`),
  master_weight (`:1206-1207`), thresholds (`:1209-1218`), roles_distinct
  (`:1220-1221`), signers.len (`:1223-1227`), then the signer-matching loop
  (`:1229-1230`).

The `ValidConfig` predicate (`C01Authority.lean:26-38`) checks:
- `profile = SelfDirected`, `account.kind = StellarG`, `account.address = roles.bootstrap`
- `master_weight = 0#u8`, thresholds all `2#u8`
- `RolesAllDistinct a.roles`, `signers.length = 3`
- `{local/2, service/1, recovery/1} ∈ signers.val`

Each condition in `ValidConfig` corresponds to a check in the translated function,
in order. The signer membership condition (`∈ signers.val`) corresponds to the
validate loop that checks each signer matches exactly one of {local/2, service/1,
recovery/1}. The iff structure is faithful to the code.

### `rotate_succeeds` vs the translated function

The theorem claims: for a valid authority, well-formed request, and correct evidence,
`rotate` returns `Ok a'` with specified post-state.

Walking `authority.rotate` (`GAccountCore.lean:1707-1905`):
1. Validates current authority (`:1712`)
2. Checks `request.account = a.account` (`:1716-1721`)
3. Checks `request.transaction_source = a.account.address` (`:1723-1728`)
4. Extracts `(old_key, weight)` per kind (`:1730-1739`)
5. Checks `request.old_key = old_key` (`:1740-1744`)
6. Checks `new_key` against all five role keys (`:1746-1776`)
7. Checks operation template (`:1778-1822`)
8. Checks evidence (`:1824-1841`)
9. Clones authority, updates roles per kind (`:1844-1860`)
10. Runs signer replacement loop (`:1862-1863`)
11. Validates result (`:1864-1878`), returns Ok on success (`:1882-1897`)

The postcondition in `rotate_succeeds` claims:
- `a'.account = a.account`, `a'.profile = a.profile`, `a'.master_weight = a.master_weight`,
  `a'.thresholds = a.thresholds`: the clone preserves these, and only roles/signers change.
- `a'.roles = postRotationRoles request.kind a.roles request.new_key`: the role update
  at `:1847-1860` matches the `postRotationRoles` definition (`C01Authority.lean:82-88`).
- `a'.signers.val = signerListAfterRotation ...`: the signer loop at `:1862-1863` calls
  `rotate_loop old_key weight request.new_key next.signers 0#usize`, which maps each
  signer, replacing those with key = old_key. This matches `signerListAfterRotation`
  (`C01Authority.lean:93-95`): `signers.map (fun s => if s.key = old_key then ⟨new_key, weight⟩ else s)`.
- `ValidConfig a'`: the re-validation at `:1864-1878` ensures this.

The statement is faithful to the code path.

---

## The `@[lusterna_lemma]` composition properties

The 17 `@[lusterna_lemma]` theorems compose two target executions (e.g.
`rotate` then `can_authorize`). These use the **equational** form rather than
the triple form, e.g.:

```
(hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
...
authority.can_authorize a' new_ev cat = ok (core.result.Result.Ok true)
```

These are structurally weaker than triples (they assume the prior call succeeded via
a hypothesis rather than proving it inside a triple), but this is the appropriate
form for multi-step composition: the rotate hypothesis provides the post-state `a'`
that feeds into `can_authorize`. The functions called are the real translated `def`s,
so the composition reasons about the actual implementation, not abstractions.

---

## Overflow posture attribution

The model's `+`/`-` are fallible because the **deployed release profile** has
`overflow-checks = true`:
- `/workspace/repo/Cargo.toml:62`: `overflow-checks = true`
- `/workspace/repo/crates/g-account-core/Cargo.toml:12`: `overflow-checks = true`

Charon compiled with `--release`, reading the crate's `[profile.release]`. The harness
confirmed the compiled and deployed profiles match (`overflow_posture.could_not_verify:
false`). Therefore the checked `+` at `GAccountCore.lean:1253` (weight accumulation)
and `GAccountCore.lean:1255` (loop index increment) return `Result` and will `fail` on
overflow -- matching the deployed binary's panic behaviour.

There are **no hand-modelled value types** in this campaign. All types come from the
Charon translation of the real crate, so the harness's profile-matching enforcement
covers all arithmetic. No hand-model overflow gap exists.

---

## Summary of fidelity findings

1. **Projection faithfulness**: The `.val` projections in `authorization_weight_exact`
   and `authorization_weight_bounded` use `UScalar.val : Nat`, which is `bv.toNat` --
   the canonical unsigned bit-vector-to-natural reading. Since all projected values are
   unsigned (`U8`, `U16`), `.val` is `Nat`, and the right-hand formulas are `Nat`
   expressions. No signed/unsigned mismatch, no coercion, no hidden scale factor.

2. **Bridge structure**: Every checked triple directly invokes the real translated
   function. No indirection or auxiliary model stands between the property and the code.
   However, both anchors are **ungrounded** because every theorem is `sorry`-bodied.
   The bridge structure is correct but carries no formal force yet.

3. **Overflow posture**: Correctly attributed to the deployed profile's
   `overflow-checks = true`, not to an Aeneas default. The model is faithful.

4. **No hidden coercion bugs**: The cast `as u16` in the Rust source is modelled as
   `UScalar.cast .U16` (zero-extension), which is lossless for U8-to-U16. The `>=`
   comparison in `can_authorize` is on same-type `U16` values. No cross-type
   comparison artefact.

5. **`contains_key` bridge**: The `∈ evidence.val` used in formulas is tied to the
   `contains_key` function via `contains_key_spec`, which states the exact iff. This
   bridge is itself `sorry`-bodied but structurally correct.

6. **What "proved" does NOT mean here**: Nothing is proved. All 41 theorems are
   `sorry`-bodied. The fidelity review above confirms the statements are well-formed
   and faithfully mirror the code, so that proving them would yield genuine guarantees.
   But today, the campaign provides zero formal assurance.


# C01Authority -- Proof Status

## Authoritative verdict

Source: `#print axioms` via `axioms.json`. Every theorem below depends on `sorryAx`
and is therefore **tainted**. `sorry_remaining: 41`.

## Per-theorem status

### G-02: Validate

| Theorem | Status | Sketch / Strategy |
|---|---|---|
| `validate_iff_valid_config` | TAINTED (sorry) | Unfold `validate`, case-split on each branch, show each check corresponds to a `ValidConfig` conjunct. The forward direction follows the happy path; the reverse reconstructs success from the conjunction. |
| `validate_rejects_wrong_profile` | TAINTED (sorry) | Unfold `validate`, the first `if` matches the hypothesis. One `step` + `simp`. |
| `validate_rejects_wrong_kind` | TAINTED (sorry) | Unfold, pass the first check (profile ok), hit the second (kind != StellarG). |
| `validate_rejects_wrong_master` | TAINTED (sorry) | Unfold, pass profile/account/address checks, hit `master_weight != 0`. |
| `validate_rejects_aliased_roles` | TAINTED (sorry) | Unfold past thresholds, use `roles_distinct_spec` to show `roles_distinct` returns false, hit AliasedRoles. |
| `roles_distinct_spec` | TAINTED (sorry) | Unfold `roles_distinct`, each `ne` call produces a Bool; the chain of `&&` is true iff all 10 pairs are distinct. |
| `valid_config_inhabited` | TAINTED (sorry) | Construct the `Authority` value, unfold `ValidConfig`, verify each conjunct by `decide`/`simp` on the concrete structure. |
| `five_distinct_keys_exist` | TAINTED (sorry) | Construct five concrete `Array U8 32` values differing in the first byte; prove distinctness by `decide`. |

### G-01: Weight / Authorization

| Theorem | Status | Sketch / Strategy |
|---|---|---|
| `contains_key_spec` | TAINTED (sorry) | Loop induction on `contains_key_loop`; base case (i >= len) returns false = empty remainder; step case: eq-check matches iff membership. |
| `contains_key_empty` | TAINTED (sorry) | Follows from `contains_key_spec` + empty slice has no members. |
| `authorization_weight_exact` | TAINTED (sorry) | Use `validate_iff_valid_config` to get signer structure, then loop induction over the 3-element signer list with `contains_key_spec`. |
| `authorization_weight_bounded` | TAINTED (sorry) | Case-split on success/failure; on Ok, the weight formula gives at most 2+1+1=4. |
| `can_authorize_iff` | TAINTED (sorry) | Compose `authorization_weight_exact` with the threshold comparison; all thresholds are 2 from validity. |
| `can_authorize_empty_evidence_denies` | TAINTED (sorry) | Empty evidence -> weight 0 < threshold 2. |
| `can_authorize_only_service_denies` | TAINTED (sorry) | Service alone -> weight 1 < threshold 2. |

### G-03: Rotate

| Theorem | Status | Sketch / Strategy |
|---|---|---|
| `rotate_succeeds` | TAINTED (sorry) | Unfold `rotate`, discharge each guard using `WellFormedRequest` + `KindEvidenceMet`, then show post-state matches claims. Heaviest proof in the campaign. |
| `rotate_signer_frame` | TAINTED (sorry) | Unconditional: unfold any Ok path of `rotate`, read off field assignments from the constructor. |
| `rotate_recover_local_succeeds` | TAINTED (sorry) | Specialise `rotate_succeeds` to RecoverLocal, supply evidence hypotheses. |
| `rotate_preserves_full_account_ref` | TAINTED (sorry) | Unconditional: the clone preserves account, and no code path modifies it. |
| `rotate_result_valid_config` | TAINTED (sorry) | Unconditional: the final `validate(&next)?` in `rotate` ensures any Ok result is valid. |
| `rotate_rejects_wrong_account` | TAINTED (sorry) | Unfold to the account check, hypothesis gives `ne`, code returns WrongAccount. |
| `rotate_rejects_wrong_source` | TAINTED (sorry) | Pass account check, hit source check with `ne`. |
| `rotate_rejects_wrong_old_key` | TAINTED (sorry) | Pass account+source, hit old_key mismatch. |
| `rotate_rejects_invalid_new_key` | TAINTED (sorry) | Pass to new_key checks, one of the five disjuncts fires. |
| `rotate_rejects_invalid_operations` | TAINTED (sorry) | Pass to operations check, template mismatch. |
| `rotate_rejects_insufficient_evidence` | TAINTED (sorry) | Pass all structural checks, evidence check fails. |

### G-04: Coalition / Recovery / Unrecoverability

| Theorem | Status | Sketch / Strategy |
|---|---|---|
| `coalition_sr_after_replace_local` | TAINTED (sorry) | Use `rotate_signer_frame` to get post-signer list, then `can_authorize_iff` on the post-authority. Service and recovery keys survive replacement. |
| `coalition_sr_after_recover_local` | TAINTED (sorry) | Same strategy, RecoverLocal preserves service+recovery. |
| `new_key_authorizes_after_local_rotation` | TAINTED (sorry) | Post-rotation signer list has `{new_key, 2}`; weight >= 2. |
| `retired_key_denial_replace_local` | TAINTED (sorry) | Old local key is no longer in post-signer list; weight 0 < 2. |
| `retired_key_zero_weight` | TAINTED (sorry) | Same reasoning, stated as exact weight = 0. |
| `local_authorizes_after_replace_service` | TAINTED (sorry) | Local key unchanged by ReplaceService; weight 2 >= 2. |
| `local_authorizes_after_replace_recovery` | TAINTED (sorry) | Local key unchanged by ReplaceRecovery; weight 2 >= 2. |
| `new_sr_coalition_after_replace_service` | TAINTED (sorry) | New service (weight 1) + surviving recovery (weight 1) = 2 >= 2. |
| `new_sr_coalition_after_replace_recovery` | TAINTED (sorry) | Surviving service (weight 1) + new recovery (weight 1) = 2 >= 2. |
| `recovery_recover_local` | TAINTED (sorry) | Apply `rotate_succeeds` with RecoverLocal kind and S+R evidence. |
| `recovery_replace_service` | TAINTED (sorry) | Apply `rotate_succeeds` with ReplaceService kind and local evidence. |
| `recovery_replace_recovery` | TAINTED (sorry) | Apply `rotate_succeeds` with ReplaceRecovery kind and local evidence. |
| `unrecoverable_local_service_lost` | TAINTED (sorry) | Case-split on all four RotationKinds; each requires local or service in evidence, neither available. |
| `unrecoverable_local_recovery_lost` | TAINTED (sorry) | Same: each kind requires local or recovery. |

### Supporting

| Theorem | Status | Sketch / Strategy |
|---|---|---|
| `valid_authority_signer_weight_sum` | TAINTED (sorry) | From `validate = Ok` get the 3-signer structure; fold weights: 2+1+1=4. |

## Refutations

`axioms.refutations`: **empty**. No property has been refuted.


# C01Authority -- Summary

## Open obligations

All 41 theorems are `sorry`-bodied. Each requires a proof. Suggested attack order:

1. **Foundation layer** (unblocks everything else):
   - `contains_key_spec` -- loop induction, the membership bridge all weight/auth
     properties depend on.
   - `roles_distinct_spec` -- chain of `ne` calls, relatively mechanical.
   - `valid_config_inhabited` + `five_distinct_keys_exist` -- concrete construction,
     `decide`-solvable.

2. **Validate** (unblocks all properties with `hvalid` precondition):
   - `validate_iff_valid_config` -- the hardest in this layer (both directions through
     the signer-matching loop).
   - The five rejection theorems are each one-branch unfoldings.

3. **Weight / Authorization** (the first anchor grounding):
   - `authorization_weight_exact` -- loop induction over the 3-element validated signer
     list, composing `contains_key_spec`.
   - `authorization_weight_bounded`, `can_authorize_iff`, and the two denial specialisations
     follow.

4. **Rotate** (the second major block):
   - `rotate_succeeds` -- the largest single proof (long `rotate` function, many guards).
   - `rotate_signer_frame` and the rejection theorems are sub-cases.
   - `rotate_result_valid_config` follows from the re-validation in `rotate`.

5. **Composition** (G-04):
   - All 14 composition lemmas depend on the rotate and authorization layers being done.
   - Most are one-step applications of prior results.

## Refuted properties

None. `axioms.refutations` is empty.

## Ungrounded projections

Both measurement anchors are **ungrounded**:

| Anchor | Gap |
|---|---|
| `authorization_weight` | No established bridge ties the `w.val` formula to the real function. `authorization_weight_exact` has the correct bridge structure but is `sorry`-bodied. |
| `can_authorize` | No established bridge ties the boolean characterisation to the real function. `can_authorize_iff` has the correct bridge structure but is `sorry`-bodied. |

These are the most important obligations to close: without them, even if other
theorems were proved, the projected quantities would not be tied to the real code.

## Known gaps and limitations

1. **Zero verified properties**. The campaign defines a comprehensive specification (41
   theorems, 0 coverage gaps against INFER, 0 spec-judge defects) but has proved none
   of it. The Lean project builds, the statements pass schema conformance, and the
   fidelity review (Section 4) confirms they faithfully mirror the code -- but formal
   assurance is zero until proofs replace the `sorry`s.

2. **Single opaque axiom**: `core.option.Option.Insts.CoreCmpPartialEqOption.eq`. The
   translation agent states it is unreachable from target functions. If any proof path
   reaches it (e.g. through `Operation` equality in `rotate`), the theorem will be
   tainted unless this axiom is declared as a trusted assumption. This should be
   monitored during proving.

3. **No hand-modelled types** -- all types are Charon-translated, so no manual
   overflow-posture gap exists.

4. **Debug surface stripping** -- 373 lines of `core::fmt::Debug` impls were removed
   post-generation. This is cosmetic (no target function or property uses Debug), but
   the generated Lean does not exactly match raw Aeneas output.

## Overall verdict

Campaign C01Authority has completed **translation and specification** for the
`g-account-core` authority kernel. The translation is clean (in-place, no source
edits, no extraction crate, overflow posture verified), and the 41 theorem statements
are well-formed, schema-conformant, and faithful to the code as confirmed by the
fidelity review. However, **no property has been proved**: all 41 theorems are
`sorry`-bodied and tainted, both anchors are ungrounded, and the campaign provides
zero formal assurance about the implementation. The specification is ready for proving.
