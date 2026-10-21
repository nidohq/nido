/**
 * Recovery configuration as a document change.
 *
 * A Perch account has one write path, `apply_doc`. Enrolling recovery,
 * reconfiguring it (guardians, threshold, mode, timing), and disabling it
 * are all a new document whose `recovery` member changed; the account's
 * controller classifies the change in the same invocation (`rcv_sync`) and,
 * for a new ZK credential, the account inserts its leaf into the pool before
 * returning. Onboarding is the same thing: the factory mints the account
 * with only its passkey admin rule, and the wallet's first `apply_doc`
 * carries the full document, recovery included.
 *
 * Atomicity: those steps are one invocation, and the pool insertion is not
 * a `try_` call, so a failure anywhere (compile, controller, rules, pool)
 * reverts all of it. The account is then exactly as it was, and retrying
 * with a fresh enrollment id is safe. Between the factory's `create_account`
 * and the first `apply_doc` the account has only its admin rule and no
 * recovery; nothing else can change it in that window.
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { configHash as perchConfigHash, parsePolicyDoc } from '@stellar-registry/perch';
import type { PolicyDoc, RecoveryModeSpec, RecoverySpec, ZkFactorSpec } from '@stellar-registry/perch';
import type { PerchDeployment } from './deployment.js';
import type { Bytes32 } from './statement.js';

export type RecoveryProfile = 'loss' | 'protected';
export type RecoveryMode = 'guardian-only' | 'zk-only' | 'combined';

/** Nido's defaults, in ledgers (about five seconds each). */
export const RECOVERY_DEFAULTS = {
  /** Seven days between authorization and completion: the window an owner
   *  (Loss) or the condition (Protected) has to cancel. */
  delayLedgers: 120_960,
  /** Fourteen days to collect evidence, and then to complete. */
  expiryLedgers: 241_920,
  maxCancels: 3,
} as const;

/** A ZK credential as a document names it: never the secret. */
export interface ZkEnrollmentSpec {
  enrollmentId: Bytes32;
  commitment: Bytes32;
}

export interface RecoveryChoice {
  profile: RecoveryProfile;
  mode: RecoveryMode;
  /** Guardian addresses (G… or C…), for guardian-only and combined. */
  guardians?: string[];
  quorum?: number;
  /** The credential to enroll, for zk-only and combined. */
  zk?: ZkEnrollmentSpec;
  /** Signer ids a recovery may replace: the document's admin signers. No
   *  default, since the founder's id differs between documents (`admin`
   *  now, `owner` in early ones) and an undeclared id fails to compile. */
  replaceable: string[];
  /** Hash of the enrolled baseline (compromise recovery); omit to enroll
   *  lost-key recovery only. Perch states that `Protected` without a
   *  baseline is not theft-resistant (spec §2, nidohq/nido#220). */
  baselineDocHash?: string;
  delayLedgers?: number;
  expiryLedgers?: number;
  maxCancels?: number;
}

/** The `recovery` member for `choice` against `deployment`. Throws when the
 *  mode's required parts are missing, before the compiler would. */
