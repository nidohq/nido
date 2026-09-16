// Shared builders for the adversarial/lifecycle test suites. Not part of the
// public model surface -- kept alongside the tests it serves.

import {
  AccountRecoveryState,
  GuardianSet,
  PendingActivityPolicy,
  PolicyWriteConflictPolicy,
  ProposalCommitment,
  RecoveryConfig,
  VerifierConfig,
  makeDoc,
} from "./model.js";

export const ACCOUNT = "GACCOUNT000000000000000000000000000000000000000000";
export const NETWORK = "testnet";
export const CONTROLLER = "recovery-controller-1";

const DEFAULT_GUARDIANS: GuardianSet = { guardians: ["g1", "g2", "g3"], threshold: 2 };
const DEFAULT_VERIFIER: VerifierConfig = { address: "C_ZK_VERIFIER", vkCommitment: "vk-sha256-abc" };

// The two Section 7 axes are required parameters here too -- every call site
// must state its choice, exactly like the model itself never defaults them.
export function baseConfig(
  pendingActivityPolicy: PendingActivityPolicy,
  policyWriteConflictPolicy: PolicyWriteConflictPolicy,
  overrides: Partial<RecoveryConfig> = {},
): RecoveryConfig {
  return {
    version: 1,
    mode: "guardians",
    profile: "loss",
    guardianSet: DEFAULT_GUARDIANS,
    baseline: {
      id: "baseline-1",
      doc: makeDoc({ admin: "cred-admin-0" }),
      replaceableRoles: ["admin"],
    },
    delaySeconds: 100,
    expirySeconds: 50,
    maxCancels: 3,
    pendingActivityPolicy,
    policyWriteConflictPolicy,
    revokedCredentialIds: [],
    ...overrides,
  };
}

export function zkModeOverrides(): Partial<RecoveryConfig> {
  return { mode: "zk", guardianSet: undefined, verifier: DEFAULT_VERIFIER };
}

export function combinedModeOverrides(): Partial<RecoveryConfig> {
  return { mode: "combined", guardianSet: DEFAULT_GUARDIANS, verifier: DEFAULT_VERIFIER };
}

export function createState(
  config: RecoveryConfig,
  liveDocSigners: Record<string, string> = { admin: "cred-admin-0" },
): AccountRecoveryState {
  return {
    account: ACCOUNT,
    network: NETWORK,
    controllerId: CONTROLLER,
    config,
    liveDoc: makeDoc(liveDocSigners),
    activeAttempt: null,
    history: [],
    reservedNullifiers: [],
    spentNullifiers: [],
  };
}

export function initiationCommitmentFor(state: AccountRecoveryState): ProposalCommitment {
  if (!state.activeAttempt) throw new Error("test fixture: no active attempt");
  return state.activeAttempt.commitment;
}

export function cancelCommitmentFor(state: AccountRecoveryState): ProposalCommitment {
  return { ...initiationCommitmentFor(state), action: "cancel" };
}

export const ALWAYS_INSTALLS = () => true;
export const ALWAYS_FAILS_INSTALL = () => false;
