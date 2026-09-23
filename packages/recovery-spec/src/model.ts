// Reference state machine for account recovery. See
// docs/recovery/TRANSITION_SPEC.md for the prose specification this file
// implements, and types.ts for the domain model. Every exported function is
// a pure transition: (state, input) -> state, or throws RecoveryError on a
// rejected transition.

import {
  AccountRecoveryState,
  AttemptState,
  Baseline,
  CredentialReplacement,
  GuardianApproval,
  ProposalCommitment,
  RecoveryAction,
  RecoveryAttempt,
  RecoveryConfig,
  RecoveryError,
  TERMINAL_ATTEMPT_STATES,
  ToyDocument,
  ZkProof,
} from "./types.js";

export * from "./types.js";

// --- small pure helpers -----------------------------------------------------

export function isTerminal(state: AttemptState): boolean {
  return TERMINAL_ATTEMPT_STATES.has(state);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (!deepEqual((a as Record<string, unknown>)[aKeys[i]], (b as Record<string, unknown>)[bKeys[i]])) {
      return false;
    }
  }
  return true;
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// Deterministic, order-independent stand-in for perch's canonical doc_hash.
// The real byte encoding is engineering work; this is only enough to make
// "the installed document has an accurate commitment" executable in the
// reference model.
export function hashDoc(signers: Record<string, string>): string {
  const entries = Object.entries(signers).sort(([a], [b]) => a.localeCompare(b));
  return "doc:" + entries.map(([role, cred]) => `${role}=${cred}`).join(",");
}

export function makeDoc(signers: Record<string, string>): ToyDocument {
  return { signers, docHash: hashDoc(signers) };
}

// Target-document construction:
//   lost-key target    = current approved document with designated credentials replaced
//   compromise target  = enrolled baseline with designated credentials replaced
export function applyReplacements(doc: ToyDocument, replacements: CredentialReplacement[]): ToyDocument {
  const signers = { ...doc.signers };
  for (const r of replacements) {
    if (signers[r.role] !== r.oldCredentialId) {
      throw new RecoveryError(
        "STALE_REPLACEMENT",
        `role "${r.role}" no longer holds credential "${r.oldCredentialId}" in the source document`,
      );
    }
    signers[r.role] = r.newCredentialId;
  }
  return makeDoc(signers);
}

// Requirement: a replacement must not accidentally preserve the old
// credential under another signer entry. Replacing only the nominal role is
// not enough to guarantee this -- fail closed if a removed credential id is
// still reachable anywhere in the resulting document.
function assertNoResidualCredential(doc: ToyDocument, removedCredentialIds: string[]): void {
  for (const [role, cred] of Object.entries(doc.signers)) {
    if (removedCredentialIds.includes(cred)) {
      throw new RecoveryError(
        "RESIDUAL_OLD_CREDENTIAL",
        `credential "${cred}" is designated for removal but still appears under role "${role}" in the ` +
          "target document -- every occurrence must be designated for replacement",
      );
    }
  }
}

function requireActiveAttempt(state: AccountRecoveryState): RecoveryAttempt {
  if (!state.activeAttempt) {
    throw new RecoveryError("NO_ACTIVE_ATTEMPT", "no recovery attempt is in progress for this account");
  }
  return state.activeAttempt;
}

function requireNonTerminal(attempt: RecoveryAttempt): void {
  if (isTerminal(attempt.state)) {
    throw new RecoveryError("ATTEMPT_TERMINAL", `attempt is already terminal (${attempt.state})`);
  }
}

// Enforces the cancellation-domain rule: cancellation
// evidence is not initiation evidence replayed — it must carry a distinct
// action tag ("cancel") and otherwise refer to the identical proposal.
function requireExactCommitment(expected: ProposalCommitment, actual: ProposalCommitment): void {
  if (expected.action !== actual.action) {
    throw new RecoveryError(
      "WRONG_DOMAIN",
      `evidence for action "${actual.action}" cannot authorize action "${expected.action}" -- ` +
        "cancellation, initiation, and reconfiguration use distinct action domains",
    );
  }
  if (!deepEqual(expected, actual)) {
    throw new RecoveryError(
      "COMMITMENT_MISMATCH",
      "evidence does not refer to this exact proposal (attempt integrity)",
    );
  }
}

