import GAccountCore
import GAccountCore.Helpers

namespace GAccountCore.Helpers2

open g_account_core
open Aeneas Aeneas.Std Result WP
open GAccountCore.Helpers

set_option maxHeartbeats 8000000

noncomputable section

scoped macro_rules
| `(tactic| get_elem_tactic) => `(tactic| agrind)

-- ═══════════════════════════════════════════════════════════
-- contains_key spec
-- ═══════════════════════════════════════════════════════════

/- The loop iterates through keys[0..len], returning true on first match.
   Invariant: key ∉ keys[0..i]. -/
@[step]
theorem authority.contains_key_spec
    (keys : Slice authority.Key) (key : authority.Key) :
    authority.contains_key keys key ⦃ (r : Bool) => r = true ↔ key ∈ keys.val ⦄ := by
  sorry

end

end GAccountCore.Helpers2
