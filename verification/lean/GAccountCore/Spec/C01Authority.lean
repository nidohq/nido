import GAccountCore
import GAccountCore.LusternaSchemas

namespace GAccountCore.Spec.C01Authority

open g_account_core
open Aeneas Aeneas.Std Result
open Classical

noncomputable section

-- ═══════════════════════════════════════════════════════════
-- Helper definitions
-- ═══════════════════════════════════════════════════════════

/-- All five role keys are pairwise distinct. -/
def RolesAllDistinct (r : authority.Roles) : Prop :=
  r.bootstrap ≠ r.local ∧ r.bootstrap ≠ r.service ∧
  r.bootstrap ≠ r.recovery ∧ r.bootstrap ≠ r.fee ∧
  r.local ≠ r.service ∧ r.local ≠ r.recovery ∧ r.local ≠ r.fee ∧
  r.service ≠ r.recovery ∧ r.service ≠ r.fee ∧
  r.recovery ≠ r.fee

/-- The MVP self-directed configuration conditions that validate checks.
    Includes exact signer-set constraint: {local/2, service/1, recovery/1}. -/
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

/-- new_key collides with none of the five current role keys. -/
def NewKeyFresh (new_key : authority.Key) (roles : authority.Roles) : Prop :=
  new_key ≠ roles.bootstrap ∧ new_key ≠ roles.local ∧
  new_key ≠ roles.service ∧ new_key ≠ roles.recovery ∧ new_key ≠ roles.fee

/-- Expected signer weight for a rotation kind. -/
def kindWeight (k : authority.RotationKind) : Std.U8 :=
  match k with
  | .ReplaceLocal | .RecoverLocal => 2#u8
  | .ReplaceService | .ReplaceRecovery => 1#u8

/-- The role key being replaced for a given rotation kind. -/
def kindOldKey (k : authority.RotationKind) (roles : authority.Roles) : authority.Key :=
  match k with
  | .ReplaceLocal | .RecoverLocal => roles.local
  | .ReplaceService => roles.service
  | .ReplaceRecovery => roles.recovery

