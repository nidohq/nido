# C01Authority — Theorem-to-Requirement Coverage Map

## G-01: Weight / Authorization

| Theorem | Kind | Requirement covered |
|---|---|---|
| `contains_key_spec` | checked | Full membership bridge: `r = true ↔ key ∈ keys.val` |
| `contains_key_empty` | checked | Empty slice returns false |
| `authorization_weight_exact` | checked | Exact per-role weights (L=2, S=1, R=1, other=0); returns Ok for valid configs; duplicate-invariant (iterates signers not evidence) |
| `authorization_weight_bounded` | checked | Unconditional upper bound w ≤ 4 |
| `can_authorize_iff` | checked | Full iff: `b = true ↔ local ∈ evidence ∨ (service ∈ evidence ∧ recovery ∈ evidence)`; returns Ok for valid configs |
| `can_authorize_empty_evidence_denies` | checked | Empty evidence → denied |
| `can_authorize_only_service_denies` | checked | Service alone (weight 1 < threshold 2) → denied; covers bootstrap/fee/unknown implicitly (not signers) |

## G-02: Validate

| Theorem | Kind | Requirement covered |
|---|---|---|
| `validate_iff_valid_config` | checked | Full iff: `Ok () ↔ ValidConfig a`; excludes always-refuse implementation |
| `validate_rejects_wrong_profile` | checked | First check: UnsupportedProfile |
| `validate_rejects_wrong_kind` | checked | Second check: InvalidAccount (kind) |
| `validate_rejects_wrong_master` | checked | Fourth check: InvalidMaster |
| `validate_rejects_aliased_roles` | checked | AliasedRoles after thresholds pass |
| `roles_distinct_spec` | checked | roles_distinct ↔ RolesAllDistinct |
| `ValidConfig` (def) | helper | Profile, account kind, address=bootstrap, master=0, thresholds=2, distinct roles, 3 signers exactly {L/2, S/1, R/1} |

## G-03: Rotate

| Theorem | Kind | Requirement covered |
|---|---|---|
| `rotate_succeeds` | checked | All 4 kinds: well-formed + evidence → Ok with exact post-roles, field preservation, ValidConfig |
| `rotate_recover_local_succeeds` | checked | RecoverLocal: S+R evidence suffices; extra local NOT forbidden |
| `rotate_preserves_full_account_ref` | checked | Unconditional: tenant/network/kind/address preserved |
| `rotate_result_valid_config` | checked | Unconditional: any Ok result satisfies ValidConfig |
| `rotate_rejects_wrong_account` | checked | WrongAccount refusal |
| `rotate_rejects_wrong_source` | checked | WrongSource refusal (after account match) |
| `rotate_rejects_wrong_old_key` | checked | WrongOldKey refusal |
| `rotate_rejects_invalid_new_key` | checked | InvalidNewKey: collision with any of 5 role keys (incl. fee) |
| `rotate_rejects_invalid_operations` | checked | InvalidOperations: wrong template |
| `rotate_rejects_insufficient_evidence` | checked | InsufficientEvidence: well-formed but evidence lacks required keys |

## G-04: Coalition / Recovery / Unrecoverability

| Theorem | Kind | Requirement covered |
|---|---|---|
| `coalition_sr_after_replace_local` | lemma | After ReplaceLocal, S+R still authorizes |
| `new_key_authorizes_after_local_rotation` | lemma | After Replace/RecoverLocal, new local key authorizes |
| `retired_key_no_weight_replace_local` | lemma | Old local key contributes zero weight after replacement |
| `local_authorizes_after_replace_service` | lemma | After ReplaceService, local still authorizes alone |
| `local_authorizes_after_replace_recovery` | lemma | After ReplaceRecovery, local still authorizes alone |
| `new_sr_coalition_after_replace_service` | lemma | After ReplaceService, new service + surviving recovery authorizes |
| `new_sr_coalition_after_replace_recovery` | lemma | After ReplaceRecovery, surviving service + new recovery authorizes |
| `recovery_recover_local` | lemma | Lost local + S+R survive → RecoverLocal succeeds |
| `recovery_replace_service` | lemma | Local survives + service lost → ReplaceService succeeds |
| `recovery_replace_recovery` | lemma | Local survives + recovery lost → ReplaceRecovery succeeds |
| `unrecoverable_local_service_lost` | lemma | Local+service both unavailable → no rotation succeeds |
| `unrecoverable_local_recovery_lost` | lemma | Local+recovery both unavailable → no rotation succeeds |

## Supporting

| Theorem | Kind | Note |
|---|---|---|
| `valid_authority_signer_weight_sum` | lemma | Weight sum = 4 for validated authority |

## Scope exclusions (not claimed by this campaign)

- Recovery delays, Cedar policies, fee/signer APIs
- Cryptography, signature verification, I/O
- Browser integration, Stellar ledger/envelope semantics
- No target functions are mocked or axiomatized
