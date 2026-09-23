//! `begin_attempt` transaction builder — opens a new recovery attempt
//! (`contracts/recovery-controller/src/contract.rs::begin_attempt`).
//! PERMISSIONLESS on-chain (no `require_auth` at all — declaring intent
//! carries no authority by itself); submit with a funded fee-payer only, no
//! passkey/wallet signature required (mirrors
//! `../zkRecovery/recovery.ts::buildInitiateRecovery`'s permissionless
//! submission pattern; the frontend page wires this up the same way
//! `zkRecoveryActions.ts::submitPermissionlessOp` does for M1).
import { Contract } from '@stellar/stellar-sdk';
import type { Spec } from '@stellar/stellar-sdk/contract';
import { Client as RecoveryControllerClient } from '@nidohq/recovery-controller';
import type { TxBuild } from '../policyBlocks/types.js';
import type { RecoveryActionInput, RecoveryActionScVal } from './types.js';
import { toBytes32 } from './bytes.js';

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

// See `config.ts`'s comment on `authModeScVal` for why this asserts rather
// than lets the tag union distribute structurally.
function recoveryActionScVal(action: RecoveryActionInput): RecoveryActionScVal {
  return { tag: action, values: undefined } as RecoveryActionScVal;
}

export interface BuildBeginAttemptArgs {
  controllerId: string;
  account: string;
  action: RecoveryActionInput;
  /** The TARGET document's canonical hash (`targetDoc.ts::targetDocHash`) —
   *  hex string or 32 bytes. */
  targetDocHash: Uint8Array | string;
  /** For `Compromise`: MUST equal the enrolled `config.baseline_doc_hash`
   *  exactly, or the call fails on-chain (`Error::BaselineMismatch`). For
   *  `LostKey`: the CALLER's captured current-live-document hash (a defined
   *  source snapshot at this exact moment — see the fn's Rust doc comment
   *  for the trust boundary this implies: the contract does not itself
   *  fetch or verify the live doc hash). */
  sourceOrBaselineHash: Uint8Array | string;
  /** Client-declared credential ids the target document replaces
   *  (`targetDoc.ts::credentialIdForSigner`) — bookkeeping only, see that
   *  module's doc comment. */
  replacedCredentialIds: (Uint8Array | string)[];
}

/** Build the permissionless `begin_attempt` operation. Returns a
 *  `#[must_use] u64` attempt id on-chain — decode it from the simulate/send
 *  result, or just re-read via `reads.ts::readAttempt` after submission. */
export function buildBeginAttempt(args: BuildBeginAttemptArgs): TxBuild {
  const scVals = recoveryControllerSpec().funcArgsToScVals('begin_attempt', {
    account: args.account,
    action: recoveryActionScVal(args.action),
    target_doc_hash: toBytes32(args.targetDocHash, 'targetDocHash'),
    source_or_baseline_hash: toBytes32(args.sourceOrBaselineHash, 'sourceOrBaselineHash'),
    replaced_credential_ids: args.replacedCredentialIds.map((id, i) =>
      toBytes32(id, `replacedCredentialIds[${i}]`),
    ),
  });
  return {
    operations: [new Contract(args.controllerId).call('begin_attempt', ...scVals)],
    description: `Begin ${args.action} recovery attempt`,
  };
}