function releaseAttempt(state: AccountRecoveryState, terminalAttempt: RecoveryAttempt): AccountRecoveryState {
  const reservedNullifiers = terminalAttempt.zkProof
    ? state.reservedNullifiers.filter((n) => n !== terminalAttempt.zkProof!.nullifier)
    : state.reservedNullifiers;
  return {
    ...state,
    activeAttempt: null,
    history: [...state.history, terminalAttempt],
    reservedNullifiers,
  };
}

function guardianQuorumMet(attempt: RecoveryAttempt): boolean {
  const set = attempt.frozenConfig.guardianSet;
  if (!set) return false;
  const distinct = new Set(
    attempt.guardianApprovals.filter((a) => set.guardians.includes(a.guardian)).map((a) => a.guardian),
  );
  return distinct.size >= set.threshold;
}

function zkSatisfied(attempt: RecoveryAttempt): boolean {
  return !!attempt.zkProof && attempt.zkProof.verified;
}

// Mode integrity: "missing guardians or proof
// cannot satisfy a mode that requires them."
function initiationEvidenceSatisfied(attempt: RecoveryAttempt): boolean {
  switch (attempt.frozenConfig.mode) {
    case "guardians":
      return guardianQuorumMet(attempt);
    case "zk":
      return zkSatisfied(attempt);
    case "combined":
      return guardianQuorumMet(attempt) && zkSatisfied(attempt);
  }
}

function promoteIfSatisfied(
  state: AccountRecoveryState,
  attempt: RecoveryAttempt,
  now: number,
): AccountRecoveryState {
  if (attempt.state === "collecting-evidence" && initiationEvidenceSatisfied(attempt)) {
    const executableAfter = now + attempt.frozenConfig.delaySeconds;
    const expiresAt = executableAfter + attempt.frozenConfig.expirySeconds;
    attempt = { ...attempt, state: "authorized-pending", initiatedAt: now, executableAfter, expiresAt };
  }
  return { ...state, activeAttempt: attempt };
}

export function isReady(attempt: RecoveryAttempt, now: number): boolean {
  return (
    attempt.state === "authorized-pending" &&
    attempt.executableAfter !== undefined &&
    now >= attempt.executableAfter &&
    now < (attempt.expiresAt ?? Infinity)
  );
}

// --- enrollment / configuration ---------------------------------------------

export interface EnrollInput {
  mode: RecoveryConfig["mode"];
  profile: RecoveryConfig["profile"];
  guardianSet?: RecoveryConfig["guardianSet"];
  verifier?: RecoveryConfig["verifier"];
  baseline: Baseline;
  delaySeconds: number;
  expirySeconds: number;
  maxCancels: number;
  pendingActivityPolicy: RecoveryConfig["pendingActivityPolicy"];
  policyWriteConflictPolicy: RecoveryConfig["policyWriteConflictPolicy"];
}

export interface EnrollEvidence {
  adminAuthorized: boolean;
  // Required only when the CURRENT enrolled profile is "protected" --
  // evaluated against the CURRENT mode, not the incoming one.
  guardianApprovals?: GuardianApproval[];
  zkProof?: ZkProof;
}

function validateEnrollInput(input: EnrollInput): void {
  if ((input.mode === "guardians" || input.mode === "combined") && !input.guardianSet) {
    throw new RecoveryError("MISSING_GUARDIAN_SET", `mode "${input.mode}" requires a guardianSet`);
  }
  if ((input.mode === "zk" || input.mode === "combined") && !input.verifier) {
    throw new RecoveryError("MISSING_VERIFIER", `mode "${input.mode}" requires a verifier`);
  }
  // Hard constraint: guardians-only must not require ZK machinery at all.
  if (input.mode === "guardians" && input.verifier) {
    throw new RecoveryError(
      "ZK_NOT_OPT_IN",
      "guardians-only enrollment must not declare a verifier -- ZK is opt-in, not incidental",
    );
  }
}

