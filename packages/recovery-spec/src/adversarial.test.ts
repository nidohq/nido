// Adversarial validation against the reference model. Each `describe` title
// carries a tag:
//
//   AGREED       -- a required property; must hold under every
//                   configuration.
//   CONFIGURABLE -- a named, intentional parameter; every branch is
//                   exercised, none is silently preferred by the code.
//   UNRESOLVED   -- deliberately deferred (see types.ts). Every candidate
//                   branch is exercised; none is a default, and the
//                   symbolic branches ("restrict", "other") throw a
//                   distinct UNRESOLVED_POLICY_BRANCH error rather than
//                   silently behaving like a resolved branch.
//   OUT OF SCOPE -- not expressible at this abstraction level (needs the
//                   real OZ Policy/contract integration, or cross-language
//                   canonicalization). Not tested here; called out in
//                   TRANSITION_SPEC.md instead.

import { describe, expect, it } from "vitest";
import {
  RecoveryError,
  beginAttempt,
  cancelAttempt,
  checkExpiry,
  completeAttempt,
  enroll,
  ordinaryExecute,
  ordinaryPolicyWrite,
  submitGuardianApproval,
  submitZkProof,
} from "./model.js";
import {
  ALWAYS_FAILS_INSTALL,
  ALWAYS_INSTALLS,
  baseConfig,
  cancelCommitmentFor,
  createState,
  initiationCommitmentFor,
  zkModeOverrides,
} from "./testFixtures.js";

function beginLostKeyAttempt(state: ReturnType<typeof createState>, attemptId = "attempt-1", now = 0) {
  return beginAttempt(
    state,
    {
      attemptId,
      action: "lost-key",
      replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }],
    },
    now,
  );
}

// --- repeated completion within one tx / one ledger / after expiry (AGREED) ---

describe("AGREED: single completion", () => {
  it("rejects a second completeAttempt call at the same instant (models same tx/ledger)", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    const readyAt = state.activeAttempt!.executableAfter!;

    state = completeAttempt(state, ALWAYS_INSTALLS, readyAt);
    expect(() => completeAttempt(state, ALWAYS_INSTALLS, readyAt)).toThrow(RecoveryError);
    expect(() => completeAttempt(state, ALWAYS_INSTALLS, readyAt)).toThrow(/NOT_READY|NO_ACTIVE_ATTEMPT/);
  });

  it("rejects completion after expiry", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    const expiresAt = state.activeAttempt!.expiresAt!;

    expect(() => completeAttempt(state, ALWAYS_INSTALLS, expiresAt)).toThrow(/ATTEMPT_EXPIRED/);

    state = checkExpiry(state, expiresAt);
    expect(state.history.at(-1)?.state).toBe("expired");
    expect(() => completeAttempt(state, ALWAYS_INSTALLS, expiresAt)).toThrow(/no recovery attempt/i);
  });

  it("regression test: a ledger-scoped-only grant would wrongly allow replay; state consumption does not", () => {
    // nido's earlier zk-recovery completion mechanism's
    // CompletionGrant(account) = ledger_sequence flag was not consumed --
    // checking it again in the same ledger still returned true.
    const flawedLedgerScopedGrant = (grantedAtLedger: number, currentLedger: number) =>
      grantedAtLedger === currentLedger; // never consumed -- same bug as that earlier mechanism

    const ledger = 42;
    expect(flawedLedgerScopedGrant(ledger, ledger)).toBe(true);
    expect(flawedLedgerScopedGrant(ledger, ledger)).toBe(true); // "replay" still succeeds under the flawed check

    // The reference model instead consumes the attempt's *state*, not a
    // ledger-scoped flag, so a second check in the same ledger fails.
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    const readyAt = state.activeAttempt!.executableAfter!;
    state = completeAttempt(state, ALWAYS_INSTALLS, readyAt);
    // same "ledger" (same `now`), second call:
    expect(() => completeAttempt(state, ALWAYS_INSTALLS, readyAt)).toThrow(RecoveryError);
  });
});

describe("AGREED: ordinary admin cannot exercise recovery-only mutation authority", () => {
  it("completeAttempt refuses an attempt that never assembled sufficient evidence", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state); // still collecting-evidence, 0 approvals
    expect(() => completeAttempt(state, ALWAYS_INSTALLS, 10_000)).toThrow(/NOT_READY/);
  });
});

