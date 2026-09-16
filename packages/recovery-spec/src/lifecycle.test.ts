// Happy-path lifecycle coverage per authentication mode. See
// docs/recovery/TRANSITION_SPEC.md §"States" for the state diagram these
// walk through: enrollment -> collecting-evidence -> authorized-pending ->
// ready-after-delay -> completed.

import { describe, expect, it } from "vitest";
import {
  beginAttempt,
  cancelAttempt,
  checkExpiry,
  completeAttempt,
  isReady,
  submitGuardianApproval,
  submitZkProof,
} from "./model.js";
import {
  ALWAYS_INSTALLS,
  baseConfig,
  cancelCommitmentFor,
  combinedModeOverrides,
  createState,
  initiationCommitmentFor,
  zkModeOverrides,
} from "./testFixtures.js";

describe("guardians-only lifecycle (hard constraint: no ZK machinery required)", () => {
  it("completes a lost-key recovery using only guardian quorum", () => {
    let state = createState(baseConfig("freeze", "block"));
    expect(state.config.verifier).toBeUndefined();

    state = beginAttempt(
      state,
      {
        attemptId: "attempt-1",
        action: "lost-key",
        replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }],
      },
      1_000,
    );
    expect(state.activeAttempt?.state).toBe("collecting-evidence");
    expect(state.activeAttempt?.zkProof).toBeUndefined();

    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 1_010);
    expect(state.activeAttempt?.state).toBe("collecting-evidence"); // threshold is 2

    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 1_020);
    expect(state.activeAttempt?.state).toBe("authorized-pending");
    expect(state.activeAttempt?.zkProof).toBeUndefined(); // never touched

    const readyAt = state.activeAttempt!.executableAfter!;
    expect(isReady(state.activeAttempt!, readyAt - 1)).toBe(false);
    expect(isReady(state.activeAttempt!, readyAt)).toBe(true);

    state = completeAttempt(state, ALWAYS_INSTALLS, readyAt);
    expect(state.liveDoc.signers.admin).toBe("cred-admin-1");
    expect(state.config.revokedCredentialIds).toContain("cred-admin-0");
    expect(state.history.at(-1)?.state).toBe("completed");
    expect(state.activeAttempt).toBeNull();
  });

  it("cancels using guardian quorum bound to the attempt, then allows a fresh attempt", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginAttempt(
      state,
      {
        attemptId: "attempt-1",
        action: "lost-key",
        replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }],
      },
      0,
    );
    const cancelCommitment = cancelCommitmentFor(state);
    state = cancelAttempt(
      state,
      { guardianApprovals: [{ guardian: "g1", commitment: cancelCommitment }, { guardian: "g2", commitment: cancelCommitment }] },
      10,
    );
    expect(state.history.at(-1)?.state).toBe("cancelled");
    expect(state.activeAttempt).toBeNull();

    // repeated-recovery behavior: a fresh attempt still requires full quorum
    state = beginAttempt(
      state,
      {
        attemptId: "attempt-2",
        action: "lost-key",
        replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-2" }],
      },
      20,
    );
    expect(state.activeAttempt?.guardianApprovals).toHaveLength(0);
  });
});

describe("zk-only lifecycle", () => {
  it("completes a compromise recovery using only a verified proof, rebuilding from baseline", () => {
    let state = createState(
      baseConfig("freeze", "block", zkModeOverrides()),
      { admin: "cred-admin-0", attacker: "cred-attacker-planted" }, // attacker-tampered live doc
    );
    expect(state.config.guardianSet).toBeUndefined();

    state = beginAttempt(
      state,
      {
        attemptId: "attempt-1",
        action: "compromise",
        replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }],
      },
      1_000,
    );
    expect(state.activeAttempt?.guardianApprovals).toHaveLength(0);

    const commitment = initiationCommitmentFor(state);
    state = submitZkProof(state, { nullifier: "null-1", commitment, verified: true }, 1_010);
    expect(state.activeAttempt?.state).toBe("authorized-pending");

    const readyAt = state.activeAttempt!.executableAfter!;
    state = completeAttempt(state, ALWAYS_INSTALLS, readyAt);

    // compromise rebuilds strictly from baseline + replacement -- the
    // attacker-planted signer does not survive (required property #7).
    expect(state.liveDoc.signers).toEqual({ admin: "cred-admin-1" });
    expect(state.spentNullifiers).toContain("null-1");
    expect(state.reservedNullifiers).not.toContain("null-1");
  });
});

describe("combined-mode lifecycle", () => {
  it("requires both guardian quorum and a verified proof over the same proposal", () => {
    let state = createState(baseConfig("freeze", "block", combinedModeOverrides()));
    state = beginAttempt(
      state,
      {
        attemptId: "attempt-1",
        action: "lost-key",
        replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }],
      },
      0,
    );
    const commitment = initiationCommitmentFor(state);

    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 1);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 2);
    expect(state.activeAttempt?.state).toBe("collecting-evidence"); // zk still missing

    state = submitZkProof(state, { nullifier: "null-1", commitment, verified: true }, 3);
    expect(state.activeAttempt?.state).toBe("authorized-pending");
  });
});
