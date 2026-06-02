# Passkey Test Harness — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, cross-browser `TestAuthenticator` that mocks WebAuthn (`navigator.credentials.create/get`) in the page, plus the Playwright config + fixtures, and prove a fast UI e2e tier green on Chromium/Firefox/WebKit (shim) and a Chromium CDP virtual-authenticator fidelity lane.

**Architecture:** A self-contained in-page shim (esbuild-bundled IIFE injected via `addInitScript`) overrides `CredentialsContainer.prototype.create/get`. It derives a P-256 keypair deterministically from `(seed, credentialId)` and produces registration responses (SPKI + attestation CBOR) and assertions (reusing the SDK's `buildSyntheticAssertion`) that the app's real code and the on-chain verifier accept. Keys are a pure function of `credentialId`, so the vault is stateless across pages/origins. The existing Chromium-only CDP virtual authenticator becomes a separate fidelity lane.

**Tech Stack:** TypeScript, Playwright 1.58.2, Vitest (unit), `@noble/curves` 2.2.0, esbuild 0.27.3, Astro (frontend under `packages/frontend`).

**Scope:** This plan is Phase 1 only. Follow-on plans (not in this document): **Phase 0** BrowserStack-iOS de-risking spike (hard gate for the iOS lane), **Phase 2** testnet tier (funded bank + retries + quarantine), **Phase 3** dapp/SEP-7 + multi-actor recovery/session-key flows, **Phase 4** real-device/BrowserStack matrix. See `docs/superpowers/specs/2026-06-02-cross-browser-passkey-test-harness-design.md`.

---

## File Structure

**New files:**
- `tests/support/auth/vault.ts` — deterministic P-256 key derivation (seed+credentialId → keypair).
- `tests/support/auth/spki.ts` — wrap a 65-byte point in DER SPKI for `getPublicKey()`.
- `tests/support/auth/attestation.ts` — build authData + COSE key + attestationObject CBOR (the `getPublicKey()`-unavailable fallback path).
- `tests/support/auth/assertion.ts` — build an assertion for a credentialId+challenge (reuses SDK `buildSyntheticAssertion`).
- `tests/support/auth/credential.ts` — assemble the fake `PublicKeyCredential` objects returned by create/get.
- `tests/support/auth/shim.ts` — `installTestAuthenticator()`: override prototype methods, define `window.PublicKeyCredential`, idempotent guard, `window.__testAuthenticator` debug API.
- `tests/support/auth/entry.ts` — bundle entry: reads `window.__TEST_AUTH_CONFIG__`, calls install.
- `tests/support/auth/bundle.ts` — esbuild the entry into a memoized IIFE string (Node-side, used by fixtures).
- `tests/support/auth/*.test.ts` — Vitest unit tests for vault/spki/attestation/assertion.
- `tests/support/server.mjs` — static file server for `packages/frontend/dist` with `*.localhost` support (Playwright `webServer`).
- `tests/support/fixtures.ts` — Playwright `test` extended to inject the shim + helpers.
- `tests/support/cdp.ts` — CDP virtual-authenticator helper (Chromium fidelity lane).
- `tests/e2e/ui/registration.spec.ts` — first cross-browser shim registration test.
- `tests/e2e/ui/registration.cdp.spec.ts` — CDP fidelity registration test (chromium-cdp project).
- `tests/e2e/ui/account-ui.spec.ts` — migrated UI-only assertions from the old spec.
- `playwright.config.ts` (root) — projects, webServer, tiers.
- `vitest.support.config.ts` (root) — Vitest config for `tests/support/**`.
- `tests/README.md` — how to run the tiers.

**Modified files:**
- `package.json` (root) — add devDeps (`esbuild` explicit, `@noble/curves` for the shim build), test scripts.
- `justfile` — `test-support`, `test-e2e`, `test-e2e-cdp` recipes.
- `.gitignore` — ignore `test-results/`, `playwright-report/`, `tests/support/auth/.bundle-cache`.
- `tests/e2e/account-name.spec.ts` — removed (its content is split into `account-ui.spec.ts` + the migrated CDP test; the testnet block is deferred to Phase 2).

---

## Prerequisite Task: Workspace ready

**Files:** none created.

- [ ] **Step 1: Install dependencies in this worktree**

Run:
```bash
cd /home/willem/c/s/g2c-passkey-e2e
npm install
```
Expected: completes; `node_modules/` populated (local node_modules is stale per project memory).

- [ ] **Step 2: Build the frontend once (e2e serves `dist/`)**

Run:
```bash
just build-astro
```
Expected: `packages/frontend/dist/` exists with `index.html`, `account/index.html`, `new-account/index.html`, etc. (astro-check has a known 2-error baseline; `build-astro` should still emit `dist/`).

- [ ] **Step 3: Add explicit devDeps + scripts to root `package.json`**

Edit root `package.json` to:
```json
{
  "private": true,
  "workspaces": [
    "packages/*",
    "packages/contract-bindings/*"
  ],
  "scripts": {
    "test:support": "vitest run --config vitest.support.config.ts",
    "test:e2e": "playwright test --grep @fast",
    "test:e2e:cdp": "playwright test --project=chromium-cdp"
  },
  "devDependencies": {
    "@playwright/test": "^1.58.2",
    "@noble/curves": "^2.2.0",
    "esbuild": "^0.27.3",
    "vitest": "^4.1.7"
  }
}
```
Run: `npm install`
Expected: completes; `node_modules/.bin/{playwright,vitest,esbuild}` resolve.

- [ ] **Step 4: Install Playwright browsers**

Run:
```bash
npx playwright install chromium firefox webkit
```
Expected: downloads the three engines.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(test): add esbuild/noble/vitest devdeps and e2e scripts"
```

---

## Task 1: Deterministic key vault

**Files:**
- Create: `tests/support/auth/vault.ts`
- Test: `tests/support/auth/vault.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/support/auth/vault.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  credentialIdForLabel,
  privateKeyForCredentialId,
  publicKeyFromPrivate,
} from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('vault', () => {
  it('derives a stable 32-byte credentialId per label', async () => {
    const a = await credentialIdForLabel(SEED, 'originator');
    const b = await credentialIdForLabel(SEED, 'originator');
    const c = await credentialIdForLabel(SEED, 'friend-a');
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
    expect(a).not.toEqual(c);
  });

  it('derives a valid, stable private key per credentialId', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const d1 = await privateKeyForCredentialId(SEED, id);
    const d2 = await privateKeyForCredentialId(SEED, id);
    expect(d1).toEqual(d2);
    expect(d1.length).toBe(32);
  });

  it('produces a 65-byte uncompressed public key (0x04 prefix)', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const d = await privateKeyForCredentialId(SEED, id);
    const pub = publicKeyFromPrivate(d);
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

First create `vitest.support.config.ts` (content in **Task 8, Step 1**) so the runner resolves, then run:
`npx vitest run --config vitest.support.config.ts tests/support/auth/vault.test.ts`
Expected: FAIL "Cannot find module './vault'".

- [ ] **Step 3: Implement `vault.ts`**

`tests/support/auth/vault.ts`:
```ts
import { p256 } from '@noble/curves/nist.js';

const enc = new TextEncoder();

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

/** Stable 32-byte credential id for a logical test identity. */
export async function credentialIdForLabel(
  seed: Uint8Array,
  label: string,
): Promise<Uint8Array> {
  return sha256(seed, enc.encode(`g2c-test-cred:${label}`));
}

/**
 * Private scalar derived purely from (seed, credentialId). Because `get()`
 * re-derives from the credentialId it receives, the vault needs no shared
 * mutable state across pages/origins.
 */
export async function privateKeyForCredentialId(
  seed: Uint8Array,
  credentialId: Uint8Array,
): Promise<Uint8Array> {
  let d = await sha256(seed, credentialId);
  // For P-256 essentially every 32-byte value is a valid scalar; loop is a
  // safety net for the negligible out-of-range case.
  while (!p256.utils.isValidSecretKey(d)) {
    d = await sha256(d);
  }
  return d;
}

/** 65-byte uncompressed P-256 public key (0x04 || x || y). */
export function publicKeyFromPrivate(d: Uint8Array): Uint8Array {
  return p256.getPublicKey(d, false);
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/vault.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/support/auth/vault.ts tests/support/auth/vault.test.ts
git commit -m "feat(test): deterministic P-256 vault for TestAuthenticator"
```

---

## Task 2: SPKI wrapper (for `getPublicKey()`)

**Files:**
- Create: `tests/support/auth/spki.ts`
- Test: `tests/support/auth/spki.test.ts`

The app reads the public key via `extractPublicKey(response)` which calls `getPublicKey()` and takes the **last 65 bytes** of the SPKI (`packages/passkey-sdk/src/webauthn.ts:22-36`). This task validates against that exact consumer.

- [ ] **Step 1: Write the failing test**

`tests/support/auth/spki.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSpki } from './spki';
import { extractPublicKey } from '../../../packages/passkey-sdk/src/webauthn';
import { publicKeyFromPrivate, privateKeyForCredentialId, credentialIdForLabel } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('spki', () => {
  it('wraps a point so the SDK extractPublicKey returns it', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const pub = publicKeyFromPrivate(await privateKeyForCredentialId(SEED, id));
    const spki = buildSpki(pub);
    // The SDK's extractPublicKey consumes an object with getPublicKey().
    const got = extractPublicKey({
      getPublicKey: () => spki.buffer.slice(spki.byteOffset, spki.byteOffset + spki.byteLength),
      attestationObject: new ArrayBuffer(0),
    } as unknown as Parameters<typeof extractPublicKey>[0]);
    expect(Array.from(got)).toEqual(Array.from(pub));
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/spki.test.ts`
Expected: FAIL "Cannot find module './spki'".

- [ ] **Step 3: Implement `spki.ts`**

`tests/support/auth/spki.ts`:
```ts
// DER SubjectPublicKeyInfo prefix for an uncompressed P-256 (prime256v1) key.
// SEQUENCE { SEQUENCE { OID ecPublicKey, OID prime256v1 }, BIT STRING (00 || point) }
const P256_SPKI_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

/** Wrap a 65-byte uncompressed point in DER SPKI (91 bytes total). */
export function buildSpki(point65: Uint8Array): Uint8Array {
  if (point65.length !== 65 || point65[0] !== 0x04) {
    throw new Error('buildSpki: expected 65-byte uncompressed point');
  }
  const out = new Uint8Array(P256_SPKI_PREFIX.length + 65);
  out.set(P256_SPKI_PREFIX, 0);
  out.set(point65, P256_SPKI_PREFIX.length);
  return out;
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/spki.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/support/auth/spki.ts tests/support/auth/spki.test.ts
git commit -m "feat(test): DER SPKI wrapper validated against SDK extractPublicKey"
```

---

## Task 3: Attestation object CBOR (fallback path)

**Files:**
- Create: `tests/support/auth/attestation.ts`
- Test: `tests/support/auth/attestation.test.ts`

Validates against the SDK's `parseAttestationObject` (`webauthn.ts:45-49,206-316`), the path used when `getPublicKey()` is unavailable (mobile WebView).

- [ ] **Step 1: Write the failing test**

`tests/support/auth/attestation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildAttestationObject } from './attestation';
import { parseAttestationObject } from '../../../packages/passkey-sdk/src/webauthn';
import { buf2base64url } from '../../../packages/passkey-sdk/src/encoding';
import { publicKeyFromPrivate, privateKeyForCredentialId, credentialIdForLabel } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('attestation', () => {
  it('encodes an attestationObject the SDK can parse back to the pubkey', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const pub = publicKeyFromPrivate(await privateKeyForCredentialId(SEED, id));
    const attObj = buildAttestationObject(id, pub);
    const got = parseAttestationObject(buf2base64url(attObj));
    expect(Array.from(got)).toEqual(Array.from(pub));
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/attestation.test.ts`
Expected: FAIL "Cannot find module './attestation'".

- [ ] **Step 3: Implement `attestation.ts`**

`tests/support/auth/attestation.ts`:
```ts
/** Build authData: rpIdHash(32) | flags(1, AT|UV|UP) | signCount(4) |
 *  AAGUID(16) | credIdLen(2 BE) | credId | COSE key (77 bytes for P-256). */
function buildAuthData(credentialId: Uint8Array, point65: Uint8Array): Uint8Array {
  const x = point65.slice(1, 33);
  const y = point65.slice(33, 65);

  // COSE_Key: {1:2(EC2), 3:-7(ES256), -1:1(P-256), -2:x, -3:y}
  const cose = new Uint8Array([
    0xa5, // map(5)
    0x01, 0x02, // kty: EC2
    0x03, 0x26, // alg: ES256 (-7)
    0x20, 0x01, // crv (-1): P-256 (1)
    0x21, 0x58, 0x20, ...x, // x (-2): bstr(32)
    0x22, 0x58, 0x20, ...y, // y (-3): bstr(32)
  ]);

  const credLen = credentialId.length;
  const out = new Uint8Array(32 + 1 + 4 + 16 + 2 + credLen + cose.length);
  let o = 0;
  o += 32;                       // rpIdHash (zeros; SDK ignores value)
  out[o++] = 0x45;               // flags: UP(0x01)|UV(0x04)|AT(0x40)
  o += 4;                        // signCount (zeros)
  o += 16;                       // AAGUID (zeros)
  out[o++] = (credLen >> 8) & 0xff;
  out[o++] = credLen & 0xff;
  out.set(credentialId, o); o += credLen;
  out.set(cose, o);
  return out;
}

function textKey(s: string): number[] {
  const b = new TextEncoder().encode(s);
  return [0x60 | b.length, ...b]; // text string, len < 24
}

/** attestationObject CBOR: {fmt:"none", attStmt:{}, authData:<bytes>}. */
export function buildAttestationObject(
  credentialId: Uint8Array,
  point65: Uint8Array,
): Uint8Array {
  const authData = buildAuthData(credentialId, point65);
  if (authData.length >= 0x10000) throw new Error('authData too long');

  const head: number[] = [
    0xa3, // map(3)
    ...textKey('fmt'), ...textKey('none'),
    ...textKey('attStmt'), 0xa0, // empty map
    ...textKey('authData'),
  ];
  // authData byte string: len needs 1 or 2 length bytes.
  const lenBytes =
    authData.length < 24
      ? [0x40 | authData.length]
      : authData.length < 256
        ? [0x58, authData.length]
        : [0x59, (authData.length >> 8) & 0xff, authData.length & 0xff];

  const out = new Uint8Array(head.length + lenBytes.length + authData.length);
  out.set(head, 0);
  out.set(lenBytes, head.length);
  out.set(authData, head.length + lenBytes.length);
  return out;
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/attestation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/support/auth/attestation.ts tests/support/auth/attestation.test.ts
git commit -m "feat(test): attestationObject CBOR validated against SDK parser"
```

---

## Task 4: Assertion builder

**Files:**
- Create: `tests/support/auth/assertion.ts`
- Test: `tests/support/auth/assertion.test.ts`

Reuses the SDK's `buildSyntheticAssertion` so the crypto stays byte-identical to the Rust integration tests; validates via the SDK's `parseAssertionResponse`.

- [ ] **Step 1: Write the failing test**

`tests/support/auth/assertion.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeAssertion } from './assertion';
import { parseAssertionResponse } from '../../../packages/passkey-sdk/src/auth';
import { credentialIdForLabel } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('assertion', () => {
  it('produces an assertion the SDK can parse (37-byte authData, 64-byte sig)', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const challenge = new Uint8Array(32).fill(9);
    const a = await makeAssertion(SEED, id, challenge);
    expect(a.authenticatorData.length).toBe(37);
    expect(a.signature.length).toBe(64);
    const parsed = parseAssertionResponse({
      authenticatorData: a.authenticatorData,
      clientDataJSON: a.clientDataJSON,
      signature: a.signature,
    });
    expect(parsed).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/assertion.test.ts`
Expected: FAIL "Cannot find module './assertion'".

- [ ] **Step 3: Implement `assertion.ts`**

`tests/support/auth/assertion.ts`:
```ts
import { buildSyntheticAssertion } from '../../../packages/passkey-sdk/src/syntheticAssertion';
import { privateKeyForCredentialId } from './vault';

export interface Assertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}

/** Build a WebAuthn assertion over `challenge32` for the key behind
 *  `credentialId`. Verifier ignores origin/rpIdHash, so the SDK's synthetic
 *  assertion is accepted as-is. */
export async function makeAssertion(
  seed: Uint8Array,
  credentialId: Uint8Array,
  challenge32: Uint8Array,
): Promise<Assertion> {
  const d = await privateKeyForCredentialId(seed, credentialId);
  return buildSyntheticAssertion(d, challenge32);
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/assertion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/support/auth/assertion.ts tests/support/auth/assertion.test.ts
git commit -m "feat(test): assertion builder reusing SDK buildSyntheticAssertion"
```

---

## Task 5: Fake credential assembly

**Files:**
- Create: `tests/support/auth/der.ts` (compact→DER signature, since real authenticators return DER and the app's `parseAssertionResponse` calls `derToCompact`, which throws on a non-DER signature).
- Create: `tests/support/auth/credential.ts`
- Test: `tests/support/auth/der.test.ts`, `tests/support/auth/credential.test.ts`

Pure functions that build the objects `create()`/`get()` return, validated against the SDK's `parseRegistration` and `parseAssertionResponse`.

**Why DER:** `buildSyntheticAssertion` returns a 64-byte compact `r‖s` signature (what the Rust tests consume directly). But a real `navigator.credentials.get()` returns a **DER**-encoded signature, and the app's `parseAssertionResponse` runs `derToCompact(signature)` (`packages/passkey-sdk/src/signature.ts:14` throws unless `sig[0] === 0x30`). So the `get()` credential's `response.signature` must be DER, or every signing flow (Phase 2+) breaks. `der.ts` encodes compact→DER; `derToCompact` then recovers the same low-S compact.

- [ ] **Step 1: Write the failing test**

`tests/support/auth/credential.test.ts`:
`tests/support/auth/der.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { compactToDer } from './der';
import { derToCompact } from '../../../packages/passkey-sdk/src/signature';
import { makeAssertion } from './assertion';
import { credentialIdForLabel } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('der', () => {
  it('compact→DER round-trips through the SDK derToCompact', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const a = await makeAssertion(SEED, id, new Uint8Array(32).fill(9));
    const der = compactToDer(a.signature);
    expect(der[0]).toBe(0x30); // SEQUENCE — what a real authenticator returns
    // a.signature is already low-S, so derToCompact recovers it byte-for-byte.
    expect(Array.from(derToCompact(der))).toEqual(Array.from(a.signature));
  });
});
```

`tests/support/auth/credential.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeCredential, makeAssertionCredential } from './credential';
import { parseRegistration } from '../../../packages/passkey-sdk/src/webauthn';
import { parseAssertionResponse } from '../../../packages/passkey-sdk/src/auth';
import { credentialIdForLabel, privateKeyForCredentialId, publicKeyFromPrivate } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('credential', () => {
  it('create-credential parses to the right pubkey + credentialId', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const pub = publicKeyFromPrivate(await privateKeyForCredentialId(SEED, id));
    const cred = await makeCredential(SEED, 'originator');
    const reg = parseRegistration(cred as any);
    expect(Array.from(reg.publicKey)).toEqual(Array.from(pub));
    expect(Array.from(reg.credentialId)).toEqual(Array.from(id));
    expect(cred.type).toBe('public-key');
  });

  it('get-credential response parses via the SDK parseAssertionResponse', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const cred = await makeAssertionCredential(SEED, id, new Uint8Array(32).fill(9));
    const r = cred.response as AuthenticatorAssertionResponse;
    expect(new Uint8Array(r.authenticatorData).length).toBe(37);
    // This is the exact call the app's signing flow makes; DER signature required.
    const parsed = parseAssertionResponse({
      authenticatorData: r.authenticatorData,
      clientDataJSON: r.clientDataJSON,
      signature: r.signature,
    });
    expect(parsed.signature.length).toBe(64);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/der.test.ts tests/support/auth/credential.test.ts`
Expected: FAIL "Cannot find module './der'" / "./credential".

- [ ] **Step 3: Implement `der.ts`**

`tests/support/auth/der.ts`:
```ts
/** Encode a 64-byte compact (r‖s) ECDSA signature as ASN.1 DER — the form a
 *  real authenticator returns. The app calls derToCompact() on
 *  response.signature, which throws unless the first byte is 0x30. P-256 DER
 *  is always < 128 bytes, so single-byte lengths suffice. */
export function compactToDer(rs: Uint8Array): Uint8Array {
  if (rs.length !== 64) throw new Error('compactToDer: expected 64-byte r||s');
  const derInt = (int: Uint8Array): number[] => {
    let i = 0;
    while (i < int.length - 1 && int[i] === 0) i++; // strip leading zeros
    let bytes = Array.from(int.slice(i));
    if (bytes[0] & 0x80) bytes = [0x00, ...bytes]; // keep positive
    return [0x02, bytes.length, ...bytes];
  };
  const body = [...derInt(rs.slice(0, 32)), ...derInt(rs.slice(32, 64))];
  return new Uint8Array([0x30, body.length, ...body]);
}
```

- [ ] **Step 4: Implement `credential.ts`**

`tests/support/auth/credential.ts`:
```ts
import { credentialIdForLabel, privateKeyForCredentialId, publicKeyFromPrivate } from './vault';
import { buildSpki } from './spki';
import { buildAttestationObject } from './attestation';
import { makeAssertion } from './assertion';
import { compactToDer } from './der';

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function b64u(u: Uint8Array): string {
  let s = btoa(String.fromCharCode(...u));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build a registration PublicKeyCredential for a logical identity label. */
export async function makeCredential(seed: Uint8Array, label: string) {
  const credentialId = await credentialIdForLabel(seed, label);
  const d = await privateKeyForCredentialId(seed, credentialId);
  const pub = publicKeyFromPrivate(d);
  const spki = toArrayBuffer(buildSpki(pub));
  const attObj = toArrayBuffer(buildAttestationObject(credentialId, pub));
  const rawId = toArrayBuffer(credentialId);
  return {
    id: b64u(credentialId),
    rawId,
    type: 'public-key' as const,
    authenticatorAttachment: 'platform' as const,
    response: {
      getPublicKey: () => spki,
      getPublicKeyAlgorithm: () => -7,
      getAuthenticatorData: () => attObj,
      getTransports: () => ['internal'],
      attestationObject: attObj,
      clientDataJSON: toArrayBuffer(
        new TextEncoder().encode('{"type":"webauthn.create"}'),
      ),
    },
    getClientExtensionResults: () => ({}),
  };
}

/** Build an authentication PublicKeyCredential for a credentialId+challenge. */
export async function makeAssertionCredential(
  seed: Uint8Array,
  credentialId: Uint8Array,
  challenge32: Uint8Array,
) {
  const a = await makeAssertion(seed, credentialId, challenge32);
  return {
    id: b64u(credentialId),
    rawId: toArrayBuffer(credentialId),
    type: 'public-key' as const,
    authenticatorAttachment: 'platform' as const,
    response: {
      authenticatorData: toArrayBuffer(a.authenticatorData),
      clientDataJSON: toArrayBuffer(a.clientDataJSON),
      // DER-encoded (real authenticators return DER; app calls derToCompact).
      signature: toArrayBuffer(compactToDer(a.signature)),
      userHandle: null,
    },
    getClientExtensionResults: () => ({}),
  };
}
```

- [ ] **Step 5: Run it; verify it passes**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/der.test.ts tests/support/auth/credential.test.ts`
Expected: PASS (3 tests). The credential get-path now parses via the exact `parseAssertionResponse` the app uses.

- [ ] **Step 6: Commit**

```bash
git add tests/support/auth/der.ts tests/support/auth/der.test.ts tests/support/auth/credential.ts tests/support/auth/credential.test.ts
git commit -m "feat(test): fake PublicKeyCredential objects (DER signature for app parse path)"
```

---

## Task 6: Shim install + bundle

**Files:**
- Create: `tests/support/auth/shim.ts`, `tests/support/auth/entry.ts`, `tests/support/auth/bundle.ts`
- Test: `tests/support/auth/bundle.test.ts`

- [ ] **Step 1: Write the failing test** (bundle builds a non-empty IIFE)

`tests/support/auth/bundle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getInitScript } from './bundle';

describe('bundle', () => {
  it('produces a self-contained IIFE string', async () => {
    const script = await getInitScript();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(1000);
    // Bundled, not an ESM module (no top-level import/export left).
    expect(script).not.toMatch(/^\s*import\s/m);
    expect(script).toContain('__testAuthenticator');
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/bundle.test.ts`
Expected: FAIL "Cannot find module './bundle'".

- [ ] **Step 3: Implement `shim.ts`**

`tests/support/auth/shim.ts`:
```ts
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
```

- [ ] **Step 4: Implement `entry.ts`**

`tests/support/auth/entry.ts`:
```ts
import { installTestAuthenticator } from './shim';

const cfg = (window as any).__TEST_AUTH_CONFIG__;
if (cfg) installTestAuthenticator(cfg);
```

- [ ] **Step 5: Implement `bundle.ts`**

`tests/support/auth/bundle.ts`:
```ts
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let cached: string | null = null;

/** Bundle the in-page TestAuthenticator into one IIFE string (memoized). */
export async function getInitScript(): Promise<string> {
  if (cached) return cached;
  const result = await build({
    entryPoints: [join(here, 'entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    legalComments: 'none',
  });
  cached = result.outputFiles[0].text;
  return cached;
}
```

- [ ] **Step 6: Run it; verify it passes**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/bundle.test.ts`
Expected: PASS (esbuild bundles entry → shim → credential → vault/spki/attestation/assertion → @noble/curves).

- [ ] **Step 7: Commit**

```bash
git add tests/support/auth/shim.ts tests/support/auth/entry.ts tests/support/auth/bundle.ts tests/support/auth/bundle.test.ts
git commit -m "feat(test): TestAuthenticator shim install + esbuild bundle"
```

---

## Task 7: Static server for `dist/`

**Files:**
- Create: `tests/support/server.mjs`

Adapted from the existing `tests/e2e/account-name.spec.ts` server, standalone so Playwright's `webServer` manages it (fixes port collisions under parallel workers).

- [ ] **Step 1: Implement `server.mjs`**

`tests/support/server.mjs`:
```js
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST_DIR = new URL('../../packages/frontend/dist/', import.meta.url).pathname;
const PORT = Number(process.env.E2E_PORT || 4399);

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  let filePath = join(DIST_DIR, urlPath === '/' ? '/index.html' : urlPath);
  if (!extname(filePath)) filePath = join(filePath, 'index.html');
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`e2e static server on ${PORT}`));
```

- [ ] **Step 2: Smoke-test it manually**

Run:
```bash
E2E_PORT=4399 node tests/support/server.mjs &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4399/account/
kill %1
```
Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git add tests/support/server.mjs
git commit -m "feat(test): standalone static server for e2e webServer"
```

---

## Task 8: Playwright config + Vitest support config

**Files:**
- Create: `playwright.config.ts`, `vitest.support.config.ts`

- [ ] **Step 1: Implement `vitest.support.config.ts`** (if not already created in Task 1)

`vitest.support.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/support/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Implement `playwright.config.ts`**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4399);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: `node tests/support/server.mjs`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
  },
  projects: [
    // Cross-browser shim lane (@fast). Excludes *.cdp.spec.ts.
    {
      name: 'chromium',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Safari'] },
    },
    // Chromium-only fidelity lane: real virtual authenticator.
    {
      name: 'chromium-cdp',
      testMatch: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

- [ ] **Step 3: Verify config loads**

Run: `npx playwright test --list`
Expected: lists projects (chromium, firefox, webkit, chromium-cdp) with no spec files yet (or "no tests found") — no config errors.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts vitest.support.config.ts
git commit -m "feat(test): playwright config (tiers/projects) + vitest support config"
```

---

## Task 9: Shim fixture

**Files:**
- Create: `tests/support/fixtures.ts`

- [ ] **Step 1: Implement `fixtures.ts`**

`tests/support/fixtures.ts`:
```ts
import { test as base, expect } from '@playwright/test';
import { getInitScript } from './auth/bundle';

// Fixed 32-byte seed → deterministic credentialIds → deterministic accounts.
export const SEED_HEX = '07'.repeat(32);

export const test = base.extend({
  context: async ({ context }, use) => {
    const script = await getInitScript();
    await context.addInitScript({
      content: `window.__TEST_AUTH_CONFIG__=${JSON.stringify({ seedHex: SEED_HEX })};`,
    });
    await context.addInitScript({ content: script });
    await use(context);
  },
});

/** Set which logical identity the next create() mints. */
export async function useIdentity(page: import('@playwright/test').Page, label: string) {
  await page.evaluate((l) => (window as any).__testAuthenticator.setNextLabel(l), label);
}

export { expect };
```

- [ ] **Step 2: Typecheck the fixture**

Run: `npx tsc --noEmit -p packages/frontend/tsconfig.json tests/support/fixtures.ts 2>&1 | head` — if no project picks it up, instead run `npx tsc --noEmit tests/support/fixtures.ts --moduleResolution bundler --module esnext --target es2020 --types node`.
Expected: no type errors (fixture compiles).

- [ ] **Step 3: Commit**

```bash
git add tests/support/fixtures.ts
git commit -m "feat(test): playwright fixture injecting the TestAuthenticator"
```

---

## Task 10: Cross-browser registration e2e (shim)

**Files:**
- Create: `tests/e2e/ui/registration.spec.ts`

Drives the real `new-account` registration UI on a contract subdomain. Verifies the shim's `create()` flows through `parseRegistration` and the page renders the pubkey/credId. Runs on chromium/firefox/webkit.

- [ ] **Step 1: Confirm the registration UI element IDs on this branch**

Run:
```bash
grep -nE 'id="register-btn"|id="register-result"|register' packages/frontend/src/pages/new-account/index.astro | head
```
Expected: shows `#register-btn` and a result/info element. If the IDs differ from the test below, update the selectors in Step 2 to match (record the actual IDs).

- [ ] **Step 2: Write the test**

`tests/e2e/ui/registration.spec.ts`:
```ts
import { test, expect } from '../../support/fixtures';

// Deterministic fake contract subdomain (valid strkey, lower-cased for host).
const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const PORT = Number(process.env.E2E_PORT || 4399);

test.describe('@fast passkey registration (shim)', () => {
  test('shim is installed before page scripts', async ({ page }) => {
    await page.goto(`http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}/new-account/`);
    const marker = await page.evaluate(
      () => document.documentElement.dataset.testAuthenticator,
    );
    expect(marker).toBe('1');
    const hasPkc = await page.evaluate(() => typeof (window as any).PublicKeyCredential);
    expect(hasPkc).toBe('function');
  });

  test('register via shim renders the derived passkey', async ({ page }) => {
    await page.goto(`http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}/new-account/`, {
      waitUntil: 'networkidle',
    });
    await page.locator('#register-btn').click();
    // The page shows registration result once parseRegistration succeeds.
    await expect(page.locator('#register-result')).toBeVisible({ timeout: 10_000 });
    // The credential should be persisted under the contract id.
    const stored = await page.evaluate((cid) => {
      return {
        cred: localStorage.getItem(`passkey:${cid}:credentialId`),
        pub: localStorage.getItem(`passkey:${cid}:publicKey`),
      };
    }, FAKE_CONTRACT_ID);
    expect(stored.cred).toBeTruthy();
    expect(stored.pub).toMatch(/^04[0-9a-f]{128}$/);
  });
});
```

- [ ] **Step 3: Run on chromium first**

Run: `npx playwright test tests/e2e/ui/registration.spec.ts --project=chromium`
Expected: PASS (2 tests). If `#register-result` is wrong, fix the selector per Step 1's actual IDs and re-run.

- [ ] **Step 4: Run on firefox + webkit**

Run: `npx playwright test tests/e2e/ui/registration.spec.ts --project=firefox --project=webkit`
Expected: PASS on both (proves the shim is cross-engine). If WebKit double-runs the init script, the idempotent guard keeps it correct — verify still green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ui/registration.spec.ts
git commit -m "test(e2e): cross-browser passkey registration via shim"
```

---

## Task 11: Migrate existing spec → UI tier + CDP lane

**Files:**
- Create: `tests/e2e/ui/account-ui.spec.ts`, `tests/e2e/ui/registration.cdp.spec.ts`, `tests/support/cdp.ts`
- Delete: `tests/e2e/account-name.spec.ts`

- [ ] **Step 1: Implement the CDP helper**

`tests/support/cdp.ts`:
```ts
import type { Page, CDPSession } from '@playwright/test';

/** Chromium-only: install a real virtual authenticator via CDP. */
export async function setupVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return client;
}
```

- [ ] **Step 2: Create `account-ui.spec.ts`** (the no-authenticator UI assertions from the old spec, tagged `@fast`, using the base `@playwright/test` `test` since they don't need the shim)

`tests/e2e/ui/account-ui.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../../../packages/frontend/dist/', import.meta.url).pathname;
const FAKE = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const PORT = Number(process.env.E2E_PORT || 4399);

test.describe('@fast account page UI', () => {
  test('built HTML contains name section elements', () => {
    const html = readFileSync(join(DIST, 'account/index.html'), 'utf-8');
    expect(html).toContain('id="name-section"');
    expect(html).toContain('id="claim-name-btn"');
  });

  test('page loads without fatal JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/account/`, { waitUntil: 'networkidle' });
    const fatal = errors.filter(
      (e) => e.includes('Buffer') || e.includes('is not defined') || e.includes('Unexpected token'),
    );
    expect(fatal).toEqual([]);
  });

  test('empty name rejected by client validation', async ({ page }) => {
    await page.goto(`http://${FAKE.toLowerCase()}.localhost:${PORT}/account/`, { waitUntil: 'networkidle' });
    await page.locator('#claim-name-btn').click();
    await expect(page.locator('#error-box')).toBeVisible();
    await expect(page.locator('#error-box')).toContainText('1-15 characters');
  });
});
```
Note: if the migrated assertions reference IDs that changed, run the grep from Task 10 Step 1 against `account/index.astro` and adjust. (Per investigation, these IDs are stable across the reskin.)

- [ ] **Step 3: Create `registration.cdp.spec.ts`** (the real-virtual-authenticator fidelity test)

`tests/e2e/ui/registration.cdp.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { setupVirtualAuthenticator } from '../../support/cdp';

const FAKE = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const PORT = Number(process.env.E2E_PORT || 4399);

// Runs only in the chromium-cdp project (testMatch *.cdp.spec.ts).
test('passkey registration with real virtual authenticator', async ({ page }) => {
  await page.goto(`http://${FAKE.toLowerCase()}.localhost:${PORT}/new-account/`, { waitUntil: 'networkidle' });
  await setupVirtualAuthenticator(page);
  await page.locator('#register-btn').click();
  await expect(page.locator('#register-result')).toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 4: Delete the old spec**

Run: `git rm tests/e2e/account-name.spec.ts`
(The testnet `describe` block it contained is re-created in the Phase 2 plan.)

- [ ] **Step 5: Run the UI tier + CDP lane**

Run:
```bash
npx playwright test --grep @fast
npx playwright test --project=chromium-cdp
```
Expected: UI tier green across chromium/firefox/webkit; CDP lane green on chromium.

- [ ] **Step 6: Commit**

```bash
git add tests/support/cdp.ts tests/e2e/ui/account-ui.spec.ts tests/e2e/ui/registration.cdp.spec.ts
git rm tests/e2e/account-name.spec.ts
git commit -m "test(e2e): migrate old spec into UI tier + CDP fidelity lane"
```

---

## Task 12: Recipes, ignores, docs

**Files:**
- Modify: `justfile`, `.gitignore`
- Create: `tests/README.md`

- [ ] **Step 1: Add `just` recipes**

Append to `justfile`:
```make
# Run TestAuthenticator unit tests (vitest, node)
test-support:
    npx vitest run --config vitest.support.config.ts

# Fast UI e2e tier (shim) across all browsers
test-e2e:
    npx playwright test --grep @fast

# Chromium CDP virtual-authenticator fidelity lane
test-e2e-cdp:
    npx playwright test --project=chromium-cdp
```

- [ ] **Step 2: Update `.gitignore`**

Append to `.gitignore`:
```
# e2e
/test-results/
/playwright-report/
/blob-report/
```

- [ ] **Step 3: Write `tests/README.md`**

`tests/README.md`:
```markdown
# Tests

Three tiers:

- **Unit (TestAuthenticator):** `just test-support` — Vitest, Node, validates
  the passkey shim crypto against the SDK parsers.
- **Fast UI e2e (`@fast`):** `just test-e2e` — Playwright on
  chromium/firefox/webkit using the in-page shim. No chain. Requires a built
  frontend (`just build-astro`).
- **Chromium CDP fidelity lane:** `just test-e2e-cdp` — real virtual
  authenticator; `*.cdp.spec.ts`.

The shim (`tests/support/auth/`) overrides `navigator.credentials` with a
deterministic P-256 vault keyed by credentialId. See
`docs/superpowers/specs/2026-06-02-cross-browser-passkey-test-harness-design.md`.

Testnet e2e, dapp/SEP-7, multi-actor recovery, and BrowserStack are added in
later phases.
```

- [ ] **Step 4: Full verification run**

Run:
```bash
just build-astro
just test-support
just test-e2e
just test-e2e-cdp
```
Expected: unit tests pass; UI tier green on all three engines; CDP lane green.

- [ ] **Step 5: Commit**

```bash
git add justfile .gitignore tests/README.md
git commit -m "chore(test): just recipes, gitignore, tests README"
```

---

## Self-Review

**Spec coverage (Phase 1 portions of the design):**
- Cross-browser shim (Approach A), idempotent, defines `window.PublicKeyCredential` → Tasks 1–6, 9 (guard + PKC shim in `shim.ts`).
- `create()` provides `getPublicKey()` SPKI **and** attestation CBOR fallback → Tasks 2, 3, 5.
- `get()` reuses `buildSyntheticAssertion`, dispatches by credentialId → Tasks 4, 5, 6.
- Deterministic identities → Task 1 (label→credentialId→key); account-address determinism follows since salt=sha256(credentialId).
- CDP Chromium fidelity lane → Tasks 8 (project), 11.
- Three tiers / project matrix / `webServer` / `*.localhost` → Tasks 7, 8, 12.
- DOM-marker install check (real-iOS-ready) → Task 6 (`dataset.testAuthenticator`), asserted in Task 10.
- Stable IDs / no churn from reskin → Tasks 10–11 verify against this branch.
- Local-first, CI-ready (no workflow authored) → recipes/scripts only.

Deferred (other plans, by design): testnet tier + funded bank + retries/quarantine (Phase 2), dapp/SEP-7 + multi-actor (Phase 3), BrowserStack + Phase 0 iOS spike (Phase 0/4).

**Placeholder scan:** No TBD/TODO; every code/test step has complete code; commands have expected output. The only conditional is "adjust selector if IDs differ", with an exact grep to discover the real ID — not a placeholder.

**Type consistency:** `credentialIdForLabel`/`privateKeyForCredentialId`/`publicKeyFromPrivate` (Task 1) used identically in Tasks 2–5. `buildSpki` (Task 2), `buildAttestationObject` (Task 3), `makeAssertion` (Task 4), `makeCredential`/`makeAssertionCredential` (Task 5), `installTestAuthenticator`/`TestAuthConfig` (Task 6), `getInitScript` (Task 6) referenced consistently in fixtures (Task 9). `SEED`/`SEED_HEX` are distinct by design (test-local `SEED` bytes in unit tests; `SEED_HEX` string injected by the fixture); the fixture's `seedHex` matches `shim.ts`'s `TestAuthConfig.seedHex`. `E2E_PORT` consistent across server, config, specs.
