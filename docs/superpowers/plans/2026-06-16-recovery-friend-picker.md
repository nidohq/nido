# Recovery friend-picker + cross-device signing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a friend open one recovery link, pick who they are on the recovering-account page, get redirected to their own Nido subdomain to sign, submit their signature to a relay, and have already-signed friends greyed out — replacing the copy/paste blob collection.

**Architecture:** A new dumb capability-gated Cloudflare Worker + KV (`recovery-relay`) stores `FriendSignature` blobs keyed by a random `relayKey` carried in a v4 handoff. The recover page gains a picker (recovering-account subdomain) and a confirmation (friend subdomain); the friend `PUT`s their signature, the originator polls + validates with the existing `addFriendSignature`.

**Tech Stack:** TypeScript, Astro frontend (vitest/jsdom), `@nidohq/passkey-sdk`, Cloudflare Workers + KV, `@stellar/stellar-sdk`.

**Worktree:** `/home/willem/c/s/g2c/.claude/worktrees/refractor-recovery-flow` (branch `feat/refractor-recovery-flow`, PR #100). All paths below are relative to it.

**Spec:** `docs/superpowers/specs/2026-06-16-recovery-friend-picker-design.md`

---

## File structure

| File | Created/Modified | Responsibility |
|------|------------------|----------------|
| `infra/recovery-relay/src/handler.ts` | Create | Pure `handleRelay(request, env)` — PUT/GET/health, capability-gated by `relayKey` |
| `infra/recovery-relay/src/index.ts` | Create | Worker entry: `export default { fetch }` → `handleRelay` |
| `infra/recovery-relay/test/handler.test.ts` | Create | Unit tests against an in-memory KV fake (no miniflare dep) |
| `infra/recovery-relay/wrangler.toml` | Create | Worker config + KV binding + route |
| `packages/frontend/src/lib/relayClient.ts` | Create | `putFriendSignature` / `listFriendSignatures` fetch wrappers |
| `packages/frontend/src/lib/relayClient.test.ts` | Create | Wrapper tests with mocked `fetch` |
| `packages/frontend/src/lib/friendPicker.ts` | Create | Pure `buildPickerRows(...)` — merges friends + names + signed set |
| `packages/frontend/src/lib/friendPicker.test.ts` | Create | Row-building + grey-out tests |
| `packages/passkey-sdk/src/friendSigning.ts` | Modify | Handoff `v3 → v4` (+ `relayKey`, `relayBaseUrl?`) |
| `packages/passkey-sdk/src/friendSigning.test.ts` | Modify/Create | v4 encode/decode round-trip; v3 rejected |
| `packages/frontend/src/lib/recoveryActions.ts` | Modify | Mint `relayKey`; relay submit on friend sign; relay poll on collect; drop paste |
| `packages/frontend/src/lib/recoveryActions.test.ts` | Modify | relay-collect + relayKey tests |
| `packages/frontend/src/pages/security/recover/index.astro` | Modify | Picker view, friend-confirm view, remove paste UI |
| `.github/workflows/deploy.yml` | Modify | Deploy the `recovery-relay` worker |

**Design choice (testability):** the Worker is a pure `handleRelay(request, env)` function tested with an in-memory `KVNamespace` fake — the repo has no `@cloudflare/vitest-pool-workers`/`miniflare`, and we will not add one. The Astro page wiring (DOM) is browser-verified; all real logic lives in unit-tested pure helpers (`friendPicker.ts`, `relayClient.ts`).

---

## Task 1: recovery-relay Worker (pure handler + KV fake)

**Files:**
- Create: `infra/recovery-relay/src/handler.ts`
- Create: `infra/recovery-relay/test/handler.test.ts`
- Create: `infra/recovery-relay/package.json`, `infra/recovery-relay/tsconfig.json`, `infra/recovery-relay/vitest.config.ts`

- [ ] **Step 1: Scaffold the package**

Create `infra/recovery-relay/package.json`:
```json
{
  "name": "recovery-relay",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "vitest": "^4.1.8",
    "typescript": "^5.6.0",
    "wrangler": "^4.86.0"
  }
}
```

Create `infra/recovery-relay/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "types": []
  },
  "include": ["src", "test"]
}
```

Create `infra/recovery-relay/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 2: Write the failing test**

Create `infra/recovery-relay/test/handler.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { handleRelay, type RelayEnv } from "../src/handler.js";

// Minimal in-memory KVNamespace fake (get/put/list/delete + TTL no-op).
function fakeKV() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix?: string } = {}) {
      const keys = [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
    _store: store,
  };
}

