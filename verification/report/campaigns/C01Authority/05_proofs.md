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