function protectedChangeEvidenceSatisfied(config: RecoveryConfig, evidence: EnrollEvidence): boolean {
  const mode = config.mode;
  let guardianOk = mode === "zk";
  if (mode !== "zk") {
    const set = config.guardianSet;
    const approvals = (evidence.guardianApprovals ?? []).filter(
      (a) => set?.guardians.includes(a.guardian) && a.commitment.action === "reconfigure",
    );
    guardianOk = !!set && new Set(approvals.map((a) => a.guardian)).size >= set.threshold;
  }
  let zkOk = mode === "guardians";
  if (mode !== "guardians") {
    zkOk = !!evidence.zkProof && evidence.zkProof.verified && evidence.zkProof.commitment.action === "reconfigure";
  }
  return guardianOk && zkOk;
}

export function enroll(
  state: AccountRecoveryState,
  input: EnrollInput,
  evidence: EnrollEvidence,
  now: number,
): AccountRecoveryState {
  if (!evidence.adminAuthorized) {
    throw new RecoveryError("ADMIN_REQUIRED", "enrollment changes always require ordinary admin authorization");
  }

  const hasLiveAttempt = !!state.activeAttempt && !isTerminal(state.activeAttempt.state);

  if (hasLiveAttempt && state.config.policyWriteConflictPolicy === "block") {
    throw new RecoveryError(
      "BLOCKED_BY_PENDING_RECOVERY",
      "a recovery attempt is in progress; enrollment changes are blocked (policyWriteConflictPolicy=block)",
    );
  }
  if (hasLiveAttempt && state.config.policyWriteConflictPolicy === "other") {
    throw new RecoveryError(
      "UNRESOLVED_POLICY_BRANCH",
      "policyWriteConflictPolicy='other' is a symbolic placeholder for an unspecified conflict rule -- no behavior is defined",
    );
  }

  if (state.config.profile === "protected" && !protectedChangeEvidenceSatisfied(state.config, evidence)) {
    throw new RecoveryError(
      "PROTECTED_CHANGE_REQUIRES_RECOVERY_CONDITION",
      "protected recovery-configuration changes require admin plus the currently enrolled recovery condition; " +
        "an admin key alone cannot downgrade or disable protection",
    );
  }

  validateEnrollInput(input);

  for (const credId of Object.values(input.baseline.doc.signers)) {
    if (state.config.revokedCredentialIds.includes(credId)) {
      throw new RecoveryError(
        "REVOKED_CREDENTIAL_REVIVED",
        `credential "${credId}" was revoked by a prior recovery and cannot reappear in a new baseline`,
      );
    }
  }

  let nextState = state;
  if (hasLiveAttempt && state.config.policyWriteConflictPolicy === "invalidate-attempt") {
    const invalidated: RecoveryAttempt = { ...state.activeAttempt!, state: "invalidated" };
    nextState = releaseAttempt(nextState, invalidated);
  }

  const nextConfig: RecoveryConfig = {
    ...input,
    version: state.config.version + 1,
    revokedCredentialIds: state.config.revokedCredentialIds,
  };

  return { ...nextState, config: nextConfig };
}

// --- attempt lifecycle -------------------------------------------------------

export interface BeginAttemptInput {
  attemptId: string;
  action: RecoveryAction;
  replacements: CredentialReplacement[];
}