export function recoverySpec(deployment: PerchDeployment, choice: RecoveryChoice): RecoverySpec {
  const needsGuardians = choice.mode !== 'zk-only';
  const needsZk = choice.mode !== 'guardian-only';
  if (needsGuardians && !(choice.guardians?.length && choice.quorum)) {
    throw new Error(`${choice.mode} recovery needs guardians and a quorum`);
  }
  if (needsGuardians && choice.quorum! > choice.guardians!.length) {
    throw new Error(
      `${choice.mode} recovery quorum ${choice.quorum} exceeds its ${choice.guardians!.length} guardians`,
    );
  }
  if (needsZk && choice.zk === undefined) {
    throw new Error(`${choice.mode} recovery needs a ZK enrollment`);
  }
  if (!choice.replaceable?.length) {
    throw new Error('recovery needs at least one replaceable signer');
  }
  const zk = () => ({
    adapter: deployment.zkAdapter,
    circuitId: deployment.circuitId,
    pool: deployment.zkPool,
    enrollmentId: bytesToHex(choice.zk!.enrollmentId),
    commitment: bytesToHex(choice.zk!.commitment),
  });
  const guardians = { guardians: choice.guardians ?? [], quorum: choice.quorum ?? 0 };
  return {
    profile: choice.profile,
    mode:
      choice.mode === 'guardian-only'
        ? { kind: 'guardian-only', ...guardians }
        : choice.mode === 'zk-only'
          ? { kind: 'zk-only', ...zk() }
          : { kind: 'combined', ...guardians, ...zk() },
    controller: deployment.recoveryController,
    ...(choice.baselineDocHash !== undefined
      ? { baseline: { docHash: choice.baselineDocHash } }
      : {}),
    replaceable: choice.replaceable,
    delayLedgers: choice.delayLedgers ?? RECOVERY_DEFAULTS.delayLedgers,
    expiryLedgers: choice.expiryLedgers ?? RECOVERY_DEFAULTS.expiryLedgers,
    maxCancels: choice.maxCancels ?? RECOVERY_DEFAULTS.maxCancels,
  };
}

function zkToWire(zk: ZkFactorSpec): Record<string, unknown> {
  return {
    adapter: zk.adapter,
    'circuit-id': zk.circuitId,
    pool: zk.pool,
    'enrollment-id': zk.enrollmentId,
    commitment: zk.commitment,
  };
}

/** perch-ir's wire shape for a recovery member. Mirrors perch-js's
 *  `recoverySpecToWire`, which its entry point does not export at the pinned
 *  revision. */
export function recoveryToWire(spec: RecoverySpec): Record<string, unknown> {
  const m = spec.mode;
  const mode =
    m.kind === 'guardian-only'
      ? { type: 'guardian-only', guardians: m.guardians, quorum: m.quorum }
      : m.kind === 'zk-only'
        ? { type: 'zk-only', ...zkToWire(m) }
        : { type: 'combined', guardians: m.guardians, quorum: m.quorum, ...zkToWire(m) };
  return {
    profile: spec.profile,
    mode,
    controller: spec.controller,
    ...(spec.baseline !== undefined ? { baseline: { 'doc-hash': spec.baseline.docHash } } : {}),
    replaceable: spec.replaceable,
    'delay-ledgers': spec.delayLedgers,
    'expiry-ledgers': spec.expiryLedgers,
    'max-cancels': spec.maxCancels,
  };
}

type WireRecovery = NonNullable<PolicyDoc['recovery']>;

/** A document's recovery member as a `RecoverySpec`: the inverse of
 *  `recoveryToWire`. */
export function recoveryFromWire(r: WireRecovery): RecoverySpec {
  const m = r.mode;
  const zk = (z: Extract<WireRecovery['mode'], { pool: string }>): ZkFactorSpec => ({
    adapter: z.adapter,
    circuitId: z['circuit-id'],
    pool: z.pool,
    enrollmentId: z['enrollment-id'],
    commitment: z.commitment,
  });
  const mode: RecoveryModeSpec =
    m.type === 'guardian-only'
      ? { kind: 'guardian-only', guardians: m.guardians, quorum: m.quorum }
      : m.type === 'zk-only'
        ? { kind: 'zk-only', ...zk(m) }
        : { kind: 'combined', guardians: m.guardians, quorum: m.quorum, ...zk(m) };
  return {
    profile: r.profile,
    mode,
    controller: r.controller,
    ...(r.baseline !== undefined ? { baseline: { docHash: r.baseline['doc-hash'] } } : {}),
    replaceable: r.replaceable,
    delayLedgers: r['delay-ledgers'],
    expiryLedgers: r['expiry-ledgers'],
    maxCancels: r['max-cancels'],
  };
}

/** What of `spec` is not on `deployment`'s recovery stack: its controller,
 *  and its ZK factor's pool, adapter, or circuit. A Perch redeploy moves
 *  every one of them to a new address, and an account keeps what it
 *  enrolled with until its owner moves it (`movedRecovery`). */
