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
  document.documentElement.dataset.testAuthenticator = '1';

  // Feature-detection shims so app code that gates on PublicKeyCredential passes.
  if (!w.PublicKeyCredential) {
    w.PublicKeyCredential = function PublicKeyCredential() {};
  }
  w.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  w.PublicKeyCredential.isConditionalMediationAvailable = async () => true;

  const proto =
    (navigator.credentials && Object.getPrototypeOf(navigator.credentials)) ||
    (w.CredentialsContainer && w.CredentialsContainer.prototype);
  if (!proto) throw new Error('TestAuthenticator: no CredentialsContainer prototype');

  const origCreate = proto.create?.bind(navigator.credentials);
  const origGet = proto.get?.bind(navigator.credentials);

  proto.create = async function (options: any) {
    if (!options || !options.publicKey) return origCreate ? origCreate(options) : null;
    return makeCredential(seed, w.__testAuthenticator.nextLabel);
  };

  proto.get = async function (options: any) {
    if (!options || !options.publicKey) return origGet ? origGet(options) : null;
    const allow = options.publicKey.allowCredentials;
    if (!allow || !allow.length) throw new Error('TestAuthenticator: get() needs allowCredentials');
    const id = new Uint8Array(allow[0].id);
    const challenge = new Uint8Array(options.publicKey.challenge);
    return makeAssertionCredential(seed, id, challenge);
  };
}