export function beginAttempt(
  state: AccountRecoveryState,
  input: BeginAttemptInput,
  now: number,
): AccountRecoveryState {
  if (state.activeAttempt && !isTerminal(state.activeAttempt.state)) {
    throw new RecoveryError(
      "ATTEMPT_ALREADY_ACTIVE",
      "an attempt is already in progress; cancel it (with the enrolled recovery condition) or wait for " +
        "expiry before starting another -- a new initiation must never silently supersede a live attempt, " +
        "or it would bypass the cancellation-evidence requirement",
    );
  }

  const config = state.config;
  for (const r of input.replacements) {
    if (!config.baseline.replaceableRoles.includes(r.role)) {
      throw new RecoveryError(
        "NOT_REPLACEABLE",
        `role "${r.role}" is not designated as replaceable by enrollment`,
      );
    }
    if (config.revokedCredentialIds.includes(r.newCredentialId)) {
      throw new RecoveryError(
        "REVOKED_CREDENTIAL_REVIVED",
        `credential "${r.newCredentialId}" was revoked by a prior recovery and cannot be reintroduced`,
      );
    }
  }

  const sourceDoc = input.action === "compromise" ? config.baseline.doc : state.liveDoc;
  const targetDoc = applyReplacements(sourceDoc, input.replacements);
  assertNoResidualCredential(
    targetDoc,
    input.replacements.map((r) => r.oldCredentialId),
  );
  const baselineOrSourceId = input.action === "compromise" ? config.baseline.id : sourceDoc.docHash;

  const commitment: ProposalCommitment = {
    network: state.network,
    account: state.account,
    controllerId: state.controllerId,
    action: input.action,
    configVersion: config.version,
    baselineOrSourceId,
    targetDocHash: targetDoc.docHash,
    attemptId: input.attemptId,
    delaySeconds: config.delaySeconds,
  };

  const attempt: RecoveryAttempt = {
    id: input.attemptId,
    action: input.action,
    frozenConfig: {
      mode: config.mode,
      guardianSet: config.guardianSet,
      verifier: config.verifier,
      delaySeconds: config.delaySeconds,
      expirySeconds: config.expirySeconds,
      version: config.version,
    },
    sourceSnapshotDoc: input.action === "lost-key" ? sourceDoc : undefined,
    targetDoc,
    replacedCredentialIds: input.replacements.map((r) => r.oldCredentialId),
    commitment,
    guardianApprovals: [],
    zkProof: undefined,
    state: "collecting-evidence",
    cancelCount: 0,
    createdAt: now,
  };

  return { ...state, activeAttempt: attempt };
}

export function submitGuardianApproval(
  state: AccountRecoveryState,
  approval: GuardianApproval,
  now: number,
): AccountRecoveryState {
  const attempt = requireActiveAttempt(state);
  requireNonTerminal(attempt);
  if (attempt.frozenConfig.mode === "zk") {
    throw new RecoveryError("MODE_MISMATCH", "zk-only recovery does not accept guardian evidence");
  }
  if (!attempt.frozenConfig.guardianSet?.guardians.includes(approval.guardian)) {
    throw new RecoveryError("UNKNOWN_GUARDIAN", `"${approval.guardian}" is not an enrolled guardian`);
  }
  requireExactCommitment(attempt.commitment, approval.commitment);

  const already = attempt.guardianApprovals.some((a) => a.guardian === approval.guardian);
  const guardianApprovals = already ? attempt.guardianApprovals : [...attempt.guardianApprovals, approval];
  return promoteIfSatisfied(state, { ...attempt, guardianApprovals }, now);
}

export function submitZkProof(state: AccountRecoveryState, proof: ZkProof, now: number): AccountRecoveryState {
  const attempt = requireActiveAttempt(state);
  requireNonTerminal(attempt);
  if (attempt.frozenConfig.mode === "guardians") {
    throw new RecoveryError(
      "MODE_MISMATCH",
      "guardians-only recovery does not accept or require zk evidence (ZK is opt-in)",
    );
  }
  requireExactCommitment(attempt.commitment, proof.commitment);
  if (!proof.verified) {
    throw new RecoveryError("PROOF_INVALID", "proof did not verify");
  }
  if (state.spentNullifiers.includes(proof.nullifier)) {
    throw new RecoveryError("NULLIFIER_SPENT", "this nullifier has already been spent by a completed recovery");
  }
  const reservedByAnother =
    state.reservedNullifiers.includes(proof.nullifier) && attempt.zkProof?.nullifier !== proof.nullifier;
  if (reservedByAnother) {
    throw new RecoveryError("NULLIFIER_RESERVED", "this nullifier is already reserved by another in-flight attempt");
  }

  const reservedNullifiers = state.reservedNullifiers.includes(proof.nullifier)
    ? state.reservedNullifiers
    : [...state.reservedNullifiers, proof.nullifier];

  return promoteIfSatisfied({ ...state, reservedNullifiers }, { ...attempt, zkProof: proof }, now);
}

