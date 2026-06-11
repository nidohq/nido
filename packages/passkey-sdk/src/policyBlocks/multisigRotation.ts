/**
 * Recovery *completion* (key rotation).
 *
 * Once friends have collected enough signatures, the recovering account needs
 * a transaction that rotates its signers: typically `add_signer(new passkey)`
 * on the default rule, optionally paired with `remove_signer(old signer id)`.
 *
 * That transaction is authorized NOT by the lost primary passkey but by the
 * recovery rule — a `CallContract(self)` rule gated by the multisig-policy.
 * So its `AuthPayload.context_rule_ids` must reference the recovery rule id,
 * and its `signers` map carries one `Delegated(friend)` entry per friend whose
 * signature counts toward the threshold (see `multiSigner.ts`).
 *
 * `planRotation` is a pure function (unit-testable, no RPC) that turns a
 * rotation request into the sequence of contract calls. `buildRotation`
 * threads those through the generated bindings to produce XDR operations,
 * mirroring `multisigRecovery.buildInstall`.
 */

import { Buffer } from 'buffer';
import { xdr } from '@stellar/stellar-sdk';
import { Client as SmartAccountClient } from 'smart-account';
import type { Signer } from 'smart-account';
import { extractXdrOperations } from '../assembledTx.js';
import type { TxBuild } from './types.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** A new External (passkey) signer to install. */
export interface NewPasskeySigner {
  /** WebAuthn verifier contract address the account trusts. */
  verifierAddress: string;
  /** 65-byte SEC1 uncompressed P-256 public key. */
  publicKey: Uint8Array;
}

/**
 * Current on-chain state of the rule being rotated, as far as the planner
 * needs it. Callers read this from `get_context_rule(defaultRuleId)`.
 */
export interface RotationRuleState {
  /** Number of signers currently on the rule. */
  signerCount: number;
  /** Number of policies currently attached to the rule. */
  policyCount: number;
}

/** The rotation the owner wants performed. */
export interface RotationRequest {
  /**
   * The rule id whose signers are being rotated — almost always the default
   * rule (id 0), which holds the account's primary passkey.
   */
  defaultRuleId: number;
  /** New passkey to add as a signer (the recovered key). */
  addPasskey?: NewPasskeySigner;
  /** Existing signer id to remove (the lost key). */
  removeSignerId?: number;
  /**
   * Current state of the rule (issue #87). When provided together with
   * `thresholdPolicyAddress`, the planner appends an
   * `add_policy(defaultRuleId, thresholdPolicyAddress, threshold=1)` call
   * whenever the rotation would leave the rule with MORE THAN ONE signer and
   * NO policy. OZ semantics make a policy-less multi-signer rule N-of-N:
   * every signer must co-sign every ceremony, which bricks single-passkey
   * wallets. Installing a 1-of-N simple-threshold policy turns multi-device
   * into a feature instead of a brick.
   *
   * When omitted, the planner emits no policy call (legacy behavior).
   */
  ruleState?: RotationRuleState;
  /**
   * Address of the multisig (simple-threshold) policy contract to install
   * when the rotation leaves the rule N-of-N. See `ruleState`.
   */
  thresholdPolicyAddress?: string;
}

/** A single contract call making up a rotation. */
export type RotationCall =
  | {
      method: 'add_signer';
      contextRuleId: number;
      signer: Extract<Signer, { tag: 'External' }>;
    }
  | {
      method: 'remove_signer';
      contextRuleId: number;
      signerId: number;
    }
  | {
      method: 'add_policy';
      contextRuleId: number;
      policyAddress: string;
      /** Simple-threshold M (we always install 1 — see `RotationRequest.ruleState`). */
      threshold: number;
    };

export interface RotationPlan {
  calls: RotationCall[];
}

/**
 * Turn a rotation request into an ordered list of contract calls. Pure — no
 * RPC, no client. `add_signer` is emitted before `remove_signer` so the
 * account never transiently has zero signers on the rule.
 *
 * Threshold-policy auto-install (issue #87): when `ruleState` +
 * `thresholdPolicyAddress` are provided and the rotation would leave the rule
 * with >1 signer and no policy, an `add_policy(…, threshold: 1)` call is
 * emitted FIRST. Ordering matters: each call rides its own transaction
 * (Soroban allows one InvokeHostFunction op per tx), so installing the policy
 * before `add_signer` means there is never an intermediate N-of-N state —
 * and a 1-of-1 threshold on a single-signer rule is harmless if the sequence
 * stops early. A rotation that brings the rule back DOWN to one signer leaves
 * any existing policy in place (1-of-1 is harmless too).
 *
 * A request with NEITHER add nor remove but a bricked `ruleState`
 * (multi-signer, no policy) is valid: it plans the repair-only
 * `add_policy` call.
 */
