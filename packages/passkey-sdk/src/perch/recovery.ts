/**
 * The wallet's side of Perch recovery: reads and transaction builders for
 * the controller, plus the account and compiler calls a recovery needs.
 * Every builder returns a `TxBuild` (operations ready for the wallet's
 * signing flow), like the rest of the SDK.
 *
 * Who authorizes what (Perch `docs/recovery/spec.md`):
 *
 * | Operation | Authorized by |
 * | --- | --- |
 * | `begin_lost_key`, `begin_compromise`, `submit_zk`, `submit_zk_change`, `publish_baseline` | nobody: permissionless (the proof is the authorization) |
 * | `submit_guardian`, `approve_change` | the guardian's own account, signing the statement digest |
 * | `cancel_recovery` (account) | the owner, `Loss` profile only |
 * | completion `apply_doc` | anyone, selecting the account's zero-signer recovery rule |
 *
 * Configuration itself (enrollment, reconfiguration, removal) is never a
 * controller call: it is the account's own `apply_doc` of a document whose
 * `recovery` member changed (see `doc.ts`). Under `Protected` the change's
 * evidence is recorded first (`approveChange`/`submitZkChange`), then the
 * owner's `apply_doc` carries the same `approval_valid_until`.
 */

import { Buffer } from 'buffer';
import { Client as AccountClient } from '@nidohq/perch-account';
import { Client as CompilerClient } from '@nidohq/perch-doc-compiler';
import {
  Client as RecoveryClient,
  EvidenceDomain,
  RecoveryAction as BindingAction,
} from '@nidohq/perch-recovery';
import type {
  ActivityGate,
  Attempt,
  ReplacementSet as BindingReplacementSet,
  RecoveryStatement as BindingStatement,
  StatementSubject as BindingSubject,
  ZkEvidence as BindingEvidence,
} from '@nidohq/perch-recovery';
import { Address, xdr } from '@stellar/stellar-sdk';
import { extractXdrOperations } from '../assembledTx.js';
import { DEFAULT_EXPIRATION_OFFSET } from '../auth.js';
import { buildAuthPayloadScVal } from '../multiSigner.js';
import type { TxBuild } from '../policyBlocks/types.js';
import type { PerchDeployment } from './deployment.js';
import {
  sortReplacements,
  type Credential,
  type RecoveryStatement,
  type ReplacementSet,
  type StatementSubject,
} from './statement.js';
import type { ZkEvidence } from './zk.js';

export { EvidenceDomain };
export type { ActivityGate, Attempt };

export interface ChainArgs {
  deployment: PerchDeployment;
  rpcUrl: string;
}

const b = (u: Uint8Array): Buffer => Buffer.from(u);
const u8 = (x: Buffer | Uint8Array): Uint8Array => new Uint8Array(x);

/** A statement from the controller's binding, in the SDK's shape. */
export function statementFromChain(s: BindingStatement): RecoveryStatement {
  return {
    networkId: u8(s.network_id),
    account: s.account,
    controller: s.controller,
    configEpoch: BigInt(s.config.epoch),
    configHash: u8(s.config.config_hash),
    delayLedgers: s.timing.delay_ledgers,
    expiryLedgers: s.timing.expiry_ledgers,
    validUntilLedger: s.timing.valid_until_ledger,
    subject: subjectFromChain(s.subject),
  };
}

function subjectFromChain(s: BindingSubject): StatementSubject {
  switch (s.tag) {
    case 'LostKey':
    case 'Compromise': {
      const a = s.values[0];
      return {
        action: s.tag === 'LostKey' ? 'lost-key' : 'compromise',
        attemptId: BigInt(a.attempt_id),
        sourceDocHash: u8(a.source_doc_hash),
        targetDocHash: u8(a.target_doc_hash),
        replacementsHash: u8(a.replacements_hash),
      };
    }
    case 'Cancel':
      return {
        action: 'cancel',
        attemptId: BigInt(s.values[0].attempt_id),
        attemptStatement: u8(s.values[0].attempt_statement),
      };
    case 'Reconfigure': {
      const change = s.values[0];
      return {
        action: 'reconfigure',
        change:
          change.tag === 'Set'
            ? { kind: 'set', newConfigHash: u8(change.values[0]) }
            : { kind: 'remove' },
      };
    }
    case 'Upgrade':
      return {
        action: 'upgrade',
        requestId: BigInt(s.values[0].request_id),
        wasmHash: u8(s.values[0].wasm_hash),
      };
  }
}