export interface CancelEvidence {
  guardianApprovals?: GuardianApproval[];
  zkProof?: ZkProof;
}

export function cancelAttempt(
  state: AccountRecoveryState,
  evidence: CancelEvidence,
  now: number,
): AccountRecoveryState {
  const attempt = requireActiveAttempt(state);
  requireNonTerminal(attempt);

  const cancelCommitment: ProposalCommitment = { ...attempt.commitment, action: "cancel" };
  const mode = attempt.frozenConfig.mode;

  let guardianOk = mode === "zk";
  if (mode !== "zk") {
    const set = attempt.frozenConfig.guardianSet;
    const approvals = evidence.guardianApprovals ?? [];
    for (const a of approvals) {
      if (!set?.guardians.includes(a.guardian)) {
        throw new RecoveryError("UNKNOWN_GUARDIAN", `"${a.guardian}" is not an enrolled guardian`);
      }
      requireExactCommitment(cancelCommitment, a.commitment);
    }
    guardianOk = !!set && new Set(approvals.map((a) => a.guardian)).size >= set.threshold;
  }

  let zkOk = mode === "guardians";
  if (mode !== "guardians") {
    const proof = evidence.zkProof;
    if (proof) {
      requireExactCommitment(cancelCommitment, proof.commitment);
      zkOk = proof.verified;
    } else {
      zkOk = false;
    }
  }

  // Admin veto: there is no branch here that
  // accepts admin authorization alone. guardianOk/zkOk are derived only from
  // the enrolled recovery condition's own evidence.
  if (!guardianOk || !zkOk) {
    throw new RecoveryError(
      "CANCEL_EVIDENCE_INSUFFICIENT",
      "cancellation requires the enrolled recovery condition, bound to this attempt; ordinary admin " +
        "authorization alone is never sufficient",
    );
  }

  const cancelled: RecoveryAttempt = { ...attempt, state: "cancelled", cancelCount: attempt.cancelCount + 1 };
  return releaseAttempt(state, cancelled);
}

export function checkExpiry(state: AccountRecoveryState, now: number): AccountRecoveryState {
  const attempt = state.activeAttempt;
  if (!attempt || isTerminal(attempt.state)) {
    return state;
  }
  if (attempt.state === "authorized-pending") {
    if (now >= (attempt.expiresAt ?? Infinity)) {
      // No automatic bypass: expiry is a terminal state like any other, not
      // a relaxation of the required evidence for the *next* attempt.
      return releaseAttempt(state, { ...attempt, state: "expired" });
    }
    return state;
  }
  // attempt.state === "collecting-evidence": an attempt stuck gathering
  // evidence (e.g. unresponsive guardians) must not linger forever either
  // (decision table row "Guardian non-response": "Attempts expire; a later
  // attempt still requires the enrolled condition"). Reuses the same
  // expirySeconds knob measured from attempt creation -- a distinct
  // evidence-collection deadline is a reasonable future refinement, not
  // required by the recovery spec, so this is a configurable choice, not a
  // required property.
  const evidenceDeadline = attempt.createdAt + attempt.frozenConfig.expirySeconds;
  if (now >= evidenceDeadline) {
    return releaseAttempt(state, { ...attempt, state: "expired" });
  }
  return state;
}