export function planRotation(req: RotationRequest): RotationPlan {
  const calls: RotationCall[] = [];

  if (req.ruleState && req.thresholdPolicyAddress) {
    const adds = req.addPasskey ? 1 : 0;
    const removes = typeof req.removeSignerId === 'number' ? 1 : 0;
    const resultingSigners = req.ruleState.signerCount + adds - removes;
    if (req.ruleState.policyCount === 0 && resultingSigners > 1) {
      calls.push({
        method: 'add_policy',
        contextRuleId: req.defaultRuleId,
        policyAddress: req.thresholdPolicyAddress,
        // 1-of-N: any single signer can authorize. The simple-threshold
        // install validates threshold <= current signer count, and the rule
        // always has >= 1 signer, so installing 1 first is always valid.
        threshold: 1,
      });
    }
  }

  if (req.addPasskey) {
    if (req.addPasskey.publicKey.length !== 65) {
      throw new Error(
        `planRotation: new passkey must be a 65-byte SEC1 uncompressed P-256 key, got ${req.addPasskey.publicKey.length}`,
      );
    }
    calls.push({
      method: 'add_signer',
      contextRuleId: req.defaultRuleId,
      signer: {
        tag: 'External',
        values: [
          req.addPasskey.verifierAddress,
          Buffer.from(req.addPasskey.publicKey),
        ] as readonly [string, Buffer],
      },
    });
  }

  if (typeof req.removeSignerId === 'number') {
    calls.push({
      method: 'remove_signer',
      contextRuleId: req.defaultRuleId,
      signerId: req.removeSignerId,
    });
  }

  if (calls.length === 0) {
    throw new Error('planRotation: nothing to rotate (no add or remove specified)');
  }

  return { calls };
}

/** Human-readable summary of a rotation plan for the signing UI. */
export function describeRotation(plan: RotationPlan): string {
  const parts: string[] = [];
  for (const c of plan.calls) {
    if (c.method === 'add_signer') parts.push('add a new passkey');
    else if (c.method === 'remove_signer') parts.push(`remove signer #${c.signerId}`);
    else parts.push(`install a ${c.threshold}-of-N approval policy`);
  }
  return `Recovery rotation: ${parts.join(' and ')}`;
}

export interface BuildRotationArgs {
  /** Smart account being recovered. */
  account: string;
  rpcUrl: string;
  /** The on-chain recovery rule id (CallContract(self) + multisig policy). */
  recoveryRuleId: number;
  /** The rotation to perform. */
  request: RotationRequest;
}

export interface RotationTxBuild extends TxBuild {
  /**
   * Context rule ids aligned by index with `operations` — every op is
   * authorized by the recovery rule, so each entry is `recoveryRuleId`.
   * Feed this to the auth-digest computation and the AuthPayload.
   */
  contextRuleIds: number[];
}

/**
 * Build the unsigned rotation transaction operations plus the metadata the
 * signing flow needs: the recovery rule id each op is authorized under, and a
 * description. Mirrors `multisigRecovery.buildInstall`.
 *
 * The returned operations are unsigned; the caller simulates, computes the
 * per-op `auth_digest = sha256(signature_payload || [recoveryRuleId].to_xdr())`,
 * collects friend signatures over it, and injects them before submitting.
 */
export async function buildRotation(args: BuildRotationArgs): Promise<RotationTxBuild> {
  const plan = planRotation(args.request);

  const client = new SmartAccountClient({
    contractId: args.account,
    networkPassphrase: TESTNET_PASSPHRASE,
    rpcUrl: args.rpcUrl,
  });

  const operations: RotationTxBuild['operations'] = [];
  for (const call of plan.calls) {
    let tx;
    if (call.method === 'add_signer') {
      tx = await client.add_signer({
        context_rule_id: call.contextRuleId,
        signer: call.signer,
      });
    } else if (call.method === 'remove_signer') {
      tx = await client.remove_signer({
        context_rule_id: call.contextRuleId,
        signer_id: call.signerId,
      });
    } else {
      tx = await client.add_policy({
        context_rule_id: call.contextRuleId,
        policy: call.policyAddress,
        // The binding erases the install param to `any` (it is a Val on
        // chain); hand it a pre-encoded ScVal — the generated client passes
        // ScVal instances through untouched. SimpleThresholdAccountParams
        // is a one-field struct → ScMap with a single Symbol key.
        install_param: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('threshold'),
            val: xdr.ScVal.scvU32(call.threshold),
          }),
        ]),
      });
    }
    operations.push(...extractXdrOperations(tx, 'multisig-rotation'));
  }

  return {
    operations,
    contextRuleIds: operations.map(() => args.recoveryRuleId),
    description: describeRotation(plan),
  };
}
