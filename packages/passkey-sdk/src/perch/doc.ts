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

import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalJson, parsePolicyDoc } from '@stellar-registry/perch';
import type { PolicyDoc, RecoverySpec, ZkFactorSpec } from '@stellar-registry/perch';
import type { PerchDeployment } from './deployment.js';
import { configHashOfCanonical, type Bytes32 } from './statement.js';

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
  /** Signer ids a recovery may replace. Defaults to `['owner']`. */
  replaceable?: string[];
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
  if (needsZk && choice.zk === undefined) {
    throw new Error(`${choice.mode} recovery needs a ZK enrollment`);
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
    replaceable: choice.replaceable ?? ['owner'],
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

/** `doc` with its recovery member set to `spec` (or removed), validated. */
export function withRecovery(doc: PolicyDoc, spec: RecoverySpec | undefined): PolicyDoc {
  const { recovery: _previous, ...rest } = doc;
  return parsePolicyDoc(spec === undefined ? rest : { ...rest, recovery: recoveryToWire(spec) });
}

/** The recovery `config_hash` a document compiles to:
 *  `sha256("perch/recovery/config" || canonical JSON of its recovery member)`.
 *  What a `Protected` reconfiguration's evidence approves. */
export function configHash(doc: PolicyDoc): Bytes32 | undefined {
  const recovery = doc.recovery;
  return recovery === undefined ? undefined : configHashOfCanonical(canonicalJson(recovery));
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
