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
 *
 * Every call goes to the account's own recovery stack (`RecoveryWiring`),
 * read from the account, never to the deployment's. Each Perch redeploy puts
 * the controller, pool, and adapter at new addresses, and an account keeps
 * the ones it enrolled with until its owner moves it (`movedRecovery`). The
 * deployment's controller is only what a new enrollment adopts.
 */

import { Buffer } from 'buffer';
import { Client as AccountClient } from '@nidohq/perch-account';
import { Client as CompilerClient } from '@nidohq/perch-doc-compiler';
import { Client as PoolClient } from '@nidohq/perch-zk-pool';
import {
  Client as RecoveryClient,
  EvidenceDomain,
  RecoveryAction as BindingAction,
} from '@nidohq/perch-recovery';
import type {
  ActivityGate,
  Attempt,
  CompiledRecoveryMode,
  ReplacementSet as BindingReplacementSet,
  RecoveryStatement as BindingStatement,
  StatementSubject as BindingSubject,
  ZkEvidence as BindingEvidence,
} from '@nidohq/perch-recovery';
import { Address, nativeToScVal, Operation, xdr } from '@stellar/stellar-sdk';
import {
  buildAuthPayload,
  selectRecoveryRule,
  type RuleSelection,
  type Snapshot,
  type SnapshotOptions,
} from '@stellar-registry/perch';
import { extractXdrOperations } from '../assembledTx.js';
import { DEFAULT_EXPIRATION_OFFSET } from '../auth.js';
import type { TxBuild } from '../policyBlocks/types.js';
import { readAccountSnapshot } from './account.js';
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
  /** The network, and the stack a new enrollment adopts. */
  deployment: PerchDeployment;
  rpcUrl: string;
}

/** Where an account's recovery runs, read from the account and its
 *  controller. (The compiler the account pins is read by its snapshot
 *  reader, `openAccountReader`.) */
export interface RecoveryWiring {
  /** The controller the account adopted (`configuration()`'s
   *  `recovery_controller`), or, with recovery off, the deployment's: the
   *  one a new enrollment adopts. */
  controller: string;
  /** Whether the account has adopted `controller`. */
  adopted: boolean;
}

/** An enrolled ZK factor's contracts; `circuitId` is lowercase hex. */
export interface EnrolledZk {
  pool: string;
  adapter: string;
  circuitId: string;
}

function zkOf(mode: CompiledRecoveryMode): EnrolledZk | undefined {
  const z = mode.tag === 'ZkOnly' ? mode.values[0] : mode.tag === 'Combined' ? mode.values[1] : undefined;
  return z && { pool: z.pool, adapter: z.adapter, circuitId: Buffer.from(z.circuit_id).toString('hex') };
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

/**
 * The completing `apply_doc(targetCanonical, 0, Some(revision))` as one
 * operation whose auth entry is already complete: address credentials for
 * `account`, a fresh nonce, and an `AuthPayload` with no signers that
 * selects the zero-signer recovery rule (perch-js `buildAuthPayload` over
 * `selection`, from `selectRecoveryRule`).
 *
 * `selection.revision` goes in as `expected_revision`: it is the revision
 * of the snapshot whose document the target was derived from, so the
 * completion executes only at that configuration (`StaleRevision`
 * otherwise).
 *
 * It can't come from recording-mode simulation, the usual way a client
 * learns its auth entries: recording never runs `__check_auth`, so the
 * controller's `enforce` never marks the completion, `rcv_sync` sees a policy
 * change during the authorized window, and simulation fails with
 * `AttemptAuthorized` (Perch `docs/deploy/README.md`, "Simulating a recovery
 * completion"). Simulate this operation with `authMode: 'enforce'`.
 */
export function completionOperation(
  account: string,
  targetCanonical: string,
  selection: RuleSelection,
  lastLedger: number,
  nonce: bigint = randomNonce(),
): xdr.Operation {
  if (selection.account !== account) {
    throw new Error(`the selection is for ${selection.account}, not ${account}`);
  }
  const call = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(account).toScAddress(),
    functionName: 'apply_doc',
    args: [
      nativeToScVal(Buffer.from(targetCanonical, 'utf8'), { type: 'bytes' }),
      nativeToScVal(0, { type: 'u32' }),
      nativeToScVal(selection.revision, { type: 'u64' }),
    ],
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(account).toScAddress(),
        nonce: xdr.Int64.fromString(nonce.toString()),
        signatureExpirationLedger: lastLedger + DEFAULT_EXPIRATION_OFFSET,
        signature: xdr.ScVal.fromXDR(Buffer.from(buildAuthPayload(selection, []))),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call),
      subInvocations: [],
    }),
  });
  return Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(call),
    auth: [entry],
  });
}

