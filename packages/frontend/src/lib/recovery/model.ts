/**
 * The wallet's recovery model on the Perch stack: what an applied document
 * says about recovery, what a change to it needs, and the requests a
 * recovering account hands its guardians. Pure: every chain read lives in
 * `chain.ts`, so this module is what the unit tests pin.
 *
 * Perch's spec (vendor/perch/docs/recovery/spec.md) is the authority for the
 * rules restated here:
 *
 * - `loss`: the owner alone reconfigures and may always veto a recovery.
 *   Ordinary activity continues while an attempt is authorized.
 * - `protected`: the owner plus the enrolled condition reconfigures, upgrades,
 *   and cancels; an authorized attempt freezes everything but its completion.
 * - The condition: a guardian quorum, a ZK proof, or both (`combined`).
 */

import type { PolicyDoc } from '@stellar-registry/perch';
import { perch } from '@nidohq/passkey-sdk';

export type RecoveryProfile = perch.RecoveryProfile;
export type RecoveryMode = perch.RecoveryMode;

/** A document's `recovery` member, as the wallet reads it. */
export interface RecoverySummary {
  profile: RecoveryProfile;
  mode: RecoveryMode;
  controller: string;
  guardians: string[];
  quorum: number;
  zk: { enrollmentId: string; pool: string; adapter: string } | undefined;
  baselineDocHash: string | undefined;
  replaceable: string[];
  delayLedgers: number;
  expiryLedgers: number;
  maxCancels: number;
}

type WireRecovery = NonNullable<PolicyDoc['recovery']>;

/** The recovery member of `doc`, or `undefined` when recovery is off. */
export function summarizeRecovery(doc: PolicyDoc | undefined): RecoverySummary | undefined {
  const r = doc?.recovery as WireRecovery | undefined;
  if (r === undefined) return undefined;
  const mode = r.mode as Record<string, unknown> & { type: RecoveryMode };
  const hasGuardians = mode.type !== 'zk-only';
  const hasZk = mode.type !== 'guardian-only';
  return {
    profile: r.profile as RecoveryProfile,
    mode: mode.type,
    controller: r.controller,
    guardians: hasGuardians ? (mode.guardians as string[]) : [],
    quorum: hasGuardians ? (mode.quorum as number) : 0,
    zk: hasZk
      ? {
          enrollmentId: mode['enrollment-id'] as string,
          pool: mode.pool as string,
          adapter: mode.adapter as string,
        }
      : undefined,
    baselineDocHash: (r.baseline as { 'doc-hash': string } | undefined)?.['doc-hash'],
    replaceable: r.replaceable,
    delayLedgers: r['delay-ledgers'],
    expiryLedgers: r['expiry-ledgers'],
    maxCancels: r['max-cancels'],
  };
}

/** About five seconds per ledger: for display only. Every on-chain bound is
 *  in ledgers. */
export const SECONDS_PER_LEDGER = 5;