describe("AGREED: attempt integrity -- changed fields after approval are rejected", () => {
  const mutations: Array<[string, (c: ReturnType<typeof initiationCommitmentFor>) => object]> = [
    ["targetDocHash", (c) => ({ ...c, targetDocHash: "doc:tampered" })],
    ["action", (c) => ({ ...c, action: "compromise" })],
    ["network", (c) => ({ ...c, network: "mainnet" })],
    ["account", (c) => ({ ...c, account: "GDIFFERENT" })],
    ["configVersion", (c) => ({ ...c, configVersion: c.configVersion + 1 })],
    ["attemptId", (c) => ({ ...c, attemptId: "some-other-attempt" })],
    ["baselineOrSourceId", (c) => ({ ...c, baselineOrSourceId: "doc:different-source" })],
  ];

  it.each(mutations)("rejects guardian evidence with a mutated %s", (_field, mutate) => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    const tampered = mutate(initiationCommitmentFor(state)) as ReturnType<typeof initiationCommitmentFor>;
    expect(() => submitGuardianApproval(state, { guardian: "g1", commitment: tampered }, 0)).toThrow(RecoveryError);
  });
});

describe("AGREED: combined-mode proof and guardian approvals must refer to the same proposal", () => {
  it("rejects a zk proof carrying a different attempt's commitment (e.g. a stale/forged proof)", () => {
    let state = createState(
      baseConfig("freeze", "block", { mode: "combined", verifier: { address: "C_ZK", vkCommitment: "vk-1" } }),
    );
    state = beginLostKeyAttempt(state, "attempt-A");
    const realCommitment = initiationCommitmentFor(state);
    // A proof genuinely valid for some OTHER proposal (different attemptId)
    // must not authorize this attempt, even paired with valid guardian
    // approvals for the real one.
    const forgedCommitment = { ...realCommitment, attemptId: "attempt-B-never-existed" };

    state = submitGuardianApproval(state, { guardian: "g1", commitment: realCommitment }, 1);
    state = submitGuardianApproval(state, { guardian: "g2", commitment: realCommitment }, 1);
    expect(state.activeAttempt?.state).toBe("collecting-evidence"); // zk still missing

    expect(() =>
      submitZkProof(state, { nullifier: "null-1", commitment: forgedCommitment, verified: true }, 2),
    ).toThrow(/COMMITMENT_MISMATCH/);
  });
});

describe("AGREED: cancellation domain", () => {
  it("rejects cancellation using initiation-domain evidence", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    const initiationCommitment = initiationCommitmentFor(state);
    expect(() =>
      cancelAttempt(
        state,
        { guardianApprovals: [{ guardian: "g1", commitment: initiationCommitment }, { guardian: "g2", commitment: initiationCommitment }] },
        1,
      ),
    ).toThrow(/WRONG_DOMAIN/);
  });

  it("rejects cancellation with no recovery-condition evidence at all (no admin-alone veto)", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    expect(() => cancelAttempt(state, {}, 1)).toThrow(/CANCEL_EVIDENCE_INSUFFICIENT/);
  });

  it("rejects cancellation missing a required factor in combined mode", () => {
    let state = createState(baseConfig("freeze", "block", { mode: "combined", verifier: { address: "C", vkCommitment: "vk" } }));
    state = beginLostKeyAttempt(state);
    const cancelCommitment = cancelCommitmentFor(state);
    // guardians approve cancellation, but no zk proof supplied
    expect(() =>
      cancelAttempt(
        state,
        { guardianApprovals: [{ guardian: "g1", commitment: cancelCommitment }, { guardian: "g2", commitment: cancelCommitment }] },
        1,
      ),
    ).toThrow(/CANCEL_EVIDENCE_INSUFFICIENT/);
  });
});

describe("AGREED: guardian non-response has no automatic bypass", () => {
  it("expires a stalled evidence-collection attempt instead of completing with partial quorum", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state, "attempt-1", 0);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 1); // only 1 of 2

    const deadline = state.activeAttempt!.createdAt + state.activeAttempt!.frozenConfig.expirySeconds;
    state = checkExpiry(state, deadline);
    expect(state.history.at(-1)?.state).toBe("expired");

    // a fresh attempt still requires full quorum -- no bypass carried over
    state = beginLostKeyAttempt(state, "attempt-2", deadline + 1);
    expect(state.activeAttempt?.guardianApprovals).toHaveLength(0);
  });
});

