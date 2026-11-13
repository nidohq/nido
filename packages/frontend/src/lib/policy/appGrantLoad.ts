// The chain reads behind an app approval and the scope operations: the
// admin document, the account's excluded set and admin keys, and the app
// origin's scope. The rules over them are pure, in `appScopes.ts`.

import { parsePolicyDocJson, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import { NETWORK_PASSPHRASE, RPC_URL } from '../network.js';
import { perchDeployment } from '../recovery/deployment.js';
import { readAccountConfiguration } from '../policyChainFetch.js';
import { fetchAppliedDocument } from './docPolicyFetch.js';
import { adminKeys, excludedSet, type AppGrantContext } from './appScopes.js';

/** The account's scope views over this build's RPC. */
export function accountScopes(account: string): perch.ScopeReader {
  return perch.scopeReader({ account, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE });
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** What every scoped document is checked against: the applied admin
 *  document (null before the first `apply_doc`), the excluded set, and
 *  the keys of every rule scoped to the account itself (the constructor's
 *  passkey rule before the first apply). */
export async function loadScopeChecks(account: string): Promise<{
  admin: { doc: PolicyDoc; revision: bigint } | null;
  excluded: string[];
  adminKeys: perch.AppKey[];
}> {
  const [config, applied] = await Promise.all([readAccountConfiguration(account), fetchAppliedDocument(account)]);
  const doc = applied.json === undefined ? null : parsePolicyDocJson(applied.json);
  const installed = config.rules
    .filter((r) => !r.recovery && r.contract === account)
    .flatMap((r) => r.signers)
    .map((s): perch.AppKey => (s.kind === 'delegated' ? { address: s.address } : { verifier: s.verifier, key: hex(s.key) }));
  return {
    admin: doc === null ? null : { doc, revision: applied.revision },
    excluded: excludedSet({
      recoveryController: config.recoveryController,
      adminDoc: doc,
      deploymentController: perchDeployment()?.recoveryController ?? null,
    }),
    adminKeys: adminKeys(doc, installed),
  };
}

/**
 * Everything an approval from `origin` is built from. Throws
 * `perch.AppScopesTaken` when every scope id the origin could use holds
 * another app's permissions.
 */
export async function loadAppGrantContext(account: string, origin: string): Promise<AppGrantContext> {
  const canonical = perch.canonicalOrigin(origin);
  const [checks, scope] = await Promise.all([
    loadScopeChecks(account),
    perch.findAppScope(accountScopes(account), canonical),
  ]);
  return { account, origin: canonical, network: NETWORK_PASSPHRASE, ...checks, scope };
}

/** Whether `key` may be named in an app's scope: a recovery that completed
 *  after a scope named it ended it for good, so the app needs a new key. */
export async function appKeyUsable(account: string, key: perch.AppKey): Promise<boolean> {
  return perch.credentialUsable(accountScopes(account), key);
}