export function recoveryStackDrift(
  deployment: PerchDeployment,
  spec: RecoverySpec,
): { controller: boolean; zk: boolean } {
  const m = spec.mode;
  return {
    controller: spec.controller !== deployment.recoveryController,
    zk:
      m.kind !== 'guardian-only' &&
      (m.pool !== deployment.zkPool || m.adapter !== deployment.zkAdapter || m.circuitId !== deployment.circuitId),
  };
}

/**
 * `spec` moved onto `deployment`'s stack: the deployment's controller, and
 * with `zk` a new credential on the deployment's pool, adapter, and circuit.
 * Every setting the owner chose (profile, guardians, quorum, baseline,
 * replaceable signers, timing) stays as it is.
 *
 * Applying it is a reconfiguration evaluated by the controller the account
 * leaves (Perch spec §10, "Remove or switch away"): under `Protected` the
 * evidence is recorded there first. A ZK factor that moves to another pool,
 * adapter, or circuit needs `zk`, because the account refuses a changed
 * factor that keeps its enrollment id (`ZkFactorChangedInPlace`, §3.4).
 * Throws when it would.
 */
export function movedRecovery(
  deployment: PerchDeployment,
  spec: RecoverySpec,
  zk?: ZkEnrollmentSpec,
): RecoverySpec {
  const m = spec.mode;
  if (m.kind === 'guardian-only') return { ...spec, controller: deployment.recoveryController };
  if (zk === undefined && recoveryStackDrift(deployment, spec).zk) {
    throw new Error('the recovery kit is enrolled in an earlier pool; moving it needs a new recovery kit');
  }
  const factor: ZkFactorSpec =
    zk === undefined
      ? { adapter: m.adapter, circuitId: m.circuitId, pool: m.pool, enrollmentId: m.enrollmentId, commitment: m.commitment }
      : {
          adapter: deployment.zkAdapter,
          circuitId: deployment.circuitId,
          pool: deployment.zkPool,
          enrollmentId: bytesToHex(zk.enrollmentId),
          commitment: bytesToHex(zk.commitment),
        };
  return { ...spec, mode: { ...m, ...factor }, controller: deployment.recoveryController };
}

/** `doc` with its recovery member set to `spec` (or removed), validated.
 *  Throws when `spec` may replace a signer `doc` does not declare, which the
 *  compiler would refuse. */
export function withRecovery(doc: PolicyDoc, spec: RecoverySpec | undefined): PolicyDoc {
  const { recovery: _previous, ...rest } = doc;
  const declared = new Set(doc.signers.map((s) => s.id));
  const undeclared = spec?.replaceable.filter((id) => !declared.has(id)) ?? [];
  if (undeclared.length > 0) {
    throw new Error(`recovery may replace undeclared signer(s): ${undeclared.join(', ')}`);
  }
  return parsePolicyDoc(spec === undefined ? rest : { ...rest, recovery: recoveryToWire(spec) });
}

/** The recovery `config_hash` a document compiles to (perch-js
 *  `configHash`), as bytes, or undefined without a recovery member. What a
 *  `Protected` reconfiguration's evidence approves. */
export function configHash(doc: PolicyDoc): Bytes32 | undefined {
  return doc.recovery === undefined ? undefined : hexToBytes(perchConfigHash(doc));
}

/** How `next` changes `current`'s recovery configuration, for deciding what
 *  evidence a `Protected` account needs before applying it. */
export type RecoveryChange =
  | { kind: 'none' }
  | { kind: 'set'; configHash: Bytes32 }
  | { kind: 'remove' };

export function recoveryChange(current: PolicyDoc, next: PolicyDoc): RecoveryChange {
  const before = configHash(current);
  const after = configHash(next);
  if (after === undefined) return before === undefined ? { kind: 'none' } : { kind: 'remove' };
  if (before !== undefined && bytesToHex(before) === bytesToHex(after)) return { kind: 'none' };
  return { kind: 'set', configHash: after };
}
