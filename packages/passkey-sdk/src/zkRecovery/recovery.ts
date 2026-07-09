/**
 * ZK-recovery transaction builders.
 *
 * These build the four operations of the recovery state machine (spec §3.3,
 * §4.1): `initiate_recovery` / `cancel_recovery` / `burn_nullifier` against
 * the `@nidohq/zk-recovery` controller, and the zero-signer completion
 * `add_context_rule` against the recovering account itself (spec §3.1).
 *
 * All four builders are deliberately SYNCHRONOUS and make no RPC call. By
 * the time a caller reaches this module, every argument (nonce, merkle
 * root, nullifier, proof) has already been resolved off-chain (pool sync +
 * prover worker) -- there is nothing left to simulate or discover from the
 * network, unlike `policyBlocks/multisigRotation.ts`'s `buildRotation`,
 * which is genuinely async because the generated `Client` methods route
 * through `AssembledTransaction.build()`, and that always awaits
 * `getAccount`/`simulateTransaction` even when nothing is ultimately
 * network-dependent (see `MethodOptions.simulate`/`ClientOptions.publicKey`
 * in `@stellar/stellar-sdk/contract`). Constructing the op directly instead
 * -- `new Contract(id).call(method, ...scVals)` -- is not a shortcut around
 * that machinery: it is the EXACT same primitive `AssembledTransaction.build`
 * calls internally (see its source), just invoked without the
 * account-fetch/simulate wrapper. Because we never round-trip through
 * `TransactionBuilder.build()` (which is what turns operations into the POJO
 * shape `assembledTx.ts::extractXdrOperations` exists to repair), the
 * `Contract.call()` result is already a proper `xdr.Operation` instance --
 * no extraction step needed.
 *
 * DUAL-STELLAR-BASE HAZARD (see `multisigRotation.ts:42-56` and the plan's
 * Global Constraints): every ScVal here is built through the RELEVANT
 * bindings' `Spec` -- `@nidohq/zk-recovery`'s for the pool/state-machine
 * calls, `@nidohq/smart-account`'s for the completion call -- via
 * `spec.funcArgsToScVals(...)`, never the bare `@stellar/stellar-sdk`
 * specifier. Only the inert op-envelope wiring (`Contract`, which accepts
 * already-built ScVals and does no ScVal construction of its own) comes
 * from the bare specifier, exactly as `assembledTx.ts` and
 * `multisigRotation.ts` already do for the same reason.
 */

import { Buffer } from 'buffer';
import { Contract } from '@stellar/stellar-sdk';
import type { Spec } from '@stellar/stellar-sdk/contract';
import { Client as ZkRecoveryClient } from '@nidohq/zk-recovery';
import { Client as SmartAccountClient } from '@nidohq/smart-account';
import type { TxBuild } from '../policyBlocks/types.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

// Dummy contract id -- we only need the embedded static `.spec`, never an
// RPC call (same trick as `multisigRotation.ts::thresholdPolicySpec`).
const DUMMY_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

let memoizedZkRecoverySpec: Spec | undefined;
function zkRecoverySpec(): Spec {
  memoizedZkRecoverySpec ??= new ZkRecoveryClient({
    contractId: DUMMY_CONTRACT_ID,
    networkPassphrase: TESTNET_PASSPHRASE,
    rpcUrl: 'https://soroban-testnet.stellar.org',
  }).spec;
  // `??=` guarantees this is assigned; the assertion satisfies tsc's
  // control-flow analysis (a closed-over `let` isn't narrowed across the call).
  return memoizedZkRecoverySpec!;
}

let memoizedSmartAccountSpec: Spec | undefined;
function smartAccountSpec(): Spec {
  memoizedSmartAccountSpec ??= new SmartAccountClient({
    contractId: DUMMY_CONTRACT_ID,
    networkPassphrase: TESTNET_PASSPHRASE,
    rpcUrl: 'https://soroban-testnet.stellar.org',
  }).spec;
  return memoizedSmartAccountSpec!;
}

function requirePubkey65(newPubkey65: Uint8Array, fnName: string): void {
  if (newPubkey65.length !== 65) {
    throw new Error(
      `${fnName}: new pubkey must be a 65-byte SEC1 uncompressed P-256 key, got ${newPubkey65.length}`,
    );
  }
}

function requireBytes32(value: Uint8Array, argName: string, fnName: string): void {
  if (value.length !== 32) {
    throw new Error(`${fnName}: ${argName} must be 32 bytes, got ${value.length}`);
  }
}

/** Shared shape of the zk-recovery pool/state-machine proof arguments. */
interface ProofArgs {
  controllerId: string;
  account: string;
  nonce: bigint;
  root: Uint8Array;
  nullifier: Uint8Array;
  proof: Uint8Array;
}

export interface InitiateRecoveryArgs extends ProofArgs {
  /** 65-byte SEC1 uncompressed P-256 key the recovery will install. */
  newPubkey65: Uint8Array;
  /** Requested timelock duration in seconds (spec §3.3: floor + per-account config, bound in auth_hash). */
  timelockSecs: number;
}

/**
 * Build the (permissionless) `initiate_recovery` operation. `nonce`, `root`,
 * `nullifier`, and `proof` must already be computed off-chain (authHash.ts +
 * the prover worker) against the SAME canonical args the contract will
 * recompute -- this function does no field/hash math of its own.
 */