export function completeAttempt(
  state: AccountRecoveryState,
  install: (doc: ToyDocument) => boolean,
  now: number,
): AccountRecoveryState {
  const attempt = requireActiveAttempt(state);
  if (attempt.state !== "authorized-pending") {
    throw new RecoveryError(
      "NOT_READY",
      `no authorized-pending attempt to complete (state=${attempt.state}) -- a completed attempt cannot ` +
        "authorize a second mutation ('single completion')",
    );
  }
  if (now < (attempt.executableAfter ?? Infinity)) {
    throw new RecoveryError("TIMELOCK_NOT_ELAPSED", "the configured delay has not yet elapsed");
  }
  if (now >= (attempt.expiresAt ?? Infinity)) {
    throw new RecoveryError(
      "ATTEMPT_EXPIRED",
      "attempt window has expired; completion is no longer authorized (call checkExpiry first)",
    );
  }

  const installed = install(attempt.targetDoc);
  if (!installed) {
    // Atomicity: a failed install leaves the attempt exactly as it was --
    // still authorized-pending, nullifier still reserved, live document
    // untouched. It can be retried.
    return state;
  }

  const completed: RecoveryAttempt = { ...attempt, state: "completed" };
  const revokedCredentialIds = dedupe([...state.config.revokedCredentialIds, ...attempt.replacedCredentialIds]);

  let spentNullifiers = state.spentNullifiers;
  let reservedNullifiers = state.reservedNullifiers;
  if (attempt.zkProof) {
    spentNullifiers = [...spentNullifiers, attempt.zkProof.nullifier];
    reservedNullifiers = reservedNullifiers.filter((n) => n !== attempt.zkProof!.nullifier);
  }

  return {
    ...state,
    liveDoc: attempt.targetDoc,
    config: { ...state.config, revokedCredentialIds },
    activeAttempt: null,
    history: [...state.history, completed],
    spentNullifiers,
    reservedNullifiers,
  };
}

// --- Pending-activity policy (OPEN GATE): activity during pending recovery -

export interface ActivityDecision {
  allowed: boolean;
  reason: string;
}

// Ordinary account-authorized execution during a pending attempt.
// `pendingActivityPolicy` is a required, non-defaulted parameter (see
// types.ts); every branch is modeled explicitly.
export function ordinaryExecute(state: AccountRecoveryState): ActivityDecision {
  const attempt = state.activeAttempt;
  if (!attempt || attempt.state !== "authorized-pending") {
    return { allowed: true, reason: "no authorized-pending recovery attempt" };
  }
  switch (state.config.pendingActivityPolicy) {
    case "continue":
      return { allowed: true, reason: "pendingActivityPolicy=continue" };
    case "freeze":
      return {
        allowed: false,
        reason:
          "pendingActivityPolicy=freeze: ordinary execution is blocked once initiation evidence is " +
          "satisfied",
      };
    case "restrict":
      // Left symbolic: this branch requires an explicit capability boundary
      // and more validation than this reference model can express. It
      // refuses to claim any particular call is safe, and throws a distinct
      // error so tests can tell it apart from freeze.
      throw new RecoveryError(
        "UNRESOLVED_POLICY_BRANCH",
        "pendingActivityPolicy='restrict' has no defined capability boundary yet -- " +
          "not implemented, and not a stand-in default for freeze or continue",
      );
  }
}

// Related policy-write behavior / lost-key source-snapshot conflicts. Also
// left open; also a required, non-defaulted field.
export function ordinaryPolicyWrite(
  state: AccountRecoveryState,
  newDoc: ToyDocument,
): AccountRecoveryState {
  const attempt = state.activeAttempt;
  const conflicting = !!attempt && !isTerminal(attempt.state) && attempt.action === "lost-key";
  if (!conflicting) {
    return { ...state, liveDoc: newDoc };
  }
  switch (state.config.policyWriteConflictPolicy) {
    case "block":
      throw new RecoveryError(
        "BLOCKED_BY_PENDING_RECOVERY",
        "ordinary policy writes are blocked while a lost-key attempt's source snapshot is live",
      );
    case "invalidate-attempt": {
      const invalidated: RecoveryAttempt = { ...attempt!, state: "invalidated" };
      return { ...releaseAttempt(state, invalidated), liveDoc: newDoc };
    }
    case "other":
      throw new RecoveryError(
        "UNRESOLVED_POLICY_BRANCH",
        "policyWriteConflictPolicy='other' is a symbolic placeholder -- no behavior is defined",
      );
  }
}
