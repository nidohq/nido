import GAccountCore

namespace GAccountCore.Helpers

open g_account_core
open Aeneas Aeneas.Std Result WP

set_option maxHeartbeats 4000000

noncomputable section

/- Override get_elem_tactic so that a[i] auto-discharges bounds with agrind -/
scoped macro_rules
| `(tactic| get_elem_tactic) => `(tactic| agrind)

-- ═══════════════════════════════════════════════════════════
-- Discriminant-based equality specs
-- ═══════════════════════════════════════════════════════════

@[step]
theorem authority.Profile.eq_spec (self other : authority.Profile) :
    authority.Profile.Insts.CoreCmpPartialEqProfile.eq self other
      ⦃ (b : Bool) => b ↔ self = other ⦄ := by
  unfold authority.Profile.Insts.CoreCmpPartialEqProfile.eq
  simp only [spec_ok]
  cases self <;> cases other <;>
    simp [authority.Profile.read_discriminant]

@[step]
theorem authority.AccountKind.eq_spec (self other : authority.AccountKind) :
    authority.AccountKind.Insts.CoreCmpPartialEqAccountKind.eq self other
      ⦃ (b : Bool) => b ↔ self = other ⦄ := by
  unfold authority.AccountKind.Insts.CoreCmpPartialEqAccountKind.eq
  simp only [spec_ok]
  cases self <;> cases other <;>
    simp [authority.AccountKind.read_discriminant]

@[step]
theorem authority.RotationKind.eq_spec (self other : authority.RotationKind) :
    authority.RotationKind.Insts.CoreCmpPartialEqRotationKind.eq self other
      ⦃ (b : Bool) => b ↔ self = other ⦄ := by
  unfold authority.RotationKind.Insts.CoreCmpPartialEqRotationKind.eq
  simp only [spec_ok]
  cases self <;> cases other <;>
    simp [authority.RotationKind.read_discriminant]

-- ═══════════════════════════════════════════════════════════
-- Key / Array U8 equality spec
-- ═══════════════════════════════════════════════════════════

private theorem u8_ne_spec : ∀ x y : U8, core.cmp.PartialEqU8.ne x y ⦃ b => b ↔ ¬ (x = y) ⦄ := by
  intro x y
  unfold core.cmp.PartialEqU8
  simp [liftFun2, spec_ok]

/- General step spec for Array U8 N equality via PartialEqArray -/
@[step]
theorem PartialEqArrayU8.eq_spec {N : Usize} (a0 a1 : Array U8 N) :
    core.array.equality.PartialEqArray.eq core.cmp.PartialEqU8 a0 a1
      ⦃ (b : Bool) => b ↔ a0 = a1 ⦄ := by
  unfold core.array.equality.PartialEqArray.eq
  have hlen : a0.length = a1.length := by simp [Array.length]
  simp only [hlen, ↓reduceIte]
  /- Construct matching slices and use PartialEqSlice.eq_homo_spec -/
  have h := core.slice.cmp.PartialEqSlice.eq_homo_spec core.cmp.PartialEqU8
    (Slice.from a0.val (by scalar_tac)) (Slice.from a1.val (by scalar_tac)) u8_ne_spec
  unfold core.slice.cmp.PartialEqSlice.eq at h
  simp only [Slice.from_val, Slice.length, hlen, ↓reduceIte] at h
  apply spec_mono h
  intro b hb
  rw [Array.eq_iff]
  simp only [Slice.eq_iff, Slice.from_val] at hb
  exact hb

@[step]
theorem authority.Key.eq_spec (self other : authority.Key) :
    authority.Key.Insts.CoreCmpPartialEqKey.eq self other
      ⦃ (b : Bool) => b ↔ self = other ⦄ := by
  unfold authority.Key.Insts.CoreCmpPartialEqKey.eq
  exact PartialEqArrayU8.eq_spec self other

-- ═══════════════════════════════════════════════════════════
-- Signer equality spec
-- ═══════════════════════════════════════════════════════════

@[step]
theorem authority.Signer.eq_spec (self other : authority.Signer) :
    authority.Signer.Insts.CoreCmpPartialEqSigner.eq self other
      ⦃ (b : Bool) => b ↔ self = other ⦄ := by
  unfold authority.Signer.Insts.CoreCmpPartialEqSigner.eq
  by_cases hw : self.weight = other.weight
  · simp only [hw, ↓reduceIte]
    apply spec_mono (authority.Key.eq_spec self.key other.key)
    intro b hb
    constructor
    · intro hb2; have hk := hb.mp hb2; cases self; cases other; simp_all
    · intro heq; apply hb.mpr; cases self; cases other; simp_all
  · simp only [hw, ↓reduceIte, spec_ok]
    constructor
    · intro h; simp at h
    · intro heq; cases self; cases other; simp_all

-- ═══════════════════════════════════════════════════════════
-- AccountRef equality spec
-- ═══════════════════════════════════════════════════════════

@[step]
theorem authority.AccountRef.eq_spec (self other : authority.AccountRef) :
    authority.AccountRef.Insts.CoreCmpPartialEqAccountRef.eq self other
      ⦃ (b : Bool) => b ↔ self = other ⦄ := by
  unfold authority.AccountRef.Insts.CoreCmpPartialEqAccountRef.eq
  step*
  · cases self; cases other; simp_all

-- ═══════════════════════════════════════════════════════════
-- OperationBody equality spec
-- ═══════════════════════════════════════════════════════════

@[step]
theorem authority.OperationBody.eq_spec (self other : authority.OperationBody) :
    authority.OperationBody.Insts.CoreCmpPartialEqOperationBody.eq self other
      ⦃ (b : Bool) => b ↔ self = other ⦄ := by
  unfold authority.OperationBody.Insts.CoreCmpPartialEqOperationBody.eq
  cases self <;> cases other
  · -- SetSigner vs SetSigner
    simp [authority.OperationBody.read_discriminant]
    apply spec_mono (authority.Signer.eq_spec _ _)
    intro b hb; exact hb
  · -- SetSigner vs Unsupported
    simp [authority.OperationBody.read_discriminant, spec_ok]
  · -- Unsupported vs SetSigner
    simp [authority.OperationBody.read_discriminant, spec_ok]
  · -- Unsupported vs Unsupported
    simp [authority.OperationBody.read_discriminant, spec_ok]

end

end GAccountCore.Helpers
