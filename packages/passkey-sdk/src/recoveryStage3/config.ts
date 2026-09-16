//! Recovery enrollment: `buildRecoveryConfig` maps ergonomic JS input onto the
//! EXACT `contracts/recovery-controller/src/types.rs::RecoveryConfig` field
//! shape, and `buildEnroll` builds the (self-authed) `enroll` operation.
//!
//! Mirrors `../zkRecovery/recovery.ts`'s SYNCHRONOUS `TxBuild` pattern: no
//! RPC call here, only ScVal encoding via the generated bindings' `Spec`
//! (`spec.funcArgsToScVals`) plus a bare `Contract(...).call(...)` op — the
//! exact same primitive `AssembledTransaction.build()` uses internally, just
//! without the account-fetch/simulate wrapper (see that module's doc
//! comment for the full "why sync" rationale, which applies verbatim here).
import { Buffer } from 'buffer';
import { Contract } from '@stellar/stellar-sdk';
import type { Spec } from '@stellar/stellar-sdk/contract';
import { Client as RecoveryControllerClient, type RecoveryConfig } from '@nidohq/recovery-controller';
import type { TxBuild } from '../policyBlocks/types.js';
import type { AuthModeInput, PendingActivityPolicyInput, ProfileInput, RecoveryConfigInput } from './types.js';
import { toBytes32 } from './bytes.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

// Dummy contract id — we only need the embedded static `.spec`, never an RPC
// call (same trick as `zkRecovery/recovery.ts::zkRecoverySpec`).
const DUMMY_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

let memoizedSpec: Spec | undefined;
function recoveryControllerSpec(): Spec {
  memoizedSpec ??= new RecoveryControllerClient({
    contractId: DUMMY_CONTRACT_ID,
    networkPassphrase: TESTNET_PASSPHRASE,
    rpcUrl: 'https://soroban-testnet.stellar.org',
  }).spec;
  return memoizedSpec!;
}

// `RecoveryConfig`'s enum fields are generated as discriminated unions of
// per-tag literal object types (`{tag: "GuardianOnly", values: void} | ...`).
// Building `{tag: mode, values: undefined}` from a WIDENED `mode: AuthModeInput`
// union does not structurally match any single member (TS does not
// distribute a union-valued `tag` across the target union), so we assert the
// shape instead of fighting the type checker over something the contract
// itself validates at `enroll` time anyway (`Error::ModeConfigMismatch` /
// `UnresolvedPolicyBranch` if the caller passes something inconsistent).
function authModeScVal(mode: AuthModeInput): RecoveryConfig['mode'] {
  return { tag: mode, values: undefined } as RecoveryConfig['mode'];
}

function profileScVal(profile: ProfileInput): RecoveryConfig['profile'] {
  return { tag: profile, values: undefined } as RecoveryConfig['profile'];
}

function pendingActivityPolicyScVal(
  policy: PendingActivityPolicyInput,
): RecoveryConfig['pending_activity_policy'] {
  return { tag: policy, values: undefined } as RecoveryConfig['pending_activity_policy'];
}

/**
 * Maps ergonomic `RecoveryConfigInput` onto the generated bindings'
 * `RecoveryConfig` (the exact `types.rs::RecoveryConfig` wire shape). Does
 * NOT validate mode/machinery/threshold consistency — `enroll` itself is the
 * source of truth for those checks (`Error::ModeConfigMismatch` /
 * `InvalidThreshold` / `UnresolvedPolicyBranch`); this function only
 * reshapes, it does not duplicate contract logic that could drift from it.
 */
export function buildRecoveryConfig(input: RecoveryConfigInput): RecoveryConfig {
  return {
    mode: authModeScVal(input.mode),
    profile: profileScVal(input.profile),
    guardians: input.guardians,
    guardian_threshold: input.guardianThreshold,
    verifier: input.verifier,
    zk_pool: input.zkPool,
    network_passphrase: Buffer.from(input.networkPassphrase, 'utf8'),
    baseline_doc_hash: toBytes32(input.baselineDocHash, 'baselineDocHash'),
    delay_secs: BigInt(input.delaySecs),
    expiry_secs: BigInt(input.expirySecs),
    max_cancels: input.maxCancels,
    version: input.version ?? 1,
    pending_activity_policy: pendingActivityPolicyScVal(input.pendingActivityPolicy),
  };
}

export interface BuildEnrollArgs {
  controllerId: string;
  account: string;
  config: RecoveryConfig;
}

/**
 * Build the (self-authed — `account.require_auth()`) `enroll` operation.
 * One-shot per account; a second `enroll` for the same account fails
 * on-chain with `Error::AlreadyEnrolled`. Sign with the account's own
 * passkey via the existing `signAndSubmit` flow
 * (`packages/frontend/src/lib/primaryPasskeySigner.ts`) — no new signing
 * flow is introduced here.
 */
export function buildEnroll(args: BuildEnrollArgs): TxBuild {
  const scVals = recoveryControllerSpec().funcArgsToScVals('enroll', {
    account: args.account,
    config: args.config,
  });
  return {
    operations: [new Contract(args.controllerId).call('enroll', ...scVals)],
    description: `Enroll in recovery (${args.config.mode.tag})`,
  };
}

export interface BuildReconfigureArgs {
  controllerId: string;
  account: string;
  /** The FULL proposed new config — same shape `enroll` takes. Every field
   *  other than the added factor (`guardians`/`guardian_threshold` OR
   *  `verifier`/`zk_pool`, whichever direction) must equal the account's
   *  CURRENTLY stored config exactly, or the contract refuses
   *  (`Error::ReconfigureFieldMismatch`) — build this by spreading the
   *  existing config (`readRecoveryConfig`) and only overwriting the added
   *  factor's fields plus `mode`, never rebuilding from scratch. */
  config: RecoveryConfig;
  /** `Profile::Protected` only: the enrolled guardians nested-authorizing
   *  THIS exact `(account, config)` pair in the same transaction (see
   *  `contracts/recovery-controller/src/contract.rs::reconfigure_digest`).
   *  Omit (or pass `[]`) for `Profile::Loss`, which needs no evidence. */
  guardianEvidence?: string[];
}

/**
 * Build the (self-authed — `account.require_auth()`, plus, for
 * `Profile::Protected`, the currently-enrolled factor's nested guardian
 * evidence) `reconfigure` operation — the ONE allowed mutation to an
 * already-enrolled account's config: strictly ADDING a missing evidence
 * factor (`GuardianOnly -> Combined` or `ZkOnly -> Combined`), never
 * anything else. See `contracts/recovery-controller/src/lib.rs`'s crate
 * doc comment for the full design and its remaining bound (no ZK
 * reconfigure-evidence path).
 */
export function buildReconfigure(args: BuildReconfigureArgs): TxBuild {
  const scVals = recoveryControllerSpec().funcArgsToScVals('reconfigure', {
    account: args.account,
    new_config: args.config,
    guardian_evidence: args.guardianEvidence ?? [],
  });
  return {
    operations: [new Contract(args.controllerId).call('reconfigure', ...scVals)],
    description: `Reconfigure recovery (-> ${args.config.mode.tag})`,
  };
}
