import GAccountCore
import GAccountCore.LusternaSchemas

namespace GAccountCore.Spec.C01Authority

open g_account_core
open Aeneas Aeneas.Std Result

noncomputable section

/- All five role keys are pairwise distinct -/
def RolesAllDistinct (r : authority.Roles) : Prop :=
  r.bootstrap ≠ r.local ∧
  r.bootstrap ≠ r.service ∧
  r.bootstrap ≠ r.recovery ∧
  r.bootstrap ≠ r.fee ∧
  r.local ≠ r.service ∧
  r.local ≠ r.recovery ∧
  r.local ≠ r.fee ∧
  r.service ≠ r.recovery ∧
  r.service ≠ r.fee ∧
  r.recovery ≠ r.fee

/- The MVP self-directed configuration conditions that validate checks -/
def ValidConfig (a : authority.Authority) : Prop :=
  a.profile = authority.Profile.SelfDirected ∧
  a.account.kind = authority.AccountKind.StellarG ∧
  a.account.address = a.roles.bootstrap ∧
  a.master_weight = 0#u8 ∧
  a.thresholds.low = 2#u8 ∧
  a.thresholds.medium = 2#u8 ∧
  a.thresholds.high = 2#u8 ∧
  RolesAllDistinct a.roles ∧
  a.signers.length = 3 ∧
  (⟨a.roles.local, 2#u8⟩ : authority.Signer) ∈ a.signers.val ∧
  (⟨a.roles.service, 1#u8⟩ : authority.Signer) ∈ a.signers.val ∧
  (⟨a.roles.recovery, 1#u8⟩ : authority.Signer) ∈ a.signers.val

-- ─────────────────────────────────────────────────────────
-- Checked properties
-- ─────────────────────────────────────────────────────────

/-- validate returns Ok(()) only when the MVP configuration invariant holds on the input -/
@[lusterna]
theorem validate_ok_implies_config (a : authority.Authority) :
    authority.validate a ⦃ (r : core.result.Result Unit authority.Refusal) =>
      match r with
      | core.result.Result.Ok () => ValidConfig a
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- validate rejects with UnsupportedProfile when profile is not SelfDirected -/
@[lusterna]
theorem validate_rejects_wrong_profile
    (a : authority.Authority)
    (h : a.profile ≠ authority.Profile.SelfDirected) :
    authority.validate a ⦃ (r : core.result.Result Unit authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.UnsupportedProfile ⦄ := by sorry

/-- roles_distinct correctly reflects pairwise distinctness of the five role keys -/
@[lusterna]
theorem roles_distinct_spec (r : authority.Roles) :
    authority.roles_distinct r ⦃ (b : Bool) =>
      b = true ↔ RolesAllDistinct r ⦄ := by sorry

/-- contains_key on an empty key slice returns false -/
@[lusterna]
theorem contains_key_empty
    (keys : Slice authority.Key) (key : authority.Key)
    (hempty : keys.length = 0) :
    authority.contains_key keys key ⦃ (r : Bool) =>
      r = false ⦄ := by sorry

/-- authorization_weight on a valid authority is bounded by 4 (the sum 2+1+1 of signer weights) -/
@[lusterna]
theorem authorization_weight_bounded
    (a : authority.Authority) (evidence : Slice authority.Key) :
    authority.authorization_weight a evidence
      ⦃ (r : core.result.Result Std.U16 authority.Refusal) =>
      match r with
      | core.result.Result.Ok w => w.val ≤ 4
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- For a valid authority, evidence containing the local key yields weight at least 2 -/
@[lusterna]
theorem authorization_weight_local_key
    (a : authority.Authority) (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hlocal : authority.contains_key evidence a.roles.local = ok true) :
    authority.authorization_weight a evidence
      ⦃ (r : core.result.Result Std.U16 authority.Refusal) =>
      match r with
      | core.result.Result.Ok w => w.val ≥ 2
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- With a valid authority and local key in evidence, can_authorize returns Ok(true) for any category -/
@[lusterna]
theorem can_authorize_local_authorizes
    (a : authority.Authority) (evidence : Slice authority.Key)
    (category : authority.Category)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hlocal : authority.contains_key evidence a.roles.local = ok true) :
    authority.can_authorize a evidence category
      ⦃ (r : core.result.Result Bool authority.Refusal) =>
      r = core.result.Result.Ok true ⦄ := by sorry

/-- With a valid authority and service+recovery keys in evidence, can_authorize returns Ok(true) -/
@[lusterna]
theorem can_authorize_service_recovery_authorizes
    (a : authority.Authority) (evidence : Slice authority.Key)
    (category : authority.Category)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hservice : authority.contains_key evidence a.roles.service = ok true)
    (hrecovery : authority.contains_key evidence a.roles.recovery = ok true) :
    authority.can_authorize a evidence category
      ⦃ (r : core.result.Result Bool authority.Refusal) =>
      r = core.result.Result.Ok true ⦄ := by sorry

/-- With a valid authority and empty evidence, can_authorize returns Ok(false) for any category -/
@[lusterna]
theorem can_authorize_empty_evidence_denies
    (a : authority.Authority) (evidence : Slice authority.Key)
    (category : authority.Category)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hempty : evidence.length = 0) :
    authority.can_authorize a evidence category
      ⦃ (r : core.result.Result Bool authority.Refusal) =>
      r = core.result.Result.Ok false ⦄ := by sorry

/-- With only the service key (weight 1), can_authorize returns Ok(false) since threshold is 2 -/
@[lusterna]
theorem can_authorize_only_service_denies
    (a : authority.Authority) (evidence : Slice authority.Key)
    (category : authority.Category)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hservice : authority.contains_key evidence a.roles.service = ok true)
    (hno_local : authority.contains_key evidence a.roles.local = ok false)
    (hno_recovery : authority.contains_key evidence a.roles.recovery = ok false) :
    authority.can_authorize a evidence category
      ⦃ (r : core.result.Result Bool authority.Refusal) =>
      r = core.result.Result.Ok false ⦄ := by sorry