/** A change subject for `approve_change`/`submit_zk_change`. */
export type ChangeSubject =
  | { kind: 'reconfigure-set'; configHash: Uint8Array }
  | { kind: 'reconfigure-remove' }
  | { kind: 'upgrade'; requestId: bigint; wasmHash: Uint8Array };

function subjectToChain(s: ChangeSubject): BindingSubject {
  switch (s.kind) {
    case 'reconfigure-set':
      return { tag: 'Reconfigure', values: [{ tag: 'Set', values: [b(s.configHash)] }] };
    case 'reconfigure-remove':
      return { tag: 'Reconfigure', values: [{ tag: 'Remove', values: undefined }] };
    case 'upgrade':
      return {
        tag: 'Upgrade',
        values: [{ request_id: s.requestId, wasm_hash: b(s.wasmHash) }],
      };
  }
}

function credentialToChain(c: Credential) {
  return c.kind === 'delegated'
    ? ({ tag: 'Delegated', values: [c.address] } as const)
    : ({ tag: 'External', values: [c.verifier, b(c.key)] } as const);
}

/** A replacement set in the controller's canonical order. */
export function replacementSetToChain(set: ReplacementSet): BindingReplacementSet {
  const sorted = sortReplacements(set);
  return {
    signers: sorted.signers.map((r) => ({
      signer_id: r.signerId,
      credential: credentialToChain(r.credential),
    })),
    zk_enrollment:
      sorted.zkEnrollment === undefined
        ? []
        : [{ id: b(sorted.zkEnrollment.id), commitment: b(sorted.zkEnrollment.commitment) }],
  };
}

function evidenceToChain(e: ZkEvidence): BindingEvidence {
  return { tree_id: e.treeId, root: b(e.root), nullifier: b(e.nullifier), proof: b(e.proof) };
}

/** Sign `account`'s auth entry in `op` by selecting its zero-signer recovery
 *  rule: an `AuthPayload` with no signers and that rule's id. */
export function selectRecoveryRule(
  op: xdr.Operation,
  account: string,
  recoveryRuleId: number,
  lastLedger: number,
): xdr.Operation {
  const invoke = op.body().invokeHostFunctionOp();
  const auth = invoke.auth().map((entry) => {
    const creds = entry.credentials();
    if (creds.switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) return entry;
    const address = creds.address();
    if (Address.fromScAddress(address.address()).toString() !== account) return entry;
    const signed = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
    const signedCreds = signed.credentials().address();
    signedCreds.signatureExpirationLedger(lastLedger + DEFAULT_EXPIRATION_OFFSET);
    signedCreds.signature(buildAuthPayloadScVal({ contextRuleIds: [recoveryRuleId], signers: [] }));
    return signed;
  });
  invoke.auth(auth);
  return op;
}

/** Unwrap a simulated read whose contract result is a `Result`. */
function ok<T>(r: { unwrap(): T } | T): T {
  return typeof (r as { unwrap?: unknown }).unwrap === 'function'
    ? (r as { unwrap(): T }).unwrap()
    : (r as T);
}

export class PerchRecovery {
  private readonly controller: RecoveryClient;
  private readonly args: ChainArgs;

  constructor(args: ChainArgs) {
    this.args = args;
    this.controller = new RecoveryClient({
      contractId: args.deployment.recoveryController,
      networkPassphrase: args.deployment.network,
      rpcUrl: args.rpcUrl,
    });
  }

  private account(account: string): AccountClient {
    return new AccountClient({
      contractId: account,
      networkPassphrase: this.args.deployment.network,
      rpcUrl: this.args.rpcUrl,
    });
  }