/-- The two operations a well-formed rotation request must carry. -/
def ExpectedOps (new_key old_key : authority.Key) (weight : Std.U8) :
    List authority.Operation :=
  [ { source := none, body := authority.OperationBody.SetSigner ⟨new_key, weight⟩ },
    { source := none, body := authority.OperationBody.SetSigner ⟨old_key, 0#u8⟩ } ]

/-- A rotation request is structurally valid w.r.t. authority `a`. -/
def WellFormedRequest (a : authority.Authority) (req : authority.Rotation) : Prop :=
  req.account = a.account ∧
  req.transaction_source = a.account.address ∧
  req.old_key = kindOldKey req.kind a.roles ∧
  NewKeyFresh req.new_key a.roles ∧
  req.operations.val = ExpectedOps req.new_key req.old_key (kindWeight req.kind)

/-- The evidence keys required for each rotation kind (pure). -/
def KindEvidenceMet (k : authority.RotationKind) (roles : authority.Roles)
    (evidence : Slice authority.Key) : Prop :=
  match k with
  | .ReplaceLocal   => roles.local ∈ evidence.val
  | .RecoverLocal   => roles.service ∈ evidence.val ∧ roles.recovery ∈ evidence.val
  | .ReplaceService => roles.local ∈ evidence.val
  | .ReplaceRecovery => roles.local ∈ evidence.val

/-- The roles structure after a rotation applies. -/
def postRotationRoles (kind : authority.RotationKind) (roles : authority.Roles)
    (new_key : authority.Key) : authority.Roles :=
  match kind with
  | .ReplaceLocal   => { roles with «local» := new_key }
  | .RecoverLocal   => { roles with «local» := new_key }
  | .ReplaceService => { roles with service := new_key }
  | .ReplaceRecovery => { roles with recovery := new_key }

/-- Element-wise signer replacement: the structural map that rotate's loop applies.
    Each signer whose key matches the old role key is replaced; all others are
    preserved in position.  Uses Classical decidability on key equality. -/
def signerListAfterRotation (signers : List authority.Signer) (old_key new_key : authority.Key)
    (weight : Std.U8) : List authority.Signer :=
  signers.map (fun s => if s.key = old_key then ⟨new_key, weight⟩ else s)

-- ═══════════════════════════════════════════════════════════
-- G-02  validate — iff characterisation, refusal variants,
--       positive witness
-- ═══════════════════════════════════════════════════════════

/-- validate returns Ok(()) **if and only if** ValidConfig holds.
    The iff excludes an always-refuse implementation.  (G-02) -/
@[lusterna]
theorem validate_iff_valid_config (a : authority.Authority) :
    authority.validate a ⦃ (r : core.result.Result Unit authority.Refusal) =>
      r = core.result.Result.Ok () ↔ ValidConfig a ⦄ := by sorry

/-- Profile is the first check: wrong profile ⟹ UnsupportedProfile.  (G-02) -/
@[lusterna]
theorem validate_rejects_wrong_profile
    (a : authority.Authority)
    (h : a.profile ≠ authority.Profile.SelfDirected) :
    authority.validate a ⦃ (r : core.result.Result Unit authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.UnsupportedProfile ⦄ := by sorry

/-- Account kind is checked after profile.  (G-02) -/
@[lusterna]
theorem validate_rejects_wrong_kind
    (a : authority.Authority)
    (hp : a.profile = authority.Profile.SelfDirected)
    (hk : a.account.kind ≠ authority.AccountKind.StellarG) :
    authority.validate a ⦃ (r : core.result.Result Unit authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.InvalidAccount ⦄ := by sorry

/-- Master weight checked after profile/account/address.  (G-02) -/
@[lusterna]
theorem validate_rejects_wrong_master
    (a : authority.Authority)
    (hp : a.profile = authority.Profile.SelfDirected)
    (hk : a.account.kind = authority.AccountKind.StellarG)
    (ha : a.account.address = a.roles.bootstrap)
    (hm : a.master_weight ≠ 0#u8) :
    authority.validate a ⦃ (r : core.result.Result Unit authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.InvalidMaster ⦄ := by sorry

/-- Aliased roles rejected after thresholds pass.  (G-02) -/
@[lusterna]
theorem validate_rejects_aliased_roles
    (a : authority.Authority)
    (hp : a.profile = authority.Profile.SelfDirected)
    (hk : a.account.kind = authority.AccountKind.StellarG)
    (ha : a.account.address = a.roles.bootstrap)
    (hm : a.master_weight = 0#u8)
    (ht : a.thresholds.low = 2#u8 ∧ a.thresholds.medium = 2#u8 ∧ a.thresholds.high = 2#u8)
    (hr : ¬ RolesAllDistinct a.roles) :
    authority.validate a ⦃ (r : core.result.Result Unit authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.AliasedRoles ⦄ := by sorry

/-- roles_distinct correctly reflects pairwise distinctness.  (G-02) -/
@[lusterna]
theorem roles_distinct_spec (r : authority.Roles) :
    authority.roles_distinct r ⦃ (b : Bool) =>
      b = true ↔ RolesAllDistinct r ⦄ := by sorry

/-- Positive witness: ValidConfig is satisfiable from five pairwise-distinct keys.
    Constructs a concrete Authority value with StellarG, SelfDirected, master 0,
    thresholds 2, and signer list [local/2, service/1, recovery/1].  (G-02) -/
@[lusterna_lemma "G-02 positive witness: ValidConfig constructible from structural distinctness"]
theorem valid_config_inhabited
    (tenant network : Array Std.U8 32#usize)
    (kB kL kS kR kF : authority.Key)
    (hdist : RolesAllDistinct ⟨kB, kL, kS, kR, kF⟩) :
    let roles : authority.Roles := ⟨kB, kL, kS, kR, kF⟩
    ValidConfig {
      account := ⟨tenant, network, authority.AccountKind.StellarG, kB⟩,
      profile := authority.Profile.SelfDirected,
      roles := roles,
      master_weight := 0#u8,
      thresholds := ⟨2#u8, 2#u8, 2#u8⟩,
      signers := alloc.vec.Vec.from
        [⟨kL, 2#u8⟩, ⟨kS, 1#u8⟩, ⟨kR, 1#u8⟩] (by sorry)
    } := by sorry

/-- Five pairwise-distinct keys exist in the Key type (Array U8 32).
    Combined with valid_config_inhabited and validate_iff_valid_config,
    this proves validate can return Ok.  (G-02) -/
@[lusterna_lemma "G-02 inhabitedness: Key type has at least five distinct values"]
theorem five_distinct_keys_exist :
    ∃ kB kL kS kR kF : authority.Key,
      RolesAllDistinct ⟨kB, kL, kS, kR, kF⟩ := by sorry

-- ═══════════════════════════════════════════════════════════
-- G-01  contains_key, authorization_weight, can_authorize
-- ═══════════════════════════════════════════════════════════

/-- Full membership bridge for contains_key.  (G-01) -/
@[lusterna]
theorem contains_key_spec
    (keys : Slice authority.Key) (key : authority.Key) :
    authority.contains_key keys key ⦃ (r : Bool) =>
      r = true ↔ key ∈ keys.val ⦄ := by sorry

/-- Specialisation: empty slice ⟹ false.  (G-01) -/
@[lusterna]
theorem contains_key_empty
    (keys : Slice authority.Key) (key : authority.Key)
    (hempty : keys.length = 0) :
    authority.contains_key keys key ⦃ (r : Bool) =>
      r = false ⦄ := by sorry

/-- Exact weight formula.  For a valid authority the function returns Ok and the
    weight is the sum of matched signer weights — each signer counted at most once
    regardless of duplicate evidence.  The if-then-else uses Classical decidability
    over the pure ∈ predicate.  (G-01) -/
@[lusterna]
theorem authorization_weight_exact
    (a : authority.Authority) (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ())) :
    authority.authorization_weight a evidence
      ⦃ (r : core.result.Result Std.U16 authority.Refusal) =>
      ∃ w, r = core.result.Result.Ok w ∧
        w.val = (if a.roles.local ∈ evidence.val then 2 else 0) +
                (if a.roles.service ∈ evidence.val then 1 else 0) +
                (if a.roles.recovery ∈ evidence.val then 1 else 0) ⦄ := by sorry

/-- Upper bound (unconditional — no validity precondition).  (G-01) -/
@[lusterna]
theorem authorization_weight_bounded
    (a : authority.Authority) (evidence : Slice authority.Key) :
    authority.authorization_weight a evidence
      ⦃ (r : core.result.Result Std.U16 authority.Refusal) =>
      match r with
      | core.result.Result.Ok w => w.val ≤ 4
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- Full iff for can_authorize: authorized ↔ local OR (service ∧ recovery).
    Returns Ok for every valid configuration.  (G-01) -/
@[lusterna]
theorem can_authorize_iff
    (a : authority.Authority) (evidence : Slice authority.Key)
    (category : authority.Category)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ())) :
    authority.can_authorize a evidence category
      ⦃ (r : core.result.Result Bool authority.Refusal) =>
      ∃ b, r = core.result.Result.Ok b ∧
        (b = true ↔
          a.roles.local ∈ evidence.val ∨
          (a.roles.service ∈ evidence.val ∧ a.roles.recovery ∈ evidence.val)) ⦄ := by sorry

/-- Empty evidence ⟹ denied.  (G-01) -/
@[lusterna]
theorem can_authorize_empty_evidence_denies
    (a : authority.Authority) (evidence : Slice authority.Key)
    (category : authority.Category)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hempty : evidence.length = 0) :
    authority.can_authorize a evidence category
      ⦃ (r : core.result.Result Bool authority.Refusal) =>
      r = core.result.Result.Ok false ⦄ := by sorry

/-- Service key alone (weight 1 < threshold 2) ⟹ denied.  (G-01) -/
@[lusterna]
theorem can_authorize_only_service_denies
    (a : authority.Authority) (evidence : Slice authority.Key)
    (category : authority.Category)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hservice : a.roles.service ∈ evidence.val)
    (hno_local : a.roles.local ∉ evidence.val)
    (hno_recovery : a.roles.recovery ∉ evidence.val) :
    authority.can_authorize a evidence category
      ⦃ (r : core.result.Result Bool authority.Refusal) =>
      r = core.result.Result.Ok false ⦄ := by sorry

-- ═══════════════════════════════════════════════════════════
-- G-03  rotate — success, signer frame, preservation,
--       rejections
-- ═══════════════════════════════════════════════════════════

/-- General rotation success for ALL four kinds.  Well-formed request + correct
    evidence ⟹ Ok with exact post-state: roles updated per kind, signer list
    updated by positional map, account/profile/master_weight/thresholds preserved,
    result satisfies ValidConfig.  (G-03) -/
@[lusterna]
theorem rotate_succeeds
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hwf : WellFormedRequest a request)
    (hev : KindEvidenceMet request.kind a.roles evidence) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      ∃ a', r = core.result.Result.Ok a' ∧
        a'.account = a.account ∧
        a'.profile = a.profile ∧
        a'.master_weight = a.master_weight ∧
        a'.thresholds = a.thresholds ∧
        a'.roles = postRotationRoles request.kind a.roles request.new_key ∧
        a'.signers.val = signerListAfterRotation a.signers.val
          (kindOldKey request.kind a.roles) request.new_key (kindWeight request.kind) ∧
        ValidConfig a' ⦄ := by sorry

/-- Unconditional signer-list frame for any successful rotate — no WellFormedRequest
    premise.  Preserves original signer positions, unchanged entries and weights.
    Composition lemmas can use this directly.  (G-03) -/
@[lusterna]
theorem rotate_signer_frame
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      match r with
      | core.result.Result.Ok a' =>
        a'.signers.val = signerListAfterRotation a.signers.val
          (kindOldKey request.kind a.roles) request.new_key (kindWeight request.kind) ∧
        a'.account = a.account ∧
        a'.profile = a.profile ∧
        a'.master_weight = a.master_weight ∧
        a'.thresholds = a.thresholds ∧
        a'.roles = postRotationRoles request.kind a.roles request.new_key
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- RecoverLocal explicitly: service + recovery evidence suffices;
    extra local-key evidence is NOT forbidden.  (G-03) -/
@[lusterna]
theorem rotate_recover_local_succeeds
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hwf : WellFormedRequest a request)
    (hkind : request.kind = authority.RotationKind.RecoverLocal)
    (hservice : a.roles.service ∈ evidence.val)
    (hrecovery : a.roles.recovery ∈ evidence.val) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      ∃ a', r = core.result.Result.Ok a' ∧
        a'.roles.local = request.new_key ∧
        a'.roles.service = a.roles.service ∧
        a'.roles.recovery = a.roles.recovery ∧
        a'.roles.bootstrap = a.roles.bootstrap ∧
        a'.roles.fee = a.roles.fee ∧
        ValidConfig a' ⦄ := by sorry

/-- Full AccountRef preservation (tenant, network, kind, address).  (G-03) -/
@[lusterna]
theorem rotate_preserves_full_account_ref
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      match r with
      | core.result.Result.Ok a' =>
        a'.account.tenant = a.account.tenant ∧
        a'.account.network = a.account.network ∧
        a'.account.kind = a.account.kind ∧
        a'.account.address = a.account.address
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- Any successful rotate produces an authority satisfying ValidConfig
    (unconditional — no WellFormedRequest precondition needed).  (G-03) -/
@[lusterna]
theorem rotate_result_valid_config
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      match r with
      | core.result.Result.Ok a' => ValidConfig a'
      | core.result.Result.Err _ => True ⦄ := by sorry

/-- WrongAccount: request.account ≠ a.account.  (G-03) -/
@[lusterna]
theorem rotate_rejects_wrong_account
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (h : request.account ≠ a.account) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.WrongAccount ⦄ := by sorry

/-- WrongSource: transaction_source ≠ account.address.  (G-03) -/
@[lusterna]
theorem rotate_rejects_wrong_source
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hacct : request.account = a.account)
    (h : request.transaction_source ≠ a.account.address) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.WrongSource ⦄ := by sorry

/-- WrongOldKey: old_key does not match the role for the kind.  (G-03) -/
@[lusterna]
theorem rotate_rejects_wrong_old_key
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hacct : request.account = a.account)
    (hsrc : request.transaction_source = a.account.address)
    (h : request.old_key ≠ kindOldKey request.kind a.roles) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.WrongOldKey ⦄ := by sorry

/-- InvalidNewKey: new_key collides with any of the five role keys.  (G-03) -/
@[lusterna]
theorem rotate_rejects_invalid_new_key
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hacct : request.account = a.account)
    (hsrc : request.transaction_source = a.account.address)
    (hold : request.old_key = kindOldKey request.kind a.roles)
    (h : request.new_key = a.roles.bootstrap ∨ request.new_key = a.roles.local ∨
         request.new_key = a.roles.service ∨ request.new_key = a.roles.recovery ∨
         request.new_key = a.roles.fee) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.InvalidNewKey ⦄ := by sorry

/-- InvalidOperations: ops don't match expected template.  (G-03) -/
@[lusterna]
theorem rotate_rejects_invalid_operations
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hacct : request.account = a.account)
    (hsrc : request.transaction_source = a.account.address)
    (hold : request.old_key = kindOldKey request.kind a.roles)
    (hfresh : NewKeyFresh request.new_key a.roles)
    (hops : request.operations.val ≠
      ExpectedOps request.new_key (kindOldKey request.kind a.roles) (kindWeight request.kind)) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.InvalidOperations ⦄ := by sorry