/** A random non-negative `i64` nonce. */
function randomNonce(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(8));
  b[0]! &= 0x7f;
  return b.reduce((n, x) => (n << 8n) | BigInt(x), 0n);
}

/** Unwrap a simulated read whose contract result is a `Result`. */
function ok<T>(r: { unwrap(): T } | T): T {
  return typeof (r as { unwrap?: unknown }).unwrap === 'function'
    ? (r as { unwrap(): T }).unwrap()
    : (r as T);
}

/** The wallet's recovery client. It talks to each account's own stack
 *  (`wiring`), read once per account for the client's lifetime, so make a
 *  new client after an `apply_doc` that may have moved it. */
export class PerchRecovery {
  private readonly args: ChainArgs;
  private readonly wirings = new Map<string, Promise<RecoveryWiring>>();

  constructor(args: ChainArgs) {
    this.args = args;
  }

  private account(account: string): AccountClient {
    return new AccountClient({
      contractId: account,
      networkPassphrase: this.args.deployment.network,
      rpcUrl: this.args.rpcUrl,
    });
  }

  private recoveryAt(controller: string): RecoveryClient {
    return new RecoveryClient({
      contractId: controller,
      networkPassphrase: this.args.deployment.network,
      rpcUrl: this.args.rpcUrl,
    });
  }

  /** Where `account`'s recovery runs: its adopted controller, from one
   *  `configuration()` read. A failed read is not kept. */
  wiring(account: string): Promise<RecoveryWiring> {
    let wiring = this.wirings.get(account);
    if (!wiring) {
      wiring = this.readWiring(account);
      wiring.catch(() => this.wirings.delete(account));
      this.wirings.set(account, wiring);
    }
    return wiring;
  }

  private async readWiring(account: string): Promise<RecoveryWiring> {
    const adopted = (await this.account(account).configuration()).result.recovery_controller ?? undefined;
    return adopted === undefined
      ? { controller: this.args.deployment.recoveryController, adopted: false }
      : { controller: adopted, adopted: true };
  }

  /** The contracts of `account`'s enrolled ZK factor, from its controller's
   *  `config`, or undefined without one. Read only when proving needs it. */
  async enrolledZk(account: string): Promise<EnrolledZk | undefined> {
    const enrolled = (await (await this.controller(account)).config({ account })).result ?? undefined;
    return enrolled && zkOf(enrolled.mode);
  }

  private async controller(account: string): Promise<RecoveryClient> {
    return this.recoveryAt((await this.wiring(account)).controller);
  }

  // --- reads -------------------------------------------------------------

  async activityGate(account: string): Promise<ActivityGate> {
    return (await (await this.controller(account)).activity_gate({ account })).result;
  }

  async epoch(account: string): Promise<bigint> {
    return BigInt((await (await this.controller(account)).epoch({ account })).result);
  }

  async attempt(account: string, attemptId: bigint): Promise<Attempt | undefined> {
    const c = await this.controller(account);
    return (await c.attempt({ account, attempt_id: attemptId })).result ?? undefined;
  }

  /** Whether an attempt is live: not expired, invalidated, completed, or
   *  cancelled. */
  async attemptLive(account: string, attemptId: bigint): Promise<boolean> {
    return (await (await this.controller(account)).attempt_live({ account, attempt_id: attemptId })).result;
  }

  async nextAttemptId(account: string): Promise<bigint> {
    return BigInt((await (await this.controller(account)).next_attempt_id({ account })).result);
  }

