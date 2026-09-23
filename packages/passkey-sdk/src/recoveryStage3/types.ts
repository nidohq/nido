//! Friendly input types for the recovery SDK built on `@nidohq/recovery-controller`.
//! These are NOT the generated bindings' wire types directly
//! (those use `{tag, values}` enum shapes and raw `Buffer`s, matching
//! Soroban's ScVal conversion) — this module's job is to accept plain,
//! ergonomic JS/TS values (string enum literals, hex strings or bytes) and
//! map them onto the exact `RecoveryConfig` field shape
//! `contracts/recovery-controller/src/types.rs` defines (see `config.ts`).
export type {
  RecoveryConfig,
  RecoveryAction as RecoveryActionScVal,
  Attempt,
  AttemptState,
} from '@nidohq/recovery-controller';

/** Friendly mirror of `contracts/recovery-controller/src/types.rs::AuthMode`. */
export type AuthModeInput = 'GuardianOnly' | 'ZkOnly' | 'Combined';

/** Friendly mirror of `types.rs::Profile`. Not independently enforced by
 *  this module (no `reconfigure` entry point) — see the crate's "Known
 *  limits"; carried through only because it's part of the reviewable
 *  enrollment commitment. */
export type ProfileInput = 'Loss' | 'Protected';

/** Friendly mirror of `types.rs::PendingActivityPolicy`. `'Restrict'` is a
 *  real, type-level choice that `enroll` always refuses
 *  (`Error::UnresolvedPolicyBranch`) — deliberately not a default. */
export type PendingActivityPolicyInput = 'Freeze' | 'Continue' | 'Restrict';

/** Friendly mirror of `types.rs::RecoveryAction` (which target-document
 *  construction rule an attempt uses — `TRANSITION_SPEC.md` §6/§4.2). */
export type RecoveryActionInput = 'LostKey' | 'Compromise';

/**
 * Ergonomic constructor input for a `RecoveryConfig`
 * (`contracts/recovery-controller/src/types.rs::RecoveryConfig`) — field
 * names/types mirror the Rust struct exactly except: enums are plain string
 * literals (mapped to `{tag, values}` by `buildRecoveryConfig`), hashes
 * accept hex strings OR bytes, and numeric fields accept `number | bigint`.
 */
export interface RecoveryConfigInput {
  mode: AuthModeInput;
  profile: ProfileInput;
  /** G/C-address guardians. Non-empty (with `guardianThreshold` in
   *  `1..=guardians.length`) for `GuardianOnly`/`Combined`; MUST be empty
   *  for `ZkOnly` (`enroll` enforces this — `Error::ModeConfigMismatch`). */
  guardians: string[];
  guardianThreshold: number;
  /** Required for `ZkOnly`/`Combined`; MUST be absent for `GuardianOnly`. */
  verifier?: string;
  /** Required iff `verifier` is — the `nido-zk-recovery` pool this
   *  account's enrollment secret was inserted into (via THAT pool's own
   *  `insert_for`, called by the caller BEFORE `enroll` — this SDK does not
   *  do that insertion for you; see `@nidohq/passkey-sdk`'s
   *  `commitmentForCreation`/`ZkRecoveryClient.insert_for`). */
  zkPool?: string;
  /** Raw network passphrase STRING (e.g. `"Test SDF Network ; September
   *  2015"`) — encoded to UTF-8 bytes for the contract, which sha256's it
   *  internally. */
  networkPassphrase: string;
  /** The approved baseline document's canonical hash (hex string, with or
   *  without `0x`, or 32 raw bytes). `Compromise` attempts must target this
   *  exact hash plus replacements. */
  baselineDocHash: Uint8Array | string;
  delaySecs: number | bigint;
  expirySecs: number | bigint;
  maxCancels: number;
  /** Defaults to `1` — no `reconfigure` entry point exists, so this only
   *  ever needs to be `1` for a fresh enrollment. */
  version?: number;
  pendingActivityPolicy: PendingActivityPolicyInput;
}

/** One role's credential replacement for a target-document construction
 *  (`TRANSITION_SPEC.md` §6-§7): the signer `id` (role) named by
 *  `signerId` gets its declaration swapped for `newSigner`. The document's
 *  RULES (which reference signer ids, not raw keys) are therefore
 *  automatically re-bound to the new credential without needing any rule
 *  edits — only the `signers` array entry changes. */
export interface CredentialReplacement {
  /** The `PolicyDoc.signers[].id` this replacement targets. Must already
   *  exist in the source document, or the replacement is refused
   *  (`STALE_REPLACEMENT`-equivalent — see `targetDoc.ts`). */
  signerId: string;
  /** The new credential to install at that signer id — either an external
   *  passkey (`verifier` contract + hex `key`) or a delegated smart-account
   *  address. Mirrors perch's `SignerDecl` shape (minus `id`, which this
   *  replacement's own `signerId` supplies). */
  newSigner: { verifier: string; key: string } | { address: string };
}
