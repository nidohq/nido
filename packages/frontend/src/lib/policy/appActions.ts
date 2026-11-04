// What the owner can do about a connected app, as /sign/ requests: remove
// it (`remove_scope`), remove one of its keys (`apply_scope` without it, or
// `remove_scope` when nothing is left), or clean up a scope a completed
// recovery ended (`gc_scope`). An older app permission in the admin
// document is removed with that document's own write (`withoutRules`).

import { canonicalJson, perch } from '@nidohq/passkey-sdk';
import type { SignRequest } from '../signing/signRequest.js';
import type { AppEntry } from './appScopes.js';

function name(app: AppEntry): string {
  return app.origin ?? `the app of scope ${app.scope}`;
}

function request(
  account: string,
  operation: SignRequest['operation'],
  title: string,
  subtitle: string,
  returnUrl: string,
): SignRequest {
  return {
    v: 1,
    kind: 'session-revoke',
    account,
    operation,
    title,
    subtitle,
    submitMode: 'relayer',
    returnTarget: { type: 'route', url: returnUrl },
  };
}

/** Remove `app`: every rule of its scope ends. */
export function removeAppRequest(account: string, app: AppEntry, returnUrl: string): SignRequest {
  return request(
    account,
    { type: 'remove-scope', scope: app.scope, origin: app.origin },
    'Remove an app',
    `removal of ${name(app)}`,
    returnUrl,
  );
}

/** Clean up `app`'s scope, which a completed recovery ended. */
export function cleanUpRequest(account: string, app: AppEntry, returnUrl: string): SignRequest {
  return request(
    account,
    { type: 'gc-scope', scope: app.scope, origin: app.origin },
    'Clean up an ended app',
    `clean-up of ${name(app)}`,
    returnUrl,
  );
}

/** Remove one of `app`'s keys: its scope without the key, or the whole
 *  scope when the key held every rule left. Throws when the scope's
 *  document is not readable. */
export function removeKeyRequest(account: string, app: AppEntry, signerId: string, returnUrl: string): SignRequest {
  if (app.doc === null || app.origin === null) {
    throw new Error("This app's permissions could not be read, so a key cannot be removed from them.");
  }
  const next = perch.withoutAppKey(app.doc, signerId);
  if (next === null) return removeAppRequest(account, app, returnUrl);
  return request(
    account,
    {
      type: 'apply-scope',
      scope: app.scope,
      origin: app.origin,
      docJson: canonicalJson(next),
      prevDocJson: canonicalJson(app.doc),
      prevDocHash: app.docHash,
      removesKey: signerId,
    },
    "Remove an app's key",
    `key removal for ${name(app)}`,
    returnUrl,
  );
}