  /** The exact statement evidence for an attempt must sign or prove. */
  async statement(
    account: string,
    attemptId: bigint,
    domain: EvidenceDomain,
  ): Promise<RecoveryStatement> {
    const tx = await (await this.controller(account)).statement({ account, attempt_id: attemptId, domain });
    return statementFromChain(ok(tx.result));
  }

  /** The exact statement a reconfiguration or upgrade approval must sign or
   *  prove, fresh until `validUntil`. */
  async changeStatement(
    account: string,
    subject: ChangeSubject,
    validUntil: number,
  ): Promise<RecoveryStatement> {
    const tx = await (await this.controller(account)).change_statement({
      account,
      subject: subjectToChain(subject),
      valid_until: validUntil,
    });
    return statementFromChain(ok(tx.result));
  }

  /** Evidence recorded so far for a change statement digest. */
  async changeEvidence(account: string, digest: Uint8Array): Promise<{ guardians: string[]; zk: boolean }> {
    const r = (await (await this.controller(account)).change_evidence({ account, digest: b(digest) })).result;
    return { guardians: r.guardians, zk: r.zk };
  }

  /** Whether the account's controller config is enrolled at all. */
  async enrolled(account: string): Promise<boolean> {
    return (await (await this.controller(account)).config({ account })).result != null;
  }

  async nullifierSpent(account: string, nullifier: Uint8Array): Promise<boolean> {
    return (await (await this.controller(account)).nullifier_spent({ account, nullifier: b(nullifier) })).result;
  }

  /** The baseline's canonical JSON as published at the account's
   *  controller, or undefined before `publish_baseline`. */
  async baseline(account: string): Promise<string | undefined> {
    const bytes = (await (await this.controller(account)).baseline({ account })).result;
    return bytes ? Buffer.from(bytes).toString('utf8') : undefined;
  }

  /** One consistent read of `account` at one configuration revision
   *  (perch-js `readSnapshot`; see `readAccountSnapshot`), its limits from
   *  the compiler the account pins. */
  snapshot(account: string, options?: SnapshotOptions): Promise<Snapshot> {
    return readAccountSnapshot(
      { account, rpcUrl: this.args.rpcUrl, networkPassphrase: this.args.deployment.network },
      options,
    );
  }

  /** The canonical JSON of the account's applied document and the revision
   *  it belongs to, from one snapshot. */
  async document(account: string): Promise<{ revision: bigint; canonical: string | undefined }> {
    const snap = await this.snapshot(account, { document: true });
    return {
      revision: snap.configuration.revision,
      canonical: snap.document ? Buffer.from(snap.document).toString('utf8') : undefined,
    };
  }

  /** The canonical JSON of the account's applied document. */
  async appliedDoc(account: string): Promise<string | undefined> {
    return (await this.document(account)).canonical;
  }

  /** The account's zero-signer recovery rule at its current revision
   *  (perch-js `selectRecoveryRule`): the account's own record of the rule,
   *  never an id scan, so it holds however many rules past applies
   *  replaced (nidohq/nido#240). */
  async recoverySelection(account: string): Promise<RuleSelection> {
    return selectRecoveryRule(await this.snapshot(account));
  }

  // --- the ZK pool -------------------------------------------------------

  /** The pool `account`'s enrolled ZK factor names. */
  private async pool(account: string): Promise<PoolClient> {
    const zk = await this.enrolledZk(account);
    if (!zk) throw new Error('the account has no enrolled ZK factor');
    return new PoolClient({
      contractId: zk.pool,
      networkPassphrase: this.args.deployment.network,
      rpcUrl: this.args.rpcUrl,
    });
  }

  /** Where `account`'s credential `enrollmentId` sits in its pool. */
  async leafPosition(
    account: string,
    enrollmentId: Uint8Array,
  ): Promise<{ treeId: number; index: number } | undefined> {
    const pool = await this.pool(account);
    const at = (await pool.enrollment({ account, enrollment_id: b(enrollmentId) })).result;
    return at ? { treeId: at.tree_id, index: Number(at.index) } : undefined;
  }

