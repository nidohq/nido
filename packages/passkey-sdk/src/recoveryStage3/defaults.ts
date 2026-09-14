//! Shared enrollment defaults for the wallet's SIMPLIFIED Stage 3 forms
//! (guardian-only via `policyBlocks/multisigRecovery.ts`, ZK-only via the
//! frontend's `runZkEnrollment`). Both forms must use IDENTICAL values for
//! every field `RecoveryController::reconfigure` requires to match exactly
//! between the existing and proposed config — whichever evidence factor a
//! given account enrolls SECOND goes through `reconfigure`, not `enroll`,
//! and `reconfigure` rejects any change to `baseline_doc_hash`/`delay_secs`/
//! `expiry_secs`/`max_cancels`/`pending_activity_policy`/`profile`. Defining
//! these once here (rather than copy-pasted per form) makes that agreement
//! structural instead of a convention two call sites could drift out of.
import { sha256 } from '@noble/hashes/sha2.js';

/** `RecoveryConfig.baseline_doc_hash` is only ever checked against for a
 *  `Compromise`-action attempt. Neither simplified form (guardian-only nor
 *  ZK-only enrollment) exposes a `Compromise` UI path — only `LostKey`
 *  (device-loss) recovery, whose target is derived from the account's
 *  CURRENT live document/rules at `begin_attempt` time, never from this
 *  field. So this is a documented, inert placeholder, not a real
 *  commitment. Wiring a genuine baseline (and a `Compromise` UI path)
 *  through these simplified forms is out of scope — use `recover-v3` for
 *  that, which collects a real baseline document. */
export const NO_BASELINE_DOC_SENTINEL: Uint8Array = sha256(
  new TextEncoder().encode('nido-guardian-only: no-baseline-doc'),
);

/** `enroll`/`reconfigure` require an explicit `pending_activity_policy` —
 *  TRANSITION_SPEC.md §10 / follow-up.md §7 are explicit that NEITHER
 *  `Freeze` NOR `Continue` is spec-mandated as a default. These simplified
 *  forms have no UI surface to ask the question, so they make an explicit,
 *  documented implementer choice — `Freeze`, the more conservative of the
 *  two for a security-recovery feature (blocks ordinary account-authorized
 *  rule/document writes while a recovery attempt is pending, favoring NOT
 *  letting an attacker who still holds device access neutralize a recovery
 *  in progress). This is an implementer default at the UI layer, not a
 *  silently-chosen spec default — the full `recover-v3` form lets an
 *  operator choose explicitly.
 */
export const PENDING_ACTIVITY_POLICY_DEFAULT = 'Freeze' as const;

// Testnet-appropriate ordinary tunables (NOT the §7-gated axis above —
// TRANSITION_SPEC.md only withholds a default for
// `pendingActivityPolicy`/`policyWriteConflictPolicy`). 10 minutes to
// collect evidence once an attempt begins, 24h before an unpromoted attempt
// expires, 3 cancels before the attempt is permanently dead. Production
// values require the same deliberate-choice treatment DEPLOYED.md already
// gives M1's mainnet spec numbers — not invented here.
export const DELAY_SECS_DEFAULT = 600;
export const EXPIRY_SECS_DEFAULT = 86_400;
export const MAX_CANCELS_DEFAULT = 3;