/-- InsufficientEvidence: well-formed request but evidence lacks required keys.  (G-03) -/
@[lusterna]
theorem rotate_rejects_insufficient_evidence
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hwf : WellFormedRequest a request)
    (hev : ¬ KindEvidenceMet request.kind a.roles evidence) :
    authority.rotate a request evidence
      ⦃ (r : core.result.Result authority.Authority authority.Refusal) =>
      r = core.result.Result.Err authority.Refusal.InsufficientEvidence ⦄ := by sorry

-- ═══════════════════════════════════════════════════════════
-- G-04  coalition preservation, retired-key weight,
--       recovery, unrecoverability
--
-- These are @[lusterna_lemma] because they compose two
-- target executions (rotate then can_authorize / authorization_weight).
-- They must eventually be proved and dependency-checked;
-- they are NOT checked WP triples by label.
-- ═══════════════════════════════════════════════════════════

/-- After ReplaceLocal the surviving service+recovery coalition still authorizes.  (G-04) -/
@[lusterna_lemma "G-04 composition: rotate post-state + can_authorize; two target executions"]
theorem coalition_sr_after_replace_local
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev new_ev : Slice authority.Key) (cat : authority.Category)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hkind : request.kind = authority.RotationKind.ReplaceLocal)
    (hservice : a.roles.service ∈ new_ev.val)
    (hrecovery : a.roles.recovery ∈ new_ev.val) :
    authority.can_authorize a' new_ev cat = ok (core.result.Result.Ok true) := by sorry