/-- A successful rotate preserves account, profile, master_weight, and thresholds -/
@[lusterna]
theorem rotate_preserves_fields
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      match r with
      | core.result.Result.Ok a' =>
        a'.account = a.account ∧
        a'.profile = a.profile ∧
        a'.master_weight = a.master_weight ∧
        a'.thresholds = a.thresholds
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- A successful rotate produces an authority satisfying the MVP configuration -/
@[lusterna]
theorem rotate_result_valid_config
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      match r with
      | core.result.Result.Ok a' => ValidConfig a'
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- ReplaceLocal rotation preserves non-local roles and sets local to the new key -/
@[lusterna]
theorem rotate_replace_local_preserves_other_roles
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hkind : request.kind = authority.RotationKind.ReplaceLocal) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      match r with
      | core.result.Result.Ok a' =>
        a'.roles.bootstrap = a.roles.bootstrap ∧
        a'.roles.service = a.roles.service ∧
        a'.roles.recovery = a.roles.recovery ∧
        a'.roles.fee = a.roles.fee ∧
        a'.roles.local = request.new_key
      | core.result.Result.Err _ => True ⦄ := by sorry

-- ─────────────────────────────────────────────────────────
-- Supporting lemmas
-- ─────────────────────────────────────────────────────────

/-- The sum of signer weights for a valid authority is exactly 4 -/
@[lusterna_lemma "pure arithmetic property of validated signer structure; no single target execution"]
theorem valid_authority_signer_weight_sum
    (a : authority.Authority)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ())) :
    a.signers.val.foldl (fun acc (s : authority.Signer) => acc + s.weight.val) 0 = 4 := by sorry

end

end GAccountCore.Spec.C01Authority