  // --- reads -------------------------------------------------------------

  async activityGate(account: string): Promise<ActivityGate> {
    return (await this.controller.activity_gate({ account })).result;
  }

  async epoch(account: string): Promise<bigint> {
    return BigInt((await this.controller.epoch({ account })).result);
  }

  async attempt(account: string, attemptId: bigint): Promise<Attempt | undefined> {
    return (await this.controller.attempt({ account, attempt_id: attemptId })).result ?? undefined;
  }

  async nextAttemptId(account: string): Promise<bigint> {
    return BigInt((await this.controller.next_attempt_id({ account })).result);
  }

  /** The exact statement evidence for an attempt must sign or prove. */
  async statement(
    account: string,
    attemptId: bigint,
    domain: EvidenceDomain,
  ): Promise<RecoveryStatement> {
    const tx = await this.controller.statement({ account, attempt_id: attemptId, domain });
    return statementFromChain(ok(tx.result));
  }

  /** The exact statement a reconfiguration or upgrade approval must sign or
   *  prove, fresh until `validUntil`. */
  async changeStatement(
    account: string,
    subject: ChangeSubject,
    validUntil: number,
  ): Promise<RecoveryStatement> {
    const tx = await this.controller.change_statement({
      account,
      subject: subjectToChain(subject),
      valid_until: validUntil,
    });
    return statementFromChain(ok(tx.result));
  }

  async nullifierSpent(account: string, nullifier: Uint8Array): Promise<boolean> {
    return (await this.controller.nullifier_spent({ account, nullifier: b(nullifier) })).result;
  }

  /** The canonical JSON of the account's applied document. */
  async appliedDoc(account: string): Promise<string | undefined> {
    const doc = (await this.account(account).applied_doc()).result;
    return doc ? Buffer.from(doc).toString('utf8') : undefined;
  }

  /** The id of the account's zero-signer recovery rule, from its rules. */
  async recoveryRuleId(account: string): Promise<number | undefined> {
    const client = this.account(account);
    const count = (await client.get_context_rules_count()).result;
    // Rule ids are never reused and `apply_doc` re-creates every rule, so
    // scan downward from the newest id that could exist.
    for (let id = count + 64; id >= 0; id--) {
      try {
        const rule = (await client.get_context_rule({ context_rule_id: id })).result;
        if (rule.name === 'recovery') return id;
      } catch {
        // A gap: the rule was replaced.
      }
    }
    return undefined;
  }

  // --- attempts ----------------------------------------------------------

  async beginLostKey(account: string, replacements: ReplacementSet): Promise<TxBuild> {
    const tx = await this.controller.begin_lost_key({
      account,
      replacements: replacementSetToChain(replacements),
    });
    return { operations: extractXdrOperations(tx, 'begin_lost_key'), description: 'Open a lost-key recovery attempt' };
  }

  async beginCompromise(account: string, replacements: ReplacementSet): Promise<TxBuild> {
    const tx = await this.controller.begin_compromise({
      account,
      replacements: replacementSetToChain(replacements),
    });
    return { operations: extractXdrOperations(tx, 'begin_compromise'), description: 'Open a compromise recovery attempt' };
  }

  /** A guardian's approval (`Initiate`) or cancellation (`Cancel`) of an
   *  attempt. The guardian's account signs it through its own rule scoped
   *  to the controller. */
  async submitGuardian(
    account: string,
    attemptId: bigint,
    domain: EvidenceDomain,
    guardian: string,
  ): Promise<TxBuild> {
    const tx = await this.controller.submit_guardian({ account, attempt_id: attemptId, domain, guardian });
    return {
      operations: extractXdrOperations(tx, 'submit_guardian'),
      description: domain === EvidenceDomain.Cancel ? 'Approve cancelling a recovery' : 'Approve a recovery',
    };
  }