/-- After RecoverLocal the surviving service+recovery coalition still authorizes.  (G-04) -/
@[lusterna_lemma "G-04 composition: S+R coalition survives RecoverLocal; two target executions"]
theorem coalition_sr_after_recover_local
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev new_ev : Slice authority.Key) (cat : authority.Category)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hkind : request.kind = authority.RotationKind.RecoverLocal)
    (hservice : a.roles.service ∈ new_ev.val)
    (hrecovery : a.roles.recovery ∈ new_ev.val) :
    authority.can_authorize a' new_ev cat = ok (core.result.Result.Ok true) := by sorry

/-- After Replace/RecoverLocal the new local key authorizes (weight 2 ≥ threshold 2).  (G-04) -/
@[lusterna_lemma "G-04 composition: rotate post-state gives new key signer status"]
theorem new_key_authorizes_after_local_rotation
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev new_ev : Slice authority.Key) (cat : authority.Category)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hkind : request.kind = authority.RotationKind.ReplaceLocal ∨
             request.kind = authority.RotationKind.RecoverLocal)
    (hnew : request.new_key ∈ new_ev.val) :
    authority.can_authorize a' new_ev cat = ok (core.result.Result.Ok true) := by sorry

/-- After ReplaceLocal: evidence containing only the old local key (no post-rotation
    signer keys) yields authorization denied (weight 0 < threshold 2).
    Note: this is a threshold-denial result; the exact zero-weight claim is
    retired_key_zero_weight below.  (G-04) -/
