/-
Abstract model of ONE wallet signing request, not a proof of the Rust/JS binary.
Snapshot represents immutable exact envelope bytes + pinned intent/identity.
RuntimeSound is the explicit implementation obligation that is TESTED here,
not established by this file. Key custody and browser isolation are assumptions
needed to identify every real fee signature with this model's release event.
-/
namespace SigningBoundary

abbrev Snapshot := List UInt8

inductive Phase where
  | fresh | checking (snapshot : Snapshot) | allowed (snapshot : Snapshot) | spent
  deriving DecidableEq

structure State where
  phase : Phase
  released : List Snapshot

def initial : State := ⟨.fresh, []⟩

-- Verified(q): exact approved intent, pinned passkey/Perch binding, fee policy.
-- This predicate is deliberately independent of the protocol transition rules.
variable (Verified : Snapshot → Prop) (checker : Snapshot → Bool)

inductive Step : State → State → Prop where
  | approve (q) : Step ⟨.fresh, []⟩ ⟨.checking q, []⟩
  | allow (q) (h : checker q = true) : Step ⟨.checking q, []⟩ ⟨.allowed q, []⟩
  | reject (q) : Step ⟨.checking q, []⟩ ⟨.spent, []⟩
  | cancel : Step ⟨.fresh, []⟩ ⟨.spent, []⟩
  | release (q) : Step ⟨.allowed q, []⟩ ⟨.spent, [q]⟩

inductive Reachable : State → Prop where
  | start : Reachable initial
  | next {s t} : Reachable s → Step checker s t → Reachable t

-- The release uses the retained snapshot; no replacement bytes enter this step.
theorem exact_snapshot {q : Snapshot} {t : State}
    (h : Step checker ⟨.allowed q, []⟩ t) :
    t = ⟨.spent, [q]⟩ := by
  cases h
  rfl

-- A consumed request has no outgoing edge, including after failure.
theorem spent_is_terminal {xs : List Snapshot} {t : State} :
    ¬ Step checker ⟨.spent, xs⟩ t := by
  intro h
  cases h

def Invariant (s : State) : Prop :=
  (∀ q ∈ s.released, Verified q) ∧ s.released.length ≤ 1 ∧
  (∀ q, s.phase = .allowed q → Verified q)

theorem step_preserves
    (RuntimeSound : ∀ q, checker q = true → Verified q)
    {s t : State} (safe : Invariant Verified s) (edge : Step checker s t) :
    Invariant Verified t := by
  rcases safe with ⟨oldGood, oldCount, pendingGood⟩
  cases edge with
  | approve q => simp [Invariant]
  | allow q h =>
      refine ⟨by simp, by simp, ?_⟩
      intro p hp
      cases hp
      exact RuntimeSound q h
  | reject q => simp [Invariant]
  | cancel => simp [Invariant]
  | release q =>
      have good := pendingGood q rfl
      simpa [Invariant] using good

theorem reachable_safe
    (RuntimeSound : ∀ q, checker q = true → Verified q)
    {s : State} (h : Reachable checker s) : Invariant Verified s := by
  induction h with
  | start => simp [initial, Invariant]
  | next previous edge ih => exact step_preserves Verified checker RuntimeSound ih edge

theorem released_implies_verified
    (RuntimeSound : ∀ q, checker q = true → Verified q)
    {s : State} (h : Reachable checker s) {q : Snapshot} (released : q ∈ s.released) :
    Verified q := (reachable_safe Verified checker RuntimeSound h).1 q released

theorem at_most_one_release
    {s : State} (h : Reachable checker s) : s.released.length ≤ 1 := by
  cases h with
  | start => decide
  | next previous edge => cases edge <;> simp

#print axioms exact_snapshot
#print axioms spent_is_terminal
#print axioms released_implies_verified
#print axioms at_most_one_release
end SigningBoundary
