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
