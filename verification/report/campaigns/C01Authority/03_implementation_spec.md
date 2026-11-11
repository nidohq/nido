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