describe("AGREED: atomicity of completion", () => {
  it("a failed install leaves the attempt pending and state untouched, retryable", () => {
    let state = createState(baseConfig("freeze", "block", zkModeOverrides()));
    state = beginAttempt(
      state,
      { attemptId: "a1", action: "compromise", replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }] },
      0,
    );
    const commitment = initiationCommitmentFor(state);
    state = submitZkProof(state, { nullifier: "n1", commitment, verified: true }, 1);
    const readyAt = state.activeAttempt!.executableAfter!;
    const liveDocBefore = state.liveDoc;

    const afterFailedInstall = completeAttempt(state, ALWAYS_FAILS_INSTALL, readyAt);
    expect(afterFailedInstall.activeAttempt?.state).toBe("authorized-pending");
    expect(afterFailedInstall.liveDoc).toEqual(liveDocBefore);
    expect(afterFailedInstall.reservedNullifiers).toContain("n1");
    expect(afterFailedInstall.spentNullifiers).not.toContain("n1");

    const afterRetry = completeAttempt(afterFailedInstall, ALWAYS_INSTALLS, readyAt);
    expect(afterRetry.liveDoc.signers.admin).toBe("cred-admin-1");
    expect(afterRetry.spentNullifiers).toContain("n1");
  });
});

describe("AGREED: compromise vs lost-key postconditions", () => {
  it("compromise recovery discards an attacker-planted signer; lost-key preserves a legitimate one", () => {
    const attackerTamperedDoc = { admin: "cred-admin-0", attacker: "cred-attacker" };
    let compromiseState = createState(baseConfig("freeze", "block", zkModeOverrides()), attackerTamperedDoc);
    compromiseState = beginAttempt(
      compromiseState,
      { attemptId: "a1", action: "compromise", replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }] },
      0,
    );
    expect(compromiseState.activeAttempt!.targetDoc.signers).toEqual({ admin: "cred-admin-1" });

    const ownerAddedAppDoc = { admin: "cred-admin-0", "app-b": "cred-app-b" };
    let lostKeyState = createState(baseConfig("freeze", "block"), ownerAddedAppDoc);
    lostKeyState = beginLostKeyAttempt(lostKeyState);
    expect(lostKeyState.activeAttempt!.targetDoc.signers).toEqual({
      admin: "cred-admin-1",
      "app-b": "cred-app-b",
    });
  });
});

describe("AGREED: revoked credentials are never revived", () => {
  it("rejects reintroducing a revoked credential in a later attempt or a new baseline", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state, "attempt-1", 0);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    const readyAt = state.activeAttempt!.executableAfter!;
    state = completeAttempt(state, ALWAYS_INSTALLS, readyAt);
    expect(state.config.revokedCredentialIds).toContain("cred-admin-0");

    expect(() =>
      beginAttempt(
        state,
        {
          attemptId: "attempt-2",
          action: "lost-key",
          replacements: [{ role: "admin", oldCredentialId: "cred-admin-1", newCredentialId: "cred-admin-0" }],
        },
        readyAt + 1,
      ),
    ).toThrow(/REVOKED_CREDENTIAL_REVIVED/);

    expect(() =>
      enroll(
        state,
        {
          ...state.config,
          baseline: { id: "baseline-2", doc: { docHash: "x", signers: { admin: "cred-admin-0" } }, replaceableRoles: ["admin"] },
        },
        { adminAuthorized: true },
        readyAt + 1,
      ),
    ).toThrow(/REVOKED_CREDENTIAL_REVIVED/);
  });

  it("rejects a target document that leaves the old credential under a different role (residual reference)", () => {
    const docWithDuplicateCred = { admin: "cred-admin-0", "backup-admin": "cred-admin-0" };
    let state = createState(
      baseConfig("freeze", "block", { baseline: { id: "b1", doc: { docHash: "x", signers: docWithDuplicateCred }, replaceableRoles: ["admin"] } }),
      docWithDuplicateCred,
    );
    expect(() => beginLostKeyAttempt(state)).toThrow(/RESIDUAL_OLD_CREDENTIAL/);
  });
});