@[lusterna_lemma "G-04 composition: retired key cannot authorize alone"]
theorem retired_key_denial_replace_local
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev old_ev : Slice authority.Key) (cat : authority.Category)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hkind : request.kind = authority.RotationKind.ReplaceLocal)
    (hold : a.roles.local ∈ old_ev.val)
    (hno_new : request.new_key ∉ old_ev.val)
    (hno_svc : a.roles.service ∉ old_ev.val)
    (hno_rec : a.roles.recovery ∉ old_ev.val) :
    authority.can_authorize a' old_ev cat = ok (core.result.Result.Ok false) := by sorry

/-- Grounded zero-weight claim: after a successful rotation (any kind), evidence
    containing only the retired key and none of the post-rotation signer role keys
    yields exactly authorization_weight = Ok(0).  Derived from authorization_weight_exact
    and the signer frame.  (G-04) -/
@[lusterna_lemma "G-04 composition: retired key yields exact zero weight via authorization_weight"]
theorem retired_key_zero_weight
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev old_ev : Slice authority.Key)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hold : kindOldKey request.kind a.roles ∈ old_ev.val)
    -- None of the post-rotation signer role keys appear in old_ev
    (hno_post_local :
      (postRotationRoles request.kind a.roles request.new_key).local ∉ old_ev.val)
    (hno_post_service :
      (postRotationRoles request.kind a.roles request.new_key).service ∉ old_ev.val)
    (hno_post_recovery :
      (postRotationRoles request.kind a.roles request.new_key).recovery ∉ old_ev.val) :
    authority.authorization_weight a' old_ev
      = ok (core.result.Result.Ok 0#u16) := by sorry

/-- After ReplaceService, local still authorizes alone.  (G-04) -/
@[lusterna_lemma "G-04 composition: local coalition survives service replacement"]
theorem local_authorizes_after_replace_service
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev new_ev : Slice authority.Key) (cat : authority.Category)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hkind : request.kind = authority.RotationKind.ReplaceService)
    (hlocal : a.roles.local ∈ new_ev.val) :
    authority.can_authorize a' new_ev cat = ok (core.result.Result.Ok true) := by sorry

