/**
 * "Use a passkey you already have": set up this device to sign for an account
 * with a passkey the user already holds, without creating a new one.
 *
 * An account's passkey is resident and bound to the account's own subdomain,
 * so iCloud Keychain or Google Password Manager carries it to the user's
 * other devices. What a new device lacks is only the local record of which
 * credential and key sign for the account (`passkey:<C>:*` in localStorage,
 * see `saveCredential`). This rebuilds that record:
 *
 * 1. a DISCOVERABLE `navigator.credentials.get()` over a fresh random
 *    challenge, user verification required (the user picks the passkey);
 * 2. the assertion's challenge, type, origin, rpIdHash, and UP/UV flags
 *    checked against this page (`checkAssertionContext`);
 * 3. its P-256 signature matched against the External keys on the account's
 *    non-recovery rules, from one `configuration()` read
 *    (`identifyAssertionSigner`), so only a key the chain already accepts
 *    can be saved. No indexer: the hostname is the account.
 *
 * A passkey that matches no key on the account is not saved; the caller
 * points the user at recovery instead.
 */

import {
  buf2hex,
  checkAssertionContext,
  identifyAssertionSigner,
  saveCredential,
} from '@nidohq/passkey-sdk';
import type { AssertionFailure, PasskeySignature } from '@nidohq/passkey-sdk';
import { withPasskeySheet } from './passkeySheet.js';
import { checkPasskeySupport } from './passkeySupport.js';
import { readAccountConfiguration } from './policyChainFetch.js';
import { runIdentifiedAssertionCeremony } from './walletSign.js';

export type AdoptPasskeyResult =
  | { kind: 'adopted'; credentialId: Uint8Array; publicKey: Uint8Array }
  /** The passkey verified, but its key signs for no rule on this account. */
  | { kind: 'not-a-signer' }
  /** The assertion failed a local check (see `AssertionFailure`). */
  | { kind: 'invalid'; reason: AssertionFailure; detail: string };

export interface AdoptPasskeyDeps {
  /** The page the ceremony runs on: its hostname (the rpId) and origin. */
  page: { rpId: string; origin: string };
  /** One discoverable WebAuthn ceremony over `challenge`. */
  getAssertion(challenge: Uint8Array): Promise<{ credentialId: Uint8Array; signature: PasskeySignature }>;
  /** The External public keys on the account's non-recovery rules. */
  readSignerKeys(account: string): Promise<Uint8Array[]>;
  save(account: string, credentialId: Uint8Array, publicKey: Uint8Array): void;
}

/** The External keys of every rule but the recovery rule: the keys
 *  `resolveSignerRule` can sign with. Duplicates (one key on several rules)
 *  are listed once. */
export async function readAccountSignerKeys(account: string): Promise<Uint8Array[]> {
  const config = await readAccountConfiguration(account);
  const keys = new Map<string, Uint8Array>();
  for (const rule of config.rules) {
    if (rule.recovery) continue;
    for (const signer of rule.signers) {
      if (signer.kind === 'external') keys.set(buf2hex(signer.key), signer.key);
    }
  }
  return [...keys.values()];
}

function browserDeps(): AdoptPasskeyDeps {
  return {
    page: { rpId: window.location.hostname, origin: window.location.origin },
    getAssertion: (challenge) => runIdentifiedAssertionCeremony(challenge),
    readSignerKeys: readAccountSignerKeys,
    save: saveCredential,
  };
}

/** Find, check, and save a passkey the user already has for `account`. */
export async function adoptExistingPasskey(
  account: string,
  deps: AdoptPasskeyDeps = browserDeps(),
): Promise<AdoptPasskeyResult> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  // Read the keys first: a failed read stops before the passkey prompt.
  const keys = await deps.readSignerKeys(account);
  const { credentialId, signature } = await deps.getAssertion(challenge);

  const context = await checkAssertionContext(signature, { challenge, ...deps.page });
  if (!context.ok) return { kind: 'invalid', reason: context.reason, detail: context.detail };

  const index = await identifyAssertionSigner(signature, keys);
  if (index === null) return { kind: 'not-a-signer' };

  const publicKey = keys[index];
  deps.save(account, credentialId, publicKey);
  return { kind: 'adopted', credentialId, publicKey };
}

/** The button's whole action: the support check, the passkey sheet, the
 *  adoption, and one sentence for the user when nothing was adopted. */
export async function adoptPasskeyAction(account: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const support = checkPasskeySupport();
  if (!support.ok) return { ok: false, message: support.message ?? "This browser can't use passkeys." };
  let result: AdoptPasskeyResult;
  try {
    result = await withPasskeySheet(() => adoptExistingPasskey(account), {
      title: 'Use your passkey',
      sub: "Pick this Nido's passkey. It syncs from your other devices.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Passkey signing was cancelled.') return { ok: false, message: 'No passkey was picked.' };
    return { ok: false, message: `Couldn't check your passkey: ${msg}` };
  }
  return result.kind === 'adopted' ? { ok: true } : { ok: false, message: adoptFailureMessage(result) };
}

/** What to tell the user for a result that adopted nothing. */
export function adoptFailureMessage(result: Exclude<AdoptPasskeyResult, { kind: 'adopted' }>): string {
  if (result.kind === 'not-a-signer') {
    return (
      "That passkey can't sign for this Nido. If you no longer have this Nido's passkey on any device, " +
      'recover access from Security → "Lost it? Recover".'
    );
  }
  return `That passkey couldn't be checked (${result.detail}). Try again, or recover access if it keeps failing.`;
}
