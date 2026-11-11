# C01Authority — Theorem-to-Requirement Coverage Map

**41 theorems total: 24 checked (`@[lusterna]`) + 17 supporting (`@[lusterna_lemma]`)**

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
| `valid_config_inhabited` | lemma | Positive witness: ValidConfig constructible from five distinct keys via Vec.from |
| `five_distinct_keys_exist` | lemma | Key type has ≥ 5 distinct values; combined with above proves validate can return Ok |
| `ValidConfig` (def) | helper | Profile, account kind, address=bootstrap, master=0, thresholds=2, distinct roles, 3 signers with exact entries {L/2, S/1, R/1} ∈ signers.val |

## G-03: Rotate

| Theorem | Kind | Requirement covered |
|---|---|---|
| `rotate_succeeds` | checked | All 4 kinds: well-formed + evidence → Ok with exact post-roles, positional signer frame via `signerListAfterRotation`, field preservation, ValidConfig |
| `rotate_signer_frame` | checked | Unconditional signer-list frame: any Ok result has `signers.val = signerListAfterRotation ...` + field preservation; no WellFormedRequest premise |
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
| `coalition_sr_after_recover_local` | lemma | After RecoverLocal, S+R still authorizes |
| `new_key_authorizes_after_local_rotation` | lemma | After Replace/RecoverLocal, new local key authorizes |
| `retired_key_denial_replace_local` | lemma | Old local key cannot authorize alone after replacement (threshold denial) |
| `retired_key_zero_weight` | lemma | Old role key contributes exact zero weight after any rotation kind |
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