/-- After ReplaceRecovery, local still authorizes alone.  (G-04) -/
@[lusterna_lemma "G-04 composition: local coalition survives recovery replacement"]
theorem local_authorizes_after_replace_recovery
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev new_ev : Slice authority.Key) (cat : authority.Category)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hkind : request.kind = authority.RotationKind.ReplaceRecovery)
    (hlocal : a.roles.local ∈ new_ev.val) :
    authority.can_authorize a' new_ev cat = ok (core.result.Result.Ok true) := by sorry

/-- After ReplaceService, new service + existing recovery authorizes.  (G-04) -/
@[lusterna_lemma "G-04 composition: new service + surviving recovery forms coalition"]
theorem new_sr_coalition_after_replace_service
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev new_ev : Slice authority.Key) (cat : authority.Category)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hkind : request.kind = authority.RotationKind.ReplaceService)
    (hnew_svc : request.new_key ∈ new_ev.val)
    (hrec : a.roles.recovery ∈ new_ev.val) :
    authority.can_authorize a' new_ev cat = ok (core.result.Result.Ok true) := by sorry

/-- After ReplaceRecovery, existing service + new recovery authorizes.  (G-04) -/
@[lusterna_lemma "G-04 composition: surviving service + new recovery forms coalition"]
theorem new_sr_coalition_after_replace_recovery
    (a a' : authority.Authority) (request : authority.Rotation)
    (rot_ev new_ev : Slice authority.Key) (cat : authority.Category)
    (hrot : authority.rotate a request rot_ev = ok (core.result.Result.Ok a'))
    (hkind : request.kind = authority.RotationKind.ReplaceRecovery)
    (hsvc : a.roles.service ∈ new_ev.val)
    (hnew_rec : request.new_key ∈ new_ev.val) :
    authority.can_authorize a' new_ev cat = ok (core.result.Result.Ok true) := by sorry

/-- Recovery: local lost, service+recovery survive ⟹ RecoverLocal succeeds.  (G-04) -/
@[lusterna_lemma "G-04 recovery path: S+R holders can restore local"]
theorem recovery_recover_local
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hwf : WellFormedRequest a request)
    (hkind : request.kind = authority.RotationKind.RecoverLocal)
    (hservice : a.roles.service ∈ evidence.val)
    (hrecovery : a.roles.recovery ∈ evidence.val) :
    ∃ a', authority.rotate a request evidence = ok (core.result.Result.Ok a') := by sorry

/-- Recovery: local survives, service lost ⟹ ReplaceService succeeds.  (G-04) -/
@[lusterna_lemma "G-04 recovery path: local-holder can replace lost service"]
theorem recovery_replace_service
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hwf : WellFormedRequest a request)
    (hkind : request.kind = authority.RotationKind.ReplaceService)
    (hlocal : a.roles.local ∈ evidence.val) :
    ∃ a', authority.rotate a request evidence = ok (core.result.Result.Ok a') := by sorry