export function ledgersToText(ledgers: number): string {
  const seconds = ledgers * SECONDS_PER_LEDGER;
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)} days`;
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)} hours`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} minutes`;
  return `${seconds} seconds`;
}

export const PROFILE_TEXT: Record<RecoveryProfile, { title: string; body: string }> = {
  loss: {
    title: 'In case I lose my passkey',
    body:
      'Your passkey alone can change recovery, and it can always stop a recovery you did not ask for. ' +
      'You keep using your Nido while a recovery waits out its delay.',
  },
  protected: {
    title: 'In case someone steals my passkey',
    body:
      'Changing recovery, upgrading, or stopping a recovery also needs your helpers. ' +
      'Once a recovery is approved, your Nido freezes until it completes or your helpers cancel it.',
  },
};

export const MODE_TEXT: Record<RecoveryMode, string> = {
  'guardian-only': 'Trusted friends approve',
  'zk-only': 'Your recovery kit proves it is you',
  combined: 'Trusted friends and your recovery kit, together',
};

/** The evidence the condition needs: guardian approvals and/or one proof. */
export interface Condition {
  guardians: number;
  zk: boolean;
}

export function condition(summary: RecoverySummary): Condition {
  return {
    guardians: summary.mode === 'zk-only' ? 0 : summary.quorum,
    zk: summary.mode !== 'guardian-only',
  };
}

/** What applying `next` over `current` needs beyond the owner's passkey.
 *  `undefined`: nothing (no recovery change, or the current profile is
 *  `loss`). Otherwise the change and the currently enrolled condition. */
export function changeNeeds(
  current: PolicyDoc | undefined,
  next: PolicyDoc,
): { change: perch.ChangeSubject; condition: Condition } | undefined {
  const summary = summarizeRecovery(current);
  if (summary === undefined || summary.profile === 'loss' || current === undefined) return undefined;
  const change = perch.recoveryChange(current, next);
  if (change.kind === 'none') return undefined;
  return {
    change:
      change.kind === 'set'
        ? { kind: 'reconfigure-set', configHash: change.configHash }
        : { kind: 'reconfigure-remove' },
    condition: condition(summary),
  };
}

/** The signer ids a recovery may replace: every signer the admin rule names
 *  (the passkeys that run the account). */
export function adminSignerIds(doc: PolicyDoc): string[] {
  const admin = doc.rules.find((r) => r.scope.type === 'self-admin' && r.principals.type === 'all');
  return admin && admin.principals.type === 'all' ? [...admin.principals.signers] : [];
}

/** What a guardian is asked to approve. Travels in the URL fragment of a
 *  link to the guardian's own Nido (fragments never reach a server). */
export type GuardianRequest =
  | {
      kind: 'attempt';
      account: string;
      attemptId: string;
      domain: 'initiate' | 'cancel';
      /** The attempt's declared replacements, so the guardian can see which
       *  passkey would take over (and check it with the friend out of band).
       *  The page checks them against the attempt's `replacements_hash`. */
      replacements?: WireReplacements;
    }
  | {
      kind: 'change';
      account: string;
      change:
        | { kind: 'reconfigure-set'; configHash: string }
        | { kind: 'reconfigure-remove' }
        | { kind: 'upgrade'; requestId: string; wasmHash: string };
      validUntil: number;
      /** For a `reconfigure-set`: the proposed recovery member, checked
       *  against `configHash` before it is shown. */
      recovery?: unknown;
    };

/** A replacement set in a request link: hex for bytes. */
export interface WireReplacements {
  signers: { signerId: string; verifier: string; key: string }[];
  zk?: { id: string; commitment: string };
}

export function replacementsToWire(set: perch.ReplacementSet): WireReplacements {
  return {
    signers: set.signers.map((r) => {
      if (r.credential.kind !== 'external') throw new Error('Nido replaces passkeys only');
      return { signerId: r.signerId, verifier: r.credential.verifier, key: hex(r.credential.key) };
    }),
    ...(set.zkEnrollment
      ? { zk: { id: hex(set.zkEnrollment.id), commitment: hex(set.zkEnrollment.commitment) } }
      : {}),
  };
}

/** The verifiers in `w` other than `verifier`, the deployment's WebAuthn
 *  verifier. A guardian compares the new passkey's key ending, which proves
 *  nothing when the credential names a verifier that accepts any signature. */
export function foreignVerifiers(w: WireReplacements, verifier: string): string[] {
  return [...new Set(w.signers.map((s) => s.verifier).filter((v) => v !== verifier))];
}

/** Why a guardian must not approve an attempt link, or `undefined` when the
 *  link carries the replacement set the attempt bound on chain (`boundHash`)
 *  and every new credential is checked by `verifier`. */
export function attemptLinkProblem(
  replacements: WireReplacements | undefined,
  boundHash: Uint8Array,
  verifier: string,
): string | undefined {
  if (!replacements) {
    return 'The link does not say which new passkey would take over. Ask your friend for a fresh link.';
  }
  const declared = perch.replacementSetHash(perch.sortReplacements(replacementsFromWire(replacements)));
  if (hex(declared) !== hex(boundHash)) {
    return 'This link’s replacement does not match the attempt on chain.';
  }
  if (foreignVerifiers(replacements, verifier).length) {
    return 'This link’s new passkey is checked by an unknown contract, not Nido’s passkey verifier.';
  }
  return undefined;
}

export function replacementsFromWire(w: WireReplacements): perch.ReplacementSet {
  const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
  return {
    signers: w.signers.map((s) => ({
      signerId: s.signerId,
      credential: { kind: 'external' as const, verifier: s.verifier, key: bytes(s.key) },
    })),
    ...(w.zk ? { zkEnrollment: { id: bytes(w.zk.id), commitment: bytes(w.zk.commitment) } } : {}),
  };
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

export function encodeGuardianRequest(r: GuardianRequest): string {
  return b64url(JSON.stringify(r));
}

const CONTRACT = /^C[A-Z2-7]{55}$/;
const HEX32 = /^[0-9a-f]{64}$/;

/** Parse a request from a link fragment, refusing anything malformed. */
export function decodeGuardianRequest(fragment: string): GuardianRequest {
  const r = JSON.parse(fromB64url(fragment.replace(/^#/, ''))) as GuardianRequest;
  if (!CONTRACT.test(r.account)) throw new Error('not a Nido account');
  if (r.kind === 'attempt') {
    if (!/^\d+$/.test(r.attemptId) || (r.domain !== 'initiate' && r.domain !== 'cancel')) {
      throw new Error('malformed recovery request');
    }
    return r;
  }
  if (r.kind === 'change') {
    if (!Number.isInteger(r.validUntil) || r.validUntil <= 0) throw new Error('malformed change request');
    const c = r.change;
    const ok =
      c.kind === 'reconfigure-remove' ||
      (c.kind === 'reconfigure-set' && HEX32.test(c.configHash)) ||
      (c.kind === 'upgrade' && /^\d+$/.test(c.requestId) && HEX32.test(c.wasmHash));
    if (!ok) throw new Error('malformed change request');
    return r;
  }
  throw new Error('unknown request');
}

/** The SDK change subject for a decoded request. */
export function changeSubject(c: Extract<GuardianRequest, { kind: 'change' }>['change']): perch.ChangeSubject {
  const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
  switch (c.kind) {
    case 'reconfigure-set':
      return { kind: 'reconfigure-set', configHash: bytes(c.configHash) };
    case 'reconfigure-remove':
      return { kind: 'reconfigure-remove' };
    case 'upgrade':
      return { kind: 'upgrade', requestId: BigInt(c.requestId), wasmHash: bytes(c.wasmHash) };
  }
}

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** The wire form of an SDK change subject, for a request link. */
export function changeToRequest(
  c: perch.ChangeSubject,
): Extract<GuardianRequest, { kind: 'change' }>['change'] {
  switch (c.kind) {
    case 'reconfigure-set':
      return { kind: 'reconfigure-set', configHash: hex(c.configHash) };
    case 'reconfigure-remove':
      return { kind: 'reconfigure-remove' };
    case 'upgrade':
      return { kind: 'upgrade', requestId: c.requestId.toString(), wasmHash: hex(c.wasmHash) };
  }
}

/** A ZK recovery kit: what the owner saves at enrollment and pastes back to
 *  prove. Never stored by the wallet. */
export interface RecoveryKit {
  version: 1;
  network: string;
  account: string;
  enrollmentId: string;
  secret: string;
}

export function parseRecoveryKit(text: string): RecoveryKit {
  const k = JSON.parse(text) as RecoveryKit;
  if (k.version !== 1 || !CONTRACT.test(k.account) || !HEX32.test(k.enrollmentId) || !HEX32.test(k.secret)) {
    throw new Error('That is not a Nido recovery kit.');
  }
  return k;
}