describe("AGREED: protected-profile changes require the current recovery condition, not just admin", () => {
  it("rejects an admin-only downgrade and accepts one with the currently enrolled proof", () => {
    let state = createState(baseConfig("freeze", "block", { ...zkModeOverrides(), profile: "protected" }));
    const reconfigInput = { ...state.config, profile: "loss" as const };

    expect(() => enroll(state, reconfigInput, { adminAuthorized: true }, 0)).toThrow(
      /PROTECTED_CHANGE_REQUIRES_RECOVERY_CONDITION/,
    );

    const reconfigCommitment = {
      network: state.network,
      account: state.account,
      controllerId: state.controllerId,
      action: "reconfigure" as const,
      configVersion: state.config.version,
      baselineOrSourceId: state.config.baseline.id,
      targetDocHash: state.liveDoc.docHash,
      attemptId: "reconfig-1",
      delaySeconds: state.config.delaySeconds,
    };
    const next = enroll(
      state,
      reconfigInput,
      { adminAuthorized: true, zkProof: { nullifier: "n-reconfig", commitment: reconfigCommitment, verified: true } },
      0,
    );
    expect(next.config.profile).toBe("loss");
    expect(next.config.version).toBe(state.config.version + 1);
  });
});

describe("AGREED: guardians-only enrollment must not require ZK machinery", () => {
  it("rejects a guardians-only config that also declares a verifier", () => {
    let state = createState(baseConfig("freeze", "block"));
    expect(() =>
      enroll(
        state,
        { ...state.config, verifier: { address: "C_ZK", vkCommitment: "vk" } },
        { adminAuthorized: true },
        0,
      ),
    ).toThrow(/ZK_NOT_OPT_IN/);
  });
});

describe("AGREED: no silent supersede of a live attempt", () => {
  it("rejects beginning a second attempt while one is still active", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state, "attempt-1", 0);
    expect(() => beginLostKeyAttempt(state, "attempt-2", 1)).toThrow(/ATTEMPT_ALREADY_ACTIVE/);
  });
});

describe("AGREED: nullifier replay (zk-mode only)", () => {
  it("a spent nullifier can never be reused; a released one can", () => {
    let state = createState(baseConfig("freeze", "block", zkModeOverrides()));
    state = beginAttempt(
      state,
      { attemptId: "a1", action: "compromise", replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }] },
      0,
    );
    let commitment = initiationCommitmentFor(state);
    state = submitZkProof(state, { nullifier: "n1", commitment, verified: true }, 1);
    const readyAt = state.activeAttempt!.executableAfter!;
    state = completeAttempt(state, ALWAYS_INSTALLS, readyAt);

    state = beginAttempt(
      state,
      // compromise always rebuilds from the same, unchanged baseline --
      // "cred-admin-0" is still the baseline's admin credential.
      { attemptId: "a2", action: "compromise", replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-2" }] },
      readyAt + 1,
    );
    commitment = initiationCommitmentFor(state);
    expect(() => submitZkProof(state, { nullifier: "n1", commitment, verified: true }, readyAt + 2)).toThrow(
      /NULLIFIER_SPENT/,
    );
  });

  it("releases a reserved nullifier on cancellation so it can be reused", () => {
    let state = createState(baseConfig("freeze", "block", zkModeOverrides()));
    state = beginAttempt(
      state,
      { attemptId: "a1", action: "compromise", replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }] },
      0,
    );
    let commitment = initiationCommitmentFor(state);
    state = submitZkProof(state, { nullifier: "n1", commitment, verified: true }, 1);
    const cancelCommitment = cancelCommitmentFor(state);
    state = cancelAttempt(state, { zkProof: { nullifier: "n1", commitment: cancelCommitment, verified: true } }, 2);
    expect(state.reservedNullifiers).not.toContain("n1");

    state = beginAttempt(
      state,
      { attemptId: "a2", action: "compromise", replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-3" }] },
      3,
    );
    commitment = initiationCommitmentFor(state);
    expect(() => submitZkProof(state, { nullifier: "n1", commitment, verified: true }, 4)).not.toThrow();
  });
});