export function buildInitiateRecovery(args: InitiateRecoveryArgs): TxBuild {
  requirePubkey65(args.newPubkey65, 'buildInitiateRecovery');
  requireBytes32(args.root, 'root', 'buildInitiateRecovery');
  requireBytes32(args.nullifier, 'nullifier', 'buildInitiateRecovery');

  const scVals = zkRecoverySpec().funcArgsToScVals('initiate_recovery', {
    account: args.account,
    new_pubkey: Buffer.from(args.newPubkey65),
    nonce: args.nonce,
    timelock_secs: args.timelockSecs,
    root: Buffer.from(args.root),
    nullifier: Buffer.from(args.nullifier),
    proof: Buffer.from(args.proof),
  });

  return {
    operations: [new Contract(args.controllerId).call('initiate_recovery', ...scVals)],
    description: 'Initiate account recovery',
  };
}

/**
 * Build the `cancel_recovery` operation (owner's passkey auth + a fresh
 * action=2 proof; releases the nullifier's reservation without spending it).
 */
export function buildCancelRecovery(args: ProofArgs): TxBuild {
  requireBytes32(args.root, 'root', 'buildCancelRecovery');
  requireBytes32(args.nullifier, 'nullifier', 'buildCancelRecovery');

  const scVals = zkRecoverySpec().funcArgsToScVals('cancel_recovery', {
    account: args.account,
    nonce: args.nonce,
    root: Buffer.from(args.root),
    nullifier: Buffer.from(args.nullifier),
    proof: Buffer.from(args.proof),
  });

  return {
    operations: [new Contract(args.controllerId).call('cancel_recovery', ...scVals)],
    description: 'Cancel pending account recovery',
  };
}

/**
 * Build the `burn_nullifier` operation (owner's passkey auth + a fresh
 * action=3/revoke proof of secret-knowledge; permanently spends the
 * nullifier so a leaked secret can never be used to initiate recovery).
 */
export function buildBurnNullifier(args: ProofArgs): TxBuild {
  requireBytes32(args.root, 'root', 'buildBurnNullifier');
  requireBytes32(args.nullifier, 'nullifier', 'buildBurnNullifier');

  const scVals = zkRecoverySpec().funcArgsToScVals('burn_nullifier', {
    account: args.account,
    nonce: args.nonce,
    root: Buffer.from(args.root),
    nullifier: Buffer.from(args.nullifier),
    proof: Buffer.from(args.proof),
  });

  return {
    operations: [new Contract(args.controllerId).call('burn_nullifier', ...scVals)],
    description: 'Burn compromised nullifier',
  };
}

export interface CompleteRecoveryArgs {
  /** The recovering smart account -- also the target of this direct self-call. */
  account: string;
  /** The account's zero-signer `zk-recovery` rule id (spec §3.1); selected via `contextRuleIds`. */
  recoveryRuleId: number;
  /** 65-byte SEC1 uncompressed P-256 key that matured through `initiate_recovery`. */
  newPubkey65: Uint8Array;
  /** WebAuthn verifier contract address the new signer is registered against. */
  webauthnVerifierId: string;
}

export interface CompleteRecoveryTxBuild extends TxBuild {
  /**
   * Context rule ids aligned by index with `operations` -- this op is
   * authorized purely by the zero-signer recovery rule (the controller's
   * `enforce` is the authority, per spec §3.1), so the one entry here is
   * `recoveryRuleId`. Feed this into the downstream signing flow's
   * `AuthPayload { signers: {}, context_rule_ids }` -- ZERO signers, exactly
   * as `multisigRotation.ts::RotationTxBuild.contextRuleIds` documents for
   * the analogous friend-signed case, except here there is nothing to
   * collect: the rule has no signers, only the zk-recovery policy.
   */
  contextRuleIds: number[];
}

/**
 * Build the recovery *completion* op: a permissionless direct invocation of
 * `account.add_context_rule(Default, "recovered", None,
 * [Signer::External(webauthn_verifier, new_pubkey)], {})` -- a brand-new
 * Default rule, never `add_signer` on the existing one (OZ requires ALL
 * signers of a policy-less rule to co-sign, so adding a second signer to the
 * lost-key's rule would deadlock the new passkey; spec §3.1).
 *
 * This is the exact shape proven against the live OZ host by
 * `crates/integration-tests/tests/it/zk_recovery_completion.rs` /
 * `zk_completion_spike.rs`: `ContextRuleType::Default`, name `"recovered"`,
 * `valid_until: None`, a single `Signer::External` entry, an empty policies
 * map, authorized by a ZERO-signer `AuthPayload` selecting only
 * `recoveryRuleId` -- never a `Signer::Delegated`/friend entry (that would
 * put the controller on the call stack twice, which Soroban's reentrancy ban
 * forbids; spec §3.1).
 */
export function buildCompleteRecovery(args: CompleteRecoveryArgs): CompleteRecoveryTxBuild {
  requirePubkey65(args.newPubkey65, 'buildCompleteRecovery');

  const scVals = smartAccountSpec().funcArgsToScVals('add_context_rule', {
    context_type: { tag: 'Default', values: undefined },
    name: 'recovered',
    valid_until: undefined,
    signers: [
      {
        tag: 'External',
        values: [args.webauthnVerifierId, Buffer.from(args.newPubkey65)] as readonly [
          string,
          Buffer,
        ],
      },
    ],
    policies: new Map(),
  });

  return {
    operations: [new Contract(args.account).call('add_context_rule', ...scVals)],
    description: 'Complete account recovery (install recovered passkey)',
    contextRuleIds: [args.recoveryRuleId],
  };
}
