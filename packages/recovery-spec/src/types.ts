// Stage 1 reference domain model for Perch/Nido recovery.
// Companion to docs/recovery/TRANSITION_SPEC.md — read that first.
// This is a spike-lean *reference model*, not production code: no crypto, no
// on-chain state, no contracts. Documents are a minimal toy shape, just
// enough to make target-document construction and baseline-replacement rules
// executable and testable.

export type AuthMode = "guardians" | "zk" | "combined";
export type Profile = "loss" | "protected";
export type RecoveryAction = "lost-key" | "compromise";

// follow-up.md §5.3 proposal-commitment "action": recovery actions plus the
// two other authorized-mutation domains that need their own action-domain
// separation (§2.2 cancellation matrix; §2.1 protected reconfiguration).
export type CommitmentAction = RecoveryAction | "cancel" | "reconfigure";

// --- Section 7 (OPEN GATE) -------------------------------------------------
// follow-up.md §7 is explicitly unresolved: "No freeze or continue default
// selected." Both types below are REQUIRED fields on RecoveryConfig with no
// default value anywhere in this package — every caller (including every
// test) must pick a branch explicitly. "restrict" and "other" are left
// symbolic per the brief: they are distinct, deliberately-unimplemented
// branches (see model.ts), never silently aliased to another branch.
export type PendingActivityPolicy = "freeze" | "continue" | "restrict";
export type PolicyWriteConflictPolicy = "block" | "invalidate-attempt" | "other";
// ---------------------------------------------------------------------------

export interface GuardianSet {
  guardians: string[];
  threshold: number;
}

export interface VerifierConfig {
  address: string;
  vkCommitment: string;
}

export interface ToyDocument {
  docHash: string;
  signers: Record<string, string>; // role -> credentialId
}

export interface Baseline {
  id: string;
  doc: ToyDocument;
  replaceableRoles: string[];
}

export interface RecoveryConfig {
  version: number;
  mode: AuthMode;
  profile: Profile;
  guardianSet?: GuardianSet; // required iff mode is "guardians" or "combined"
  verifier?: VerifierConfig; // required iff mode is "zk" or "combined"
  baseline: Baseline;
  delaySeconds: number;
  expirySeconds: number;
  maxCancels: number;
  pendingActivityPolicy: PendingActivityPolicy;
  policyWriteConflictPolicy: PolicyWriteConflictPolicy;
  // Credential ids ever removed by a designated replacement, across every
  // past recovery and baseline update. Carried forward forever so a later
  // baseline or attempt cannot silently revive one (follow-up.md §4.1, §6.10).
  revokedCredentialIds: string[];
}

export interface CredentialReplacement {
  role: string;
  oldCredentialId: string;
  newCredentialId: string;
}

export interface ProposalCommitment {
  network: string;
  account: string;
  controllerId: string;
  action: CommitmentAction;
  configVersion: number;
  baselineOrSourceId: string;
  targetDocHash: string;
  attemptId: string;
  delaySeconds: number;
}

export interface GuardianApproval {
  guardian: string;
  commitment: ProposalCommitment;
}

export interface ZkProof {
  nullifier: string;
  commitment: ProposalCommitment;
  verified: boolean; // stand-in for on-chain proof verification
}

export type AttemptState =
  | "collecting-evidence"
  | "authorized-pending"
  | "completed"
  | "cancelled"
  | "expired"
  | "invalidated"; // reachable only via policyWriteConflictPolicy === "invalidate-attempt"

export const TERMINAL_ATTEMPT_STATES: ReadonlySet<AttemptState> = new Set([
  "completed",
  "cancelled",
  "expired",
  "invalidated",
]);

// Enrollment parameters an attempt evaluates evidence against, frozen at
// attempt creation so a later enrollment change cannot silently reinterpret
// an in-flight attempt (follow-up.md §6.9).
export interface FrozenRecoveryParams {
  mode: AuthMode;
  guardianSet?: GuardianSet;
  verifier?: VerifierConfig;
  delaySeconds: number;
  expirySeconds: number;
  version: number;
}

export interface RecoveryAttempt {
  id: string;
  action: RecoveryAction;
  frozenConfig: FrozenRecoveryParams;
  sourceSnapshotDoc?: ToyDocument; // lost-key only (follow-up.md §4.2)
  targetDoc: ToyDocument;
  replacedCredentialIds: string[];
  commitment: ProposalCommitment;
  guardianApprovals: GuardianApproval[];
  zkProof?: ZkProof;
  state: AttemptState;
  createdAt: number;
  initiatedAt?: number; // set on transition into "authorized-pending"
  executableAfter?: number;
  expiresAt?: number;
  cancelCount: number;
}

export interface AccountRecoveryState {
  account: string;
  network: string;
  controllerId: string;
  config: RecoveryConfig;
  liveDoc: ToyDocument;
  activeAttempt: RecoveryAttempt | null;
  history: RecoveryAttempt[]; // terminal attempts, append-only
  reservedNullifiers: string[];
  spentNullifiers: string[];
}

export class RecoveryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = "RecoveryError";
  }
}