function env(): RelayEnv {
  return { RECOVERY_SIGS: fakeKV() as unknown as RelayEnv["RECOVERY_SIGS"] };
}

function req(method: string, url: string, body?: string) {
  return new Request(`https://relay.nido.fyi${url}`, { method, body });
}

describe("recovery-relay handler", () => {
  let e: RelayEnv;
  beforeEach(() => {
    e = env();
  });

  it("stores then lists a signature for a bucket", async () => {
    const put = await handleRelay(req("PUT", "/sig/CFRIEND?bucket=KEYABC", "blob1"), e);
    expect(put.status).toBe(204);

    const get = await handleRelay(req("GET", "/sig?bucket=KEYABC"), e);
    expect(get.status).toBe(200);
    const json = (await get.json()) as { signed: { friend: string; blob: string }[] };
    expect(json.signed).toEqual([{ friend: "CFRIEND", blob: "blob1" }]);
  });

  it("isolates buckets — one relayKey cannot read another's", async () => {
    await handleRelay(req("PUT", "/sig/CFRIEND?bucket=KEYA", "blobA"), e);
    const get = await handleRelay(req("GET", "/sig?bucket=KEYB"), e);
    const json = (await get.json()) as { signed: unknown[] };
    expect(json.signed).toEqual([]);
  });

  it("rejects a PUT with no bucket", async () => {
    const put = await handleRelay(req("PUT", "/sig/CFRIEND", "blob"), e);
    expect(put.status).toBe(400);
  });

  it("rejects an oversized blob", async () => {
    const big = "x".repeat(64 * 1024 + 1);
    const put = await handleRelay(req("PUT", "/sig/CFRIEND?bucket=KEYABC", big), e);
    expect(put.status).toBe(413);
  });

  it("answers health on /", async () => {
    const res = await handleRelay(req("GET", "/"), e);
    expect(res.status).toBe(200);
  });

  it("sets permissive CORS headers", async () => {
    const res = await handleRelay(req("GET", "/sig?bucket=KEYABC"), e);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd infra/recovery-relay && npm install && npx vitest run`
Expected: FAIL — `Cannot find module '../src/handler.js'`.

- [ ] **Step 4: Write the handler**

Create `infra/recovery-relay/src/handler.ts`:
```typescript
// Dumb, capability-gated blob store for recovery friend signatures.
// The `bucket` query param IS the capability (a random relayKey from the
// handoff). KV keys are `${bucket}:${friend}`. The worker never parses or
// validates the blob — all crypto validation stays in the originator's
// addFriendSignature at pull time and on-chain at submit.

export interface RelayEnv {
  RECOVERY_SIGS: KVNamespace;
}

const MAX_BLOB_BYTES = 64 * 1024;
// Default 24h; the originator could pass a tighter TTL, but the parent-auth
// window is the real bound and the originator submits well before then.
const TTL_SECONDS = 24 * 60 * 60;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: CORS });
}

function isValidBucket(b: string | null): b is string {
  return !!b && /^[A-Za-z0-9_-]{16,128}$/.test(b);
}

function isValidFriend(f: string): boolean {
  return /^[A-Z0-9]{56}$/.test(f); // strkey C-address length/charset
}

export async function handleRelay(request: Request, env: RelayEnv): Promise<Response> {
  if (request.method === "OPTIONS") return empty(204);

  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket");

  if (url.pathname === "/") return json({ service: "recovery-relay" });

  // PUT /sig/:friend?bucket=KEY
  const putMatch = url.pathname.match(/^\/sig\/([^/]+)$/);
  if (request.method === "PUT" && putMatch) {
    const friend = decodeURIComponent(putMatch[1]);
    if (!isValidBucket(bucket)) return json({ error: "bad bucket" }, 400);
    if (!isValidFriend(friend)) return json({ error: "bad friend" }, 400);
    const blob = await request.text();
    if (blob.length > MAX_BLOB_BYTES) return json({ error: "too large" }, 413);
    await env.RECOVERY_SIGS.put(`${bucket}:${friend}`, blob, {
      expirationTtl: TTL_SECONDS,
    });
    return empty(204);
  }

  // GET /sig?bucket=KEY
  if (request.method === "GET" && url.pathname === "/sig") {
    if (!isValidBucket(bucket)) return json({ error: "bad bucket" }, 400);
    const prefix = `${bucket}:`;
    const listed = await env.RECOVERY_SIGS.list({ prefix });
    const signed: { friend: string; blob: string }[] = [];
    for (const { name } of listed.keys) {
      const blob = await env.RECOVERY_SIGS.get(name);
      if (blob !== null) signed.push({ friend: name.slice(prefix.length), blob });
    }
    return json({ signed });
  }

  return json({ error: "not found" }, 404);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd infra/recovery-relay && npx vitest run`
Expected: PASS (6 tests). If `KVNamespace` type is unknown, add `npm i -D @cloudflare/workers-types` and `"types": ["@cloudflare/workers-types"]` in tsconfig.

- [ ] **Step 6: Write the Worker entry**

Create `infra/recovery-relay/src/index.ts`:
```typescript
import { handleRelay, type RelayEnv } from "./handler.js";

export default {
  fetch(request: Request, env: RelayEnv): Promise<Response> {
    return handleRelay(request, env);
  },
};
```

- [ ] **Step 7: Write wrangler config**

Create `infra/recovery-relay/wrangler.toml`:
```toml
name = "recovery-relay"
main = "src/index.ts"
compatibility_date = "2024-09-23"

routes = [
  { pattern = "relay.nido.fyi/*", zone_name = "nido.fyi" }
]

# KV namespace id is filled in during deploy wiring (Task 8).
[[kv_namespaces]]
binding = "RECOVERY_SIGS"
id = "REPLACE_WITH_KV_NAMESPACE_ID"
```

- [ ] **Step 8: Commit**

```bash
git add infra/recovery-relay
git commit -m "feat(recovery-relay): capability-gated KV blob store for friend signatures"
```

---

## Task 2: relayClient.ts (frontend fetch wrappers)

**Files:**
- Create: `packages/frontend/src/lib/relayClient.ts`
- Create: `packages/frontend/src/lib/relayClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/lib/relayClient.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { putFriendSignature, listFriendSignatures } from "./relayClient.js";

afterEach(() => vi.restoreAllMocks());

const BASE = "https://relay.nido.fyi";

describe("relayClient", () => {
  it("PUTs a blob to /sig/:friend?bucket=", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await putFriendSignature(BASE, "KEYABC", "CFRIEND", "theblob");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [u, init] = fetchMock.mock.calls[0];
    expect(u).toBe("https://relay.nido.fyi/sig/CFRIEND?bucket=KEYABC");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("theblob");
  });

  it("throws on a non-2xx PUT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 413 })));
    await expect(putFriendSignature(BASE, "KEYABC", "CFRIEND", "x")).rejects.toThrow();
  });

  it("lists signed friend blobs", async () => {
    const body = JSON.stringify({ signed: [{ friend: "CFRIEND", blob: "b1" }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const out = await listFriendSignatures(BASE, "KEYABC");
    expect(out).toEqual([{ friend: "CFRIEND", blob: "b1" }]);
  });

  it("returns [] when the bucket is empty", async () => {
    const body = JSON.stringify({ signed: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    expect(await listFriendSignatures(BASE, "KEYABC")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/relayClient.test.ts`
Expected: FAIL — `Cannot find module './relayClient.js'`.

- [ ] **Step 3: Write the client**

Create `packages/frontend/src/lib/relayClient.ts`:
```typescript
/**
 * Client for the recovery-relay worker (infra/recovery-relay). Stores and reads
 * friend-signature blobs keyed by a capability `relayKey`. The relay is dumb;
 * callers validate blobs themselves (addFriendSignature).
 */
export interface RelaySignature {
  friend: string;
  blob: string;
}

function base(u: string): string {
  return u.replace(/\/+$/, "");
}

export async function putFriendSignature(
  relayBaseUrl: string,
  relayKey: string,
  friend: string,
  blob: string,
): Promise<void> {
  const url = `${base(relayBaseUrl)}/sig/${encodeURIComponent(friend)}?bucket=${encodeURIComponent(relayKey)}`;
  const resp = await fetch(url, { method: "PUT", body: blob });
  if (!resp.ok) throw new Error(`Relay PUT failed: HTTP ${resp.status}`);
}

export async function listFriendSignatures(
  relayBaseUrl: string,
  relayKey: string,
): Promise<RelaySignature[]> {
  const url = `${base(relayBaseUrl)}/sig?bucket=${encodeURIComponent(relayKey)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`Relay GET failed: HTTP ${resp.status}`);
  const body = (await resp.json()) as { signed?: RelaySignature[] };
  return Array.isArray(body.signed) ? body.signed : [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/relayClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/relayClient.ts packages/frontend/src/lib/relayClient.test.ts
git commit -m "feat(frontend): relayClient for recovery friend-signature relay"
```

---

## Task 3: Handoff payload v3 → v4 (relayKey)

**Files:**
- Modify: `packages/passkey-sdk/src/friendSigning.ts:37-162`
- Create: `packages/passkey-sdk/src/friendSigning.test.ts` (add a describe block if the file exists)

- [ ] **Step 1: Write the failing test**

Append to (or create) `packages/passkey-sdk/src/friendSigning.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  encodeRotationHandoff,
  decodeRotationHandoff,
  type RotationHandoff,
} from './friendSigning.js';

const HASH = 'a'.repeat(64);

describe('RotationHandoff v4 (relayKey)', () => {
  const h: RotationHandoff = {
    version: 4,
    account: 'CACCOUNT',
    recoveryRuleId: 2,
    refractorTxHashes: [HASH],
    parentSignatureExpirationLedger: 123,
    relayKey: 'KEY_abc123-xyz',
    relayBaseUrl: 'https://relay.nido.fyi',
  };

  it('round-trips a v4 handoff including relayKey + relayBaseUrl', () => {
    expect(decodeRotationHandoff(encodeRotationHandoff(h))).toEqual(h);
  });

  it('rejects a stale v3 link', () => {
    // v3 wire: { v:3, a, r, tx, exp } with no relayKey
    const v3wire = btoa(JSON.stringify({ v: 3, a: 'C', r: 1, tx: [HASH], exp: 1 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeRotationHandoff(v3wire)).toThrow(/version/i);
  });

  it('rejects a v4 handoff missing relayKey', () => {
    const bad = { ...h } as Partial<RotationHandoff>;
    delete bad.relayKey;
    expect(() => encodeRotationHandoff(bad as RotationHandoff)).toThrow(/relayKey/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/passkey-sdk && npx vitest run src/friendSigning.test.ts`
Expected: FAIL — type error / `version 4` unsupported.

- [ ] **Step 3: Update the interfaces (friendSigning.ts:37-71)**

Replace the `RotationHandoff` interface `version: 3;` line and add two fields, and update the wire interface:
```typescript
export interface RotationHandoff {
  version: 4;
  /** The smart account being recovered. */
  account: string;
  /** The on-chain recovery rule id authorizing this rotation. */
  recoveryRuleId: number;
  refractorTxHashes: string[];
  parentSignatureExpirationLedger: number;
  /** Capability for the recovery-relay bucket holding friend signatures. */
  relayKey: string;
  /** Base URL of the recovery-relay worker. */
  relayBaseUrl: string;
}

interface RotationHandoffWire {
  v: 4;
  a: string;
  r: number;
  tx: string[];
  exp: number;
  /** relayKey */
  k: string;
  /** relay base url */
  u: string;
}
```
(Keep the existing doc comments on the unchanged fields.)

- [ ] **Step 4: Update encode (friendSigning.ts:106-127)**

```typescript
export function encodeRotationHandoff(h: RotationHandoff): string {
  if (h.version !== 4) {
    throw new Error(`encodeRotationHandoff: unsupported version ${String(h.version)}`);
  }
  if (h.refractorTxHashes.length === 0) {
    throw new Error('encodeRotationHandoff: handoff carries no transactions');
  }
  if (!h.refractorTxHashes.every((tx) => /^[a-f0-9]{64}$/i.test(tx))) {
    throw new Error('encodeRotationHandoff: malformed Refractor transaction hash');
  }
  if (!h.relayKey || !h.relayBaseUrl) {
    throw new Error('encodeRotationHandoff: missing relayKey or relayBaseUrl');
  }
  const wire: RotationHandoffWire = {
    v: 4,
    a: h.account,
    r: h.recoveryRuleId,
    tx: h.refractorTxHashes,
    exp: h.parentSignatureExpirationLedger,
    k: h.relayKey,
    u: h.relayBaseUrl,
  };
  return buf2base64url(new TextEncoder().encode(JSON.stringify(wire)));
}
```

- [ ] **Step 5: Update decode (friendSigning.ts:129-162)**

```typescript
export function decodeRotationHandoff(encoded: string): RotationHandoff {
  let json: string;
  try {
    json = new TextDecoder().decode(base64url2buf(encoded));
  } catch {
    throw new Error('decodeRotationHandoff: input is not valid base64url');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('decodeRotationHandoff: payload is not valid JSON');
  }
  const h = parsed as Partial<RotationHandoffWire>;
  if (h.v !== 4) {
    throw new Error(
      `decodeRotationHandoff: unsupported handoff version ${String(h.v)} (restart recovery)`,
    );
  }
  if (
    typeof h.a !== 'string' ||
    typeof h.r !== 'number' ||
    !Array.isArray(h.tx) ||
    h.tx.length === 0 ||
    !h.tx.every((tx) => typeof tx === 'string' && /^[a-f0-9]{64}$/i.test(tx)) ||
    typeof h.exp !== 'number' ||
    typeof h.k !== 'string' ||
    typeof h.u !== 'string'
  ) {
    throw new Error('decodeRotationHandoff: malformed handoff payload');
  }
  return {
    version: 4,
    account: h.a,
    recoveryRuleId: h.r,
    refractorTxHashes: h.tx,
    parentSignatureExpirationLedger: h.exp,
    relayKey: h.k,
    relayBaseUrl: h.u,
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/passkey-sdk && npx vitest run src/friendSigning.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — fix any v3 reference that no longer compiles (callers are updated in Task 4).

- [ ] **Step 7: Commit**

```bash
git add packages/passkey-sdk/src/friendSigning.ts packages/passkey-sdk/src/friendSigning.test.ts
git commit -m "feat(passkey-sdk): RotationHandoff v4 adds relayKey + relayBaseUrl"
```

---

## Task 4: prepareRotation mints relayKey

**Files:**
- Modify: `packages/frontend/src/lib/recoveryActions.ts` (handoff block ~550-556; add a `relayKey` to `RotationStaging` ~136-156; add a relay-base constant)
- Modify: `packages/frontend/src/lib/recoveryActions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/frontend/src/lib/recoveryActions.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { mintRelayKey } from './recoveryActions.js';

describe('mintRelayKey', () => {
  it('produces a 22+ char url-safe key', () => {
    const k = mintRelayKey();
    expect(k).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });
  it('is unique per call', () => {
    expect(mintRelayKey()).not.toBe(mintRelayKey());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/recoveryActions.test.ts -t mintRelayKey`
Expected: FAIL — `mintRelayKey` not exported.

- [ ] **Step 3: Add the relay constant + key minter + thread relayKey through**

Near the top of `recoveryActions.ts` (after the other module constants), add:
```typescript
import { putFriendSignature, listFriendSignatures } from './relayClient.js';

const RELAY_BASE_URL =
  (import.meta.env.PUBLIC_RECOVERY_RELAY_URL as string | undefined) ??
  'https://relay.nido.fyi';

/** Random url-safe capability for the recovery-relay bucket. */
export function mintRelayKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

In the `RotationStaging` interface (≈136-156) add:
```typescript
  /** Capability for the relay bucket holding this rotation's friend sigs. */
  relayKey: string;
```

In `prepareRotation`, before building `staging`, mint the key and include it in both the staging object and the v4 handoff. Replace the handoff block (≈550-556):
```typescript
  const relayKey = mintRelayKey();

  const handoff: RotationHandoff = {
    version: 4,
    account,
    recoveryRuleId,
    refractorTxHashes: txs.map((t) => t.refractorTxHash),
    parentSignatureExpirationLedger,
    relayKey,
    relayBaseUrl: RELAY_BASE_URL,
  };
```
And add `relayKey,` to the `const staging: RotationStaging = { ... }` object (≈537-547). Also add `relayKey` to `recoveryHandoffLinkFromStaging` (≈305-320) so a refresh rebuilds an identical v4 link — read `staging.relayKey` and `RELAY_BASE_URL` there.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/recoveryActions.test.ts -t mintRelayKey`
Expected: PASS. Then `npx tsc --noEmit` (fixes any `version: 3` leftovers).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/recoveryActions.ts packages/frontend/src/lib/recoveryActions.test.ts
git commit -m "feat(recovery): mint relayKey and embed it in the v4 handoff"
```

---

## Task 5: Friend submits to relay (replace paste-return)

**Files:**
- Modify: `packages/frontend/src/lib/recoveryActions.ts` — add `signRotationAsFriendToRelay`
- Modify: `packages/frontend/src/lib/recoveryActions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { vi, afterEach } from 'vitest';
import * as relay from './relayClient.js';
// NOTE: signRotationAsFriend itself needs a passkey + chain; test the relay
// hand-off wrapper by stubbing signRotationAsFriend's output shape.

afterEach(() => vi.restoreAllMocks());

describe('submitFriendSignatureToRelay', () => {
  it('PUTs the blob to the friend bucket', async () => {
    const put = vi.spyOn(relay, 'putFriendSignature').mockResolvedValue();
    const { submitFriendSignatureToRelay } = await import('./recoveryActions.js');
    await submitFriendSignatureToRelay(
      'https://relay.nido.fyi',
      'KEYABC',
      'CFRIEND',
      'theblob',
    );
    expect(put).toHaveBeenCalledWith('https://relay.nido.fyi', 'KEYABC', 'CFRIEND', 'theblob');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/recoveryActions.test.ts -t submitFriendSignatureToRelay`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the wrapper**

Add to `recoveryActions.ts`:
```typescript
/** Push a friend's signature blob to the relay (replaces paste-back). */
export async function submitFriendSignatureToRelay(
  relayBaseUrl: string,
  relayKey: string,
  friendAccount: string,
  blob: string,
): Promise<void> {
  await putFriendSignature(relayBaseUrl, relayKey, friendAccount, blob);
}
```
The friend page (Task 7) calls `signRotationAsFriend(...)` then `submitFriendSignatureToRelay(handoff.relayBaseUrl, handoff.relayKey, friendAccount, blob)`. `signRotationAsFriend` is unchanged (still returns `{ blob, description }`); `decodeRotationHandoff` now yields `relayKey` + `relayBaseUrl`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/recoveryActions.test.ts -t submitFriendSignatureToRelay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/recoveryActions.ts packages/frontend/src/lib/recoveryActions.test.ts
git commit -m "feat(recovery): submit friend signature to the relay"
```

---

## Task 6: Originator collects from relay

**Files:**
- Modify: `packages/frontend/src/lib/recoveryActions.ts` — add `collectFromRelay`
- Modify: `packages/frontend/src/lib/recoveryActions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('collectFromRelay', () => {
  it('feeds new relay blobs through addFriendSignature and skips known ones', async () => {
    const mod = await import('./recoveryActions.js');
    vi.spyOn(await import('./relayClient.js'), 'listFriendSignatures').mockResolvedValue([
      { friend: 'CFRIEND1', blob: 'b1' },
      { friend: 'CFRIEND2', blob: 'b2' },
    ]);
    const add = vi
      .spyOn(mod, 'addFriendSignature')
      .mockImplementation((_acct, _blob) => ({ collected: { CFRIEND1: {} } }) as never);

    const added = await mod.collectFromRelay('CACCT', 'https://relay.nido.fyi', 'KEY', new Set(['CFRIEND1']));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('CACCT', 'b2');
    expect(added).toContain('CFRIEND2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/recoveryActions.test.ts -t collectFromRelay`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `recoveryActions.ts`:
```typescript
/**
 * Pull signatures from the relay and record any not-yet-collected ones via the
 * existing validator. `known` is the set of friend accounts already in staging.
 * Returns the friend accounts newly added. Invalid blobs are skipped (logged).
 */
export async function collectFromRelay(
  account: string,
  relayBaseUrl: string,
  relayKey: string,
  known: Set<string>,
): Promise<string[]> {
  const all = await listFriendSignatures(relayBaseUrl, relayKey);
  const added: string[] = [];
  for (const { friend, blob } of all) {
    if (known.has(friend)) continue;
    try {
      addFriendSignature(account, blob);
      added.push(friend);
    } catch (e) {
      console.warn(`relay blob from ${friend} rejected:`, e);
    }
  }
  return added;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/recoveryActions.test.ts -t collectFromRelay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/recoveryActions.ts packages/frontend/src/lib/recoveryActions.test.ts
git commit -m "feat(recovery): collect friend signatures from the relay"
```

---

## Task 7: Picker rows helper + recover page wiring

**Files:**
- Create: `packages/frontend/src/lib/friendPicker.ts`
- Create: `packages/frontend/src/lib/friendPicker.test.ts`
- Modify: `packages/frontend/src/pages/security/recover/index.astro`

### 7a — Pure helper (unit-tested)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/lib/friendPicker.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildPickerRows } from './friendPicker.js';

describe('buildPickerRows', () => {
  const friends = ['CFRIEND1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'CFRIEND2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'];
  const names = new Map([[friends[0], 'alice']]);
  const signed = new Set([friends[1]]);

  it('labels by name, falls back to truncated address, and flags signed', () => {
    const rows = buildPickerRows(friends, names, signed);
    expect(rows[0]).toEqual({ address: friends[0], label: 'alice', signed: false });
    expect(rows[1]).toEqual({
      address: friends[1],
      label: 'CFRIEN…BBBB',
      signed: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/friendPicker.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/frontend/src/lib/friendPicker.ts`:
```typescript
export interface PickerRow {
  address: string;
  label: string;
  signed: boolean;
}

export function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Merge friend addresses with resolved names + the signed set into rows. */
export function buildPickerRows(
  friends: string[],
  names: Map<string, string>,
  signed: Set<string>,
): PickerRow[] {
  return friends.map((address) => ({
    address,
    label: names.get(address) ?? truncateAddress(address),
    signed: signed.has(address),
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/friendPicker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/friendPicker.ts packages/frontend/src/lib/friendPicker.test.ts
git commit -m "feat(recovery): buildPickerRows helper (names + grey-out)"
```

### 7b — Recover page wiring (browser-verified)

- [ ] **Step 6: Add picker + confirm DOM + remove paste**

In `index.astro`:
1. Add a `<section id="picker-mode" hidden>` with `<ul id="picker-list"></ul>` and `<p id="picker-progress" class="mut"></p>`, styled like the existing cards (mirror `#friend-mode`).
2. In the `#friend-mode` section, **remove** the `#fm-result`/`#fm-blob`/`#fm-copy` paste block (lines 44-51) and replace with a `<div id="fm-done" hidden>` confirmation ("Signed ✓ — you can close this").
3. In Step-4 (`#om-collect`), **remove** the `#om-paste` + `#om-add-sig` paste controls (lines 130-132); keep `#om-progress` and `#om-collected`, add a `<button id="om-refresh">Refresh</button>`.

- [ ] **Step 7: Wire the dispatch (replace the block at index.astro:174-185)**

```typescript
  const account = contractIdFromHostname(window.location.hostname);
  const params = new URLSearchParams(window.location.search);
  const handoffParam = params.get('handoff');

  if (handoffParam) {
    const { decodeRotationHandoff } = await import('@nidohq/passkey-sdk');
    let parsed;
    try {
      parsed = decodeRotationHandoff(handoffParam);
    } catch (e) {
      // stale/invalid link
      runFriendMode(handoffParam); // existing path surfaces the decode error
      return;
    }
    if (account === parsed.account) {
      runPickerMode(handoffParam, parsed); // on the recovering-account subdomain
    } else {
      runFriendMode(handoffParam);         // on a friend's own subdomain
    }
  } else {
    runOriginatorMode();
  }
```

- [ ] **Step 8: Implement `runPickerMode`**

```typescript
  async function runPickerMode(encoded: string, h: import('@nidohq/passkey-sdk').RotationHandoff) {
    document.getElementById('picker-mode')!.removeAttribute('hidden');
    const list = document.getElementById('picker-list')!;
    const progress = document.getElementById('picker-progress')!;

    const { findRecoveryRules } = await import('../../../lib/recoveryActions.js');
    const { buildPickerRows } = await import('../../../lib/friendPicker.js');
    const { listFriendSignatures } = await import('../../../lib/relayClient.js');
    const { lookupName } = await import('@nidohq/passkey-sdk');
    const { RPC_URL } = await import('../../../lib/network.js');
    const { nameRegistryId, NAME_NETWORK } = await import('../../../lib/nidoSwitcher.js');

    const rules = await findRecoveryRules(h.account);
    const rule = rules.find((r) => r.ruleId === h.recoveryRuleId) ?? rules[0];
    const friends = rule?.friends ?? [];
    const threshold = rule?.threshold ?? friends.length;

    // names (best-effort) + signed set (best-effort)
    const names = new Map<string, string>();
    await Promise.all(friends.map(async (addr) => {
      try {
        const n = await lookupName(RPC_URL, await nameRegistryId(), addr, NAME_NETWORK);
        if (n) names.set(addr, n);
      } catch { /* fallback to address */ }
    }));
    let signed = new Set<string>();
    try {
      signed = new Set((await listFriendSignatures(h.relayBaseUrl, h.relayKey)).map((s) => s.friend));
    } catch { /* relay down → show all ungreyed */ }

    const rows = buildPickerRows(friends, names, signed);
    list.innerHTML = '';
    for (const row of rows) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'btn soft';
      btn.textContent = row.signed ? `${row.label} ✓` : row.label;
      btn.disabled = row.signed;
      if (!row.signed) {
        btn.addEventListener('click', () => {
          window.location.assign(`//${row.address.toLowerCase()}.${baseHost()}/security/recover/?handoff=${encoded}`);
        });
      }
      li.appendChild(btn);
      list.appendChild(li);
    }
    progress.textContent = `${signed.size} of ${threshold} friends have signed.`;
  }
```
(`baseHost()` returns the apex, e.g. `nido.fyi`, derived from `window.location.hostname` by stripping the account label — reuse the existing helper the page uses to build account URLs; if none exists, add `function baseHost(){return window.location.hostname.split('.').slice(1).join('.');}`.)

- [ ] **Step 9: Friend-mode tail → submit to relay + confirm**

In `runFriendMode`, after `signRotationAsFriend(...)` returns `{ blob }`, replace the paste-display with:
```typescript
    const { submitFriendSignatureToRelay } = await import('../../../lib/recoveryActions.js');
    const h = decodeRotationHandoff(encoded);
    await submitFriendSignatureToRelay(h.relayBaseUrl, h.relayKey, account!, blob);
    document.getElementById('fm-sign')!.setAttribute('hidden', '');
    document.getElementById('fm-done')!.removeAttribute('hidden');
```

- [ ] **Step 10: Originator collect → poll relay**

In `runOriginatorMode` / `refreshProgress`, replace the paste handler. Wire `#om-refresh` (and a 10s interval while `#om-collect` is visible) to:
```typescript
    const staging = loadStaging(account!); // existing loader
    if (!staging) return;
    const known = new Set(Object.keys(staging.collected));
    await collectFromRelay(account!, RELAY_BASE_URL_OR_staging, staging.relayKey, known);
    refreshProgress(); // existing: recomputes collectedCount + #om-collected list + enables #om-submit
```
Use `staging.relayKey` and the same `RELAY_BASE_URL` constant from Task 4. Remove the `addFriendSignature(paste)` call bound to the deleted `#om-add-sig`.

- [ ] **Step 11: Verify the build + manual browser check**

Run: `cd packages/frontend && npx vitest run && npx astro build`
Expected: tests PASS, build completes.

Manual (preview): stage a rotation → open the link → confirm the **picker** lists friends by name, greys signed ones, and tapping one redirects to `//<friend>.nido.fyi/security/recover/?handoff=…` → friend signs → "Signed ✓" → reopen the picker shows them greyed → originator "Refresh" advances "N of threshold".

- [ ] **Step 12: Commit**

```bash
git add packages/frontend/src/pages/security/recover/index.astro
git commit -m "feat(recovery): friend-picker, redirect-to-own-nido, relay submit/poll (drop paste)"
```

---

## Task 8: Deploy wiring

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create the KV namespace (one-time, manual)**

Run (with a CF token that has Workers KV Storage:Edit):
```bash
cd infra/recovery-relay && npx wrangler kv namespace create RECOVERY_SIGS
```
Paste the returned `id` into `infra/recovery-relay/wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`), commit.

- [ ] **Step 2: Add the deploy step (after the nido worker step in deploy.yml)**

```yaml
      - name: Deploy recovery-relay worker
        run: npx wrangler deploy --config infra/recovery-relay/wrangler.toml
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
Token needs **Workers Scripts:Edit**, **Workers KV Storage:Edit**, and **Workers Routes:Edit** on `nido.fyi`.

- [ ] **Step 3: Point the frontend at the relay**

Set `PUBLIC_RECOVERY_RELAY_URL: https://relay.nido.fyi` in the `deploy.yml` / `preview.yml` build env (so `RELAY_BASE_URL` in Task 4 resolves at build time; the handoff also carries `relayBaseUrl` for preview hosts).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml infra/recovery-relay/wrangler.toml
git commit -m "ci: deploy recovery-relay worker + KV"
```

- [ ] **Step 5: Verify**

After merge to main: confirm the `Deploy recovery-relay worker` job is green, `curl https://relay.nido.fyi/` returns `{"service":"recovery-relay"}`, and a PUT+GET round-trips a test bucket.

---

## Self-review notes

- **Spec coverage:** relay worker (T1), relayClient (T2), handoff v4 (T3), mint relayKey (T4), friend submit (T5), originator collect (T6), picker + names + grey-out + redirect + confirm + drop paste (T7), deploy + KV (T8). All spec sections mapped.
- **Type consistency:** `relayKey`/`relayBaseUrl` names consistent across handoff (T3), staging+mint (T4), client (T2), picker (T7). `putFriendSignature`/`listFriendSignatures` signatures match between T2 and their callers in T5/T6/T7. `RotationHandoff.version` is `4` everywhere.
- **Known soft spots to confirm during execution:** `nameRegistryId`/`NAME_NETWORK` are imported from `nidoSwitcher.ts` (verify they are exported there; if not, lift them into `network.ts` and import from both); `loadStaging`/`refreshProgress` names in T7 step 10 are the page's existing originator-mode helpers — match their real names when wiring.
