import { join } from 'node:path';
import { build } from 'esbuild';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * The in-page TestAuthenticator (tests/support/auth) for ES-module specs,
 * which cannot import the CommonJS `fixtures.ts`: the same bundle and
 * config, installed on every page of `context`.
 */
export async function installPasskeyShim(context: BrowserContext, seedHex = '07'.repeat(32)): Promise<void> {
  const bundled = await build({
    entryPoints: [join(process.cwd(), 'tests/support/auth/entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    legalComments: 'none',
  });
  await context.addInitScript({ content: `window.__TEST_AUTH_CONFIG__=${JSON.stringify({ seedHex })};` });
  await context.addInitScript({ content: bundled.outputFiles[0]!.text });
}

/** Create a passkey with the authenticator on `page`'s origin, as
 *  registration does: its base64url credential id and its 65-byte SEC1
 *  public key (the tail of the SPKI), hex. */
export async function createShimPasskey(page: Page): Promise<{ credentialIdB64u: string; publicKeyHex: string }> {
  return page.evaluate(async () => {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array(32),
        rp: { id: location.hostname, name: 'test' },
        user: { id: new Uint8Array(16), name: 'test', displayName: 'test' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      },
    })) as PublicKeyCredential;
    const spki = new Uint8Array((cred.response as AuthenticatorAttestationResponse).getPublicKey()!);
    const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const b64u = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return { credentialIdB64u: b64u, publicKeyHex: hex(spki.slice(-65)) };
  });
}