  /** A ZK proof for an attempt's statement in `domain`. Permissionless. */
  async submitZk(
    account: string,
    attemptId: bigint,
    domain: EvidenceDomain,
    evidence: ZkEvidence,
  ): Promise<TxBuild> {
    const tx = await this.controller.submit_zk({
      account,
      attempt_id: attemptId,
      domain,
      evidence: evidenceToChain(evidence),
    });
    return { operations: extractXdrOperations(tx, 'submit_zk'), description: 'Submit a recovery proof' };
  }

  async approveChange(
    account: string,
    subject: ChangeSubject,
    validUntil: number,
    guardian: string,
  ): Promise<TxBuild> {
    const tx = await this.controller.approve_change({
      account,
      subject: subjectToChain(subject),
      valid_until: validUntil,
      guardian,
    });
    return { operations: extractXdrOperations(tx, 'approve_change'), description: 'Approve a protected change' };
  }

  async submitZkChange(
    account: string,
    subject: ChangeSubject,
    validUntil: number,
    evidence: ZkEvidence,
  ): Promise<TxBuild> {
    const tx = await this.controller.submit_zk_change({
      account,
      subject: subjectToChain(subject),
      valid_until: validUntil,
      evidence: evidenceToChain(evidence),
    });
    return { operations: extractXdrOperations(tx, 'submit_zk_change'), description: 'Prove a protected change' };
  }

  /** Store the enrolled baseline's canonical bytes so compromise recovery can
   *  open. Permissionless; refused unless the document compiles to exactly
   *  the enrolled baseline hash. */
  async publishBaseline(account: string, baselineJson: string): Promise<TxBuild> {
    const tx = await this.controller.publish_baseline({
      account,
      doc_json: Buffer.from(baselineJson, 'utf8'),
    });
    return { operations: extractXdrOperations(tx, 'publish_baseline'), description: 'Publish the recovery baseline' };
  }

  /** The canonical target an attempt installs, derived exactly as the
   *  controller derives it: the account's compiler over the applied document
   *  (lost-key) or the published baseline (compromise). */
  async deriveTarget(
    account: string,
    action: 'lost-key' | 'compromise',
    replacements: ReplacementSet,
  ): Promise<string> {
    const current = (await this.account(account).applied_doc()).result;
    if (!current) throw new Error('the account has no applied document');
    const source =
      action === 'lost-key' ? current : (await this.controller.baseline({ account })).result;
    if (!source) throw new Error('the account has no published baseline');
    const compiler = new CompilerClient({
      contractId: this.args.deployment.docCompiler,
      networkPassphrase: this.args.deployment.network,
      rpcUrl: this.args.rpcUrl,
    });
    const derived = await compiler.derive_target({
      source_json: Buffer.from(source),
      current_json: Buffer.from(current),
      action: action === 'lost-key' ? BindingAction.LostKey : BindingAction.Compromise,
      replacements: replacementSetToChain(replacements),
    });
    return Buffer.from(ok(derived.result).canonical).toString('utf8');
  }

  /** The completing `apply_doc` of `targetCanonical`, authorized by
   *  selecting the account's zero-signer recovery rule (no signature: the
   *  controller's `enforce` checks the exact target). Anyone may submit it
   *  once the timelock has passed; re-simulate after building so the
   *  footprint includes `__check_auth` and `enforce`. */
  async completion(
    account: string,
    targetCanonical: string,
    recoveryRuleId: number,
    lastLedger: number,
  ): Promise<TxBuild> {
    const tx = await this.account(account).apply_doc({
      doc_json: Buffer.from(targetCanonical, 'utf8'),
      approval_valid_until: 0,
    });
    const operations = extractXdrOperations(tx, 'completion').map((op) =>
      selectRecoveryRule(op, account, recoveryRuleId, lastLedger),
    );
    return { operations, description: 'Complete the recovery' };
  }

  /** A `Loss` owner's veto: the account's `cancel_recovery`, signed by the
   *  owner like any account change. Refused under `Protected`. */
  async ownerCancel(account: string, attemptId: bigint): Promise<TxBuild> {
    const tx = await this.account(account).cancel_recovery({ attempt_id: attemptId });
    return { operations: extractXdrOperations(tx, 'cancel_recovery'), description: 'Cancel the recovery attempt' };
  }
}
