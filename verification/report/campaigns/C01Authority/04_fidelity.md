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