  /** Every leaf of `treeId` in `account`'s pool, read from the pool's own
   *  storage (no indexer needed; the proof fails on-chain if any leaf here
   *  were wrong). */
  async treeLeaves(account: string, treeId: number, pageSize = 64): Promise<Uint8Array[]> {
    const pool = await this.pool(account);
    const size = Number(ok((await pool.tree({ tree_id: treeId })).result).size);
    const leaves: Uint8Array[] = [];
    while (leaves.length < size) {
      const page = ok(
        (await pool.leaves({ tree_id: treeId, start: BigInt(leaves.length), count: pageSize })).result,
      );
      if (page.length === 0) break;
      leaves.push(...page.map(u8));
    }
    return leaves;
  }

  // --- attempts ----------------------------------------------------------

  async beginLostKey(account: string, replacements: ReplacementSet): Promise<TxBuild> {
    const tx = await (await this.controller(account)).begin_lost_key({
      account,
      replacements: replacementSetToChain(replacements),
    });
    return { operations: extractXdrOperations(tx, 'begin_lost_key'), description: 'Open a lost-key recovery attempt' };
  }

  async beginCompromise(account: string, replacements: ReplacementSet): Promise<TxBuild> {
    const tx = await (await this.controller(account)).begin_compromise({
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
    const c = await this.controller(account);
    const tx = await c.submit_guardian({ account, attempt_id: attemptId, domain, guardian });
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
    const tx = await (await this.controller(account)).submit_zk({
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
    const tx = await (await this.controller(account)).approve_change({
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
    const tx = await (await this.controller(account)).submit_zk_change({
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
    const tx = await (await this.controller(account)).publish_baseline({
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
    return (await this.prepareCompletion(account, action, replacements)).target;
  }

  /** What a completion needs, from one snapshot: the target derived from
   *  the document applied at that revision, and the recovery rule selected
   *  at the same revision, which `completion` sends as `expected_revision`. */
  async prepareCompletion(
    account: string,
    action: 'lost-key' | 'compromise',
    replacements: ReplacementSet,
  ): Promise<{ target: string; selection: RuleSelection }> {
    const snap = await this.snapshot(account, { document: true });
    const current = snap.document;
    if (!current) throw new Error('the account has no applied document');
    const source =
      action === 'lost-key' ? current : (await (await this.controller(account)).baseline({ account })).result;
    if (!source) throw new Error('the account has no published baseline');
    // The compiler the account pins, which its own apply path compiles with.
    const compiler = new CompilerClient({
      contractId: snap.configuration.infra.docCompiler,
      networkPassphrase: this.args.deployment.network,
      rpcUrl: this.args.rpcUrl,
    });
    const derived = await compiler.derive_target({
      source_json: Buffer.from(source),
      current_json: Buffer.from(current),
      action: action === 'lost-key' ? BindingAction.LostKey : BindingAction.Compromise,
      replacements: replacementSetToChain(replacements),
    });
    return {
      target: Buffer.from(ok(derived.result).canonical).toString('utf8'),
      selection: selectRecoveryRule(snap),
    };
  }

  /** The completing `apply_doc` of `targetCanonical`, authorized by
   *  selecting the account's zero-signer recovery rule (no signature: the
   *  controller's `enforce` checks the exact target). Anyone may submit it
   *  once the timelock has passed. See `completionOperation`: it must be
   *  simulated in enforcing mode. */
  async completion(
    account: string,
    targetCanonical: string,
    selection: RuleSelection,
    lastLedger: number,
  ): Promise<TxBuild> {
    return {
      operations: [completionOperation(account, targetCanonical, selection, lastLedger)],
      description: 'Complete the recovery',
      authMode: 'enforce',
    };
  }

  /** A `Loss` owner's veto: the account's `cancel_recovery`, signed by the
   *  owner like any account change. Refused under `Protected`. */
  async ownerCancel(account: string, attemptId: bigint): Promise<TxBuild> {
    const tx = await this.account(account).cancel_recovery({ attempt_id: attemptId });
    return { operations: extractXdrOperations(tx, 'cancel_recovery'), description: 'Cancel the recovery attempt' };
  }
}
