//! Evidence-submission transaction builders
//! (`contracts/recovery-controller/src/contract.rs`):
//!
//!   - `submit_guardian_approval` / `submit_guardian_cancel` — GUARDIAN-authed
//!     (`guardian.require_auth()`). The guardian is an arbitrary G/C address,
//!     not necessarily the recovering account itself, so these are thin
//!     `TxBuild`-returning wrappers like every other builder in this module;
//!     signing is the CALLER's job via whatever wallet the guardian already
//!     uses — a classic (G-address) wallet through
//!     `packages/frontend/src/lib/walletConnect.ts`'s `StellarWalletsKit`
//!     session (`signTransaction`), or, if the guardian is itself a Nido
//!     smart account, through the SAME kit's `NidoModule`
//!     (`@nidohq/stellar-wallets-kit-module`) — no new signing flow is
//!     introduced here.
//!   - `submit_zk_proof` / `submit_zk_cancel` — PERMISSIONLESS on-chain (the
//!     proof itself is the authorization; mirrors
//!     `../zkRecovery/recovery.ts`'s `buildInitiateRecovery`/
//!     `buildCancelRecovery`). Takes an ALREADY-GENERATED proof + public
//!     inputs (root/nullifier) — this module never generates a proof itself;
//!     see `scripts/generate-recovery-proof.mjs` (repo root) for the
//!     Node/nargo/bb CLI that does, and `docAuthHash.ts` for the on-chain
//!     `auth_hash` recompute this SDK can independently verify a witness
//!     against before shelling out.
import { Contract } from '@stellar/stellar-sdk';
import type { Spec } from '@stellar/stellar-sdk/contract';
import { Client as RecoveryControllerClient } from '@nidohq/recovery-controller';
import type { TxBuild } from '../policyBlocks/types.js';
import { toBytes, toBytes32 } from './bytes.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
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

export interface GuardianEvidenceArgs {
  controllerId: string;
  account: string;
  attemptId: bigint | number;
  /** The guardian G/C address submitting this evidence — must
   *  `require_auth()` on-chain and be a member of the enrolled
   *  `GuardianSet`, or the call fails (`Error::NotAGuardian`). */
  guardian: string;
}

/** Build the (guardian-authed) `submit_guardian_approval` operation —
 *  initiation-domain evidence. `GuardianOnly`/`Combined` accounts only;
 *  `ZkOnly` refuses with `Error::ModeMismatch`. */
export function buildSubmitGuardianApproval(args: GuardianEvidenceArgs): TxBuild {
  const scVals = recoveryControllerSpec().funcArgsToScVals('submit_guardian_approval', {
    account: args.account,
    attempt_id: BigInt(args.attemptId),
    guardian: args.guardian,
  });
  return {
    operations: [new Contract(args.controllerId).call('submit_guardian_approval', ...scVals)],
    description: `Guardian approval for attempt #${args.attemptId}`,
  };
}

/** Build the (guardian-authed) `submit_guardian_cancel` operation —
 *  CANCELLATION-domain evidence (own action domain, separate storage from
 *  initiation; see `contract.rs::CancelTally`). */
export function buildSubmitGuardianCancel(args: GuardianEvidenceArgs): TxBuild {
  const scVals = recoveryControllerSpec().funcArgsToScVals('submit_guardian_cancel', {
    account: args.account,
    attempt_id: BigInt(args.attemptId),
    guardian: args.guardian,
  });
  return {
    operations: [new Contract(args.controllerId).call('submit_guardian_cancel', ...scVals)],
    description: `Guardian cancellation for attempt #${args.attemptId}`,
  };
}

export interface ZkEvidenceArgs {
  controllerId: string;
  account: string;
  attemptId: bigint | number;
  /** A known historical Merkle root of the enrolled `zk_pool` (hex or 32
   *  bytes). */
  root: Uint8Array | string;
  /** The proof's nullifier (hex or 32 bytes) — reserved to this account on
   *  success; a nullifier already `Spent`, or `Reserved` by a different
   *  account/attempt, fails (`Error::NullifierUnavailable`). */
  nullifier: Uint8Array | string;
  /** The `bb prove` UltraHonk proof bytes (hex or raw), generated OFFLINE —
   *  see `scripts/generate-recovery-proof.mjs`. This function does no proof
   *  generation or validation of its own; the contract's cross-called
   *  `nido-recovery-verifier` is the sole verifier. */
  proof: Uint8Array | string;
}

/** Build the PERMISSIONLESS `submit_zk_proof` operation — initiation-domain
 *  ZK evidence. `ZkOnly`/`Combined` accounts only; `GuardianOnly` refuses
 *  with `Error::ModeMismatch`. The contract recomputes `auth_hash` from the
 *  attempt's OWN frozen commitment fields (never trusts a caller-supplied
 *  hash) — see `docAuthHash.ts::computeDocAuthHash` for the SAME recompute,
 *  client-side, useful for sanity-checking a witness before submission. */
export function buildSubmitZkProof(args: ZkEvidenceArgs): TxBuild {
  const scVals = recoveryControllerSpec().funcArgsToScVals('submit_zk_proof', {
    account: args.account,
    attempt_id: BigInt(args.attemptId),
    root: toBytes32(args.root, 'root'),
    nullifier: toBytes32(args.nullifier, 'nullifier'),
    proof: toBytes(args.proof),
  });
  return {
    operations: [new Contract(args.controllerId).call('submit_zk_proof', ...scVals)],
    description: `ZK proof for attempt #${args.attemptId}`,
  };
}

/** Build the PERMISSIONLESS `submit_zk_cancel` operation —
 *  CANCELLATION-domain ZK evidence. The proof's `auth_hash` binds
 *  `action = Cancel` (`docAuthHash.ts::ACTION_CANCEL`), so an initiation
 *  proof can never double as cancellation evidence or vice versa. */
export function buildSubmitZkCancel(args: ZkEvidenceArgs): TxBuild {
  const scVals = recoveryControllerSpec().funcArgsToScVals('submit_zk_cancel', {
    account: args.account,
    attempt_id: BigInt(args.attemptId),
    root: toBytes32(args.root, 'root'),
    nullifier: toBytes32(args.nullifier, 'nullifier'),
    proof: toBytes(args.proof),
  });
  return {
    operations: [new Contract(args.controllerId).call('submit_zk_cancel', ...scVals)],
    description: `ZK cancellation for attempt #${args.attemptId}`,
  };
}