describe("AGREED: recovery never requires the old admin credential ('initiate_recovery is permissionless')", () => {
  it("completes an entire guardians-only lifecycle with zero admin-authorized evidence", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    const readyAt = state.activeAttempt!.executableAfter!;
    state = completeAttempt(state, ALWAYS_INSTALLS, readyAt);
    expect(state.liveDoc.signers.admin).toBe("cred-admin-1");
  });
});

// --- pendingActivityPolicy / policyWriteConflictPolicy: every candidate branch, none a default ---

describe("UNRESOLVED: pendingActivityPolicy has no default", () => {
  it("freeze blocks ordinary execution once initiation evidence is satisfied", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    expect(ordinaryExecute(state)).toEqual({ allowed: false, reason: expect.stringContaining("freeze") });
  });

  it("continue allows ordinary execution during the same window", () => {
    let state = createState(baseConfig("continue", "block"));
    state = beginLostKeyAttempt(state);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    expect(ordinaryExecute(state)).toEqual({ allowed: true, reason: expect.stringContaining("continue") });
  });

  it("restrict is left symbolic: it throws, distinctly from both freeze and continue", () => {
    let state = createState(baseConfig("restrict", "block"));
    state = beginLostKeyAttempt(state);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    expect(() => ordinaryExecute(state)).toThrow(/UNRESOLVED_POLICY_BRANCH/);
  });

  it("has no evaluable branch for an unrecognized policy value (proves there is no fallback default)", () => {
    let state = createState(baseConfig("freeze", "block"));
    state = beginLostKeyAttempt(state);
    const commitment = initiationCommitmentFor(state);
    state = submitGuardianApproval(state, { guardian: "g1", commitment }, 0);
    state = submitGuardianApproval(state, { guardian: "g2", commitment }, 0);
    const corrupted = {
      ...state,
      config: { ...state.config, pendingActivityPolicy: "__unspecified__" as never },
    };
    // The switch in ordinaryExecute has no `default:` case -- an
    // unrecognized value falls through and returns `undefined`, not a
    // silently-chosen freeze/continue/restrict outcome.
    expect(ordinaryExecute(corrupted)).toBeUndefined();
  });
});

describe("UNRESOLVED: policyWriteConflictPolicy has no default", () => {
  function pendingLostKeyState(policyWriteConflictPolicy: "block" | "invalidate-attempt" | "other") {
    let state = createState(baseConfig("continue", policyWriteConflictPolicy));
    return beginLostKeyAttempt(state);
  }

  it("block rejects an ordinary write conflicting with a live lost-key snapshot", () => {
    const state = pendingLostKeyState("block");
    expect(() => ordinaryPolicyWrite(state, { docHash: "doc:new", signers: { admin: "cred-x" } })).toThrow(
      /BLOCKED_BY_PENDING_RECOVERY/,
    );
  });

  it("invalidate-attempt allows the write but invalidates the in-flight attempt", () => {
    const state = pendingLostKeyState("invalidate-attempt");
    const next = ordinaryPolicyWrite(state, { docHash: "doc:new", signers: { admin: "cred-x" } });
    expect(next.liveDoc.signers.admin).toBe("cred-x");
    expect(next.activeAttempt).toBeNull();
    expect(next.history.at(-1)?.state).toBe("invalidated");
  });

  it("other is left symbolic: it throws rather than silently picking block or invalidate", () => {
    const state = pendingLostKeyState("other");
    expect(() => ordinaryPolicyWrite(state, { docHash: "doc:new", signers: { admin: "cred-x" } })).toThrow(
      /UNRESOLVED_POLICY_BRANCH/,
    );
  });

  it("does not apply to a compromise attempt (the conflict is specific to the lost-key source snapshot)", () => {
    let state = createState(baseConfig("continue", "block", zkModeOverrides()));
    state = beginAttempt(
      state,
      { attemptId: "a1", action: "compromise", replacements: [{ role: "admin", oldCredentialId: "cred-admin-0", newCredentialId: "cred-admin-1" }] },
      0,
    );
    const next = ordinaryPolicyWrite(state, { docHash: "doc:new", signers: { admin: "cred-x" } });
    expect(next.liveDoc.signers.admin).toBe("cred-x");
    expect(next.activeAttempt?.state).toBe("collecting-evidence"); // untouched
  });
});