/-- Recovery: local survives, recovery lost ⟹ ReplaceRecovery succeeds.  (G-04) -/
@[lusterna_lemma "G-04 recovery path: local-holder can replace lost recovery"]
theorem recovery_replace_recovery
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hwf : WellFormedRequest a request)
    (hkind : request.kind = authority.RotationKind.ReplaceRecovery)
    (hlocal : a.roles.local ∈ evidence.val) :
    ∃ a', authority.rotate a request evidence = ok (core.result.Result.Ok a') := by sorry

/-- Unrecoverable: local AND service both unavailable ⟹ no rotation succeeds.  (G-04)
    Without local: ReplaceLocal/ReplaceService/ReplaceRecovery all need local evidence.
    Without service: RecoverLocal needs service+recovery.  -/
@[lusterna_lemma "G-04 unrecoverability: two-key loss blocks all rotation kinds"]
theorem unrecoverable_local_service_lost
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hwf : WellFormedRequest a request)
    (hno_local : a.roles.local ∉ evidence.val)
    (hno_service : a.roles.service ∉ evidence.val) :
    ∃ e, authority.rotate a request evidence = ok (core.result.Result.Err e) := by sorry

/-- Unrecoverable: local AND recovery both unavailable ⟹ no rotation succeeds.  (G-04) -/
@[lusterna_lemma "G-04 unrecoverability: two-key loss blocks all rotation kinds"]
theorem unrecoverable_local_recovery_lost
    (a : authority.Authority) (request : authority.Rotation)
    (evidence : Slice authority.Key)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ()))
    (hwf : WellFormedRequest a request)
    (hno_local : a.roles.local ∉ evidence.val)
    (hno_recovery : a.roles.recovery ∉ evidence.val) :
    ∃ e, authority.rotate a request evidence = ok (core.result.Result.Err e) := by sorry

-- ═══════════════════════════════════════════════════════════
-- Supporting lemmas
-- ═══════════════════════════════════════════════════════════

/-- The sum of signer weights for a valid authority is exactly 4.  -/
@[lusterna_lemma "pure arithmetic over validated signer structure; no single target execution"]
theorem valid_authority_signer_weight_sum
    (a : authority.Authority)
    (hvalid : authority.validate a = ok (core.result.Result.Ok ())) :
    a.signers.val.foldl (fun acc (s : authority.Signer) => acc + s.weight.val) 0 = 4 := by sorry

end

end GAccountCore.Spec.C01Authority
