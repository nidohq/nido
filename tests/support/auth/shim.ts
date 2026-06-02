import { makeCredential, makeAssertionCredential } from './credential';

export interface TestAuthConfig {
  seedHex: string;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function installTestAuthenticator(config: TestAuthConfig): void {
  const w = window as any;
  if (w.__testAuthenticator?.installed) return;

  const seed = hexToBytes(config.seedHex);
  const state = { installed: true, nextLabel: 'default', seedHex: config.seedHex };
  w.__testAuthenticator = {
    ...state,
    setNextLabel(label: string) { w.__testAuthenticator.nextLabel = label; },
  };
  // Marker for environments (real iOS) where console is unavailable.
  // This runs at document_start (readyState 'loading'), where
  // `document.documentElement` is still null in every engine — reading
  // `.dataset` on it would throw and abort the rest of this install (the
  // create/get overrides below), leaving the page on the NATIVE authenticator.
  // Set the marker now if the root element already exists, otherwise defer it
  // until the DOM is parsed. Either way, installation must not throw here.
  const setMarker = () => {
    if (document.documentElement) document.documentElement.dataset.testAuthenticator = '1';
  };
  if (document.documentElement) {
    setMarker();
  } else {
    document.addEventListener('DOMContentLoaded', setMarker, { once: true });
  }

  // Feature-detection shims so app code that gates on PublicKeyCredential passes.
  // Some engines (e.g. Playwright's Linux WebKit) ship a non-callable
  // `PublicKeyCredential` stub (`typeof` is `'object'`) with no Credentials
  // Management API at all; replace it with a constructor function so callers
  // that check `typeof window.PublicKeyCredential === 'function'` succeed.
  if (typeof w.PublicKeyCredential !== 'function') {
    w.PublicKeyCredential = function PublicKeyCredential() {};
  }
  w.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  w.PublicKeyCredential.isConditionalMediationAvailable = async () => true;

  // Where to install the create/get overrides. Engines with WebAuthn expose a
  // `navigator.credentials` (Chromium/Firefox) whose prototype we patch. WebKit
  // on Linux has neither `navigator.credentials` nor `window.CredentialsContainer`,
  // so synthesize a minimal container object on `navigator` instead. Patching an
  // existing prototype keeps behavior identical for engines that have one.
  const origCreate = navigator.credentials?.create?.bind(navigator.credentials);
  const origGet = navigator.credentials?.get?.bind(navigator.credentials);

  const create = async function (options: any) {
    if (!options || !options.publicKey) return origCreate ? origCreate(options) : null;
    return makeCredential(seed, w.__testAuthenticator.nextLabel);
  };
  const get = async function (options: any) {
    if (!options || !options.publicKey) return origGet ? origGet(options) : null;
    const allow = options.publicKey.allowCredentials;
    if (!allow || !allow.length) throw new Error('TestAuthenticator: get() needs allowCredentials');
    const id = new Uint8Array(allow[0].id);
    const challenge = new Uint8Array(options.publicKey.challenge);
    return makeAssertionCredential(seed, id, challenge);
  };

  const proto =
    (navigator.credentials && Object.getPrototypeOf(navigator.credentials)) ||
    (w.CredentialsContainer && w.CredentialsContainer.prototype);
  if (proto) {
    proto.create = create;
    proto.get = get;
  } else {
    // No Credentials Management API to patch (Linux WebKit): provide one.
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { create, get },
    });
  }
}
