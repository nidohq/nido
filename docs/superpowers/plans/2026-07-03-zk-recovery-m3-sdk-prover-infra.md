# ZK Recovery M3 — SDK + Prover + Indexer + Relayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client half of ZK account recovery — the `zkRecovery/` SDK module (field/poseidon/derivation/merkle/authHash/enrollment/recovery/poolSync/overlay), the browser prover worker, the pool-indexer Cloudflare Worker, and the relayer host-function allowlist — so a browser can derive a secret, locate its leaf, prove membership, and drive the M1/M2 on-chain state machine.

**Architecture:** SDK is pure TypeScript (ESM, no bb.js) that reproduces the contract's Poseidon2 field math exactly so client-computed public inputs match the on-chain recompute. Proving lives in a frontend module worker porting the proven `NoirService` flow. Pool sync is trust-free: an availability-only indexer serves append-only leaves; the client rebuilds the root and compares to on-chain `current_root`. The relayer gains a host-function allowlist so recovery txs ride the existing channels path.

**Tech Stack:** TypeScript ESM, vitest ^4.1.7, npm workspaces. New SDK deps: `@noble/hashes`, `@scure/bip39`, `@zkpassport/poseidon2` (`@noble/curves` already present). Prover deps (frontend only): `@noir-lang/noir_js` beta.18, `@aztec/bb.js` 3.0-train. Indexer: Cloudflare Worker (wrangler), `@stellar/stellar-sdk`. Relayer: OZ channels plugin (TypeScript).

## Global Constraints

- **Field `Fr` = BN254 scalar order r** = `0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001`. FIELD_ORDER_BE bytes must byte-match `contracts/zk-recovery/src/pool.rs:57-60`. Reject any client-supplied field element `>= r` (no silent reduce) where the contract does.
- **Domain constants** (`DOM_X = BE(sha256(label)) mod r`), identical to contract `hash.rs:23-26` and circuit `main.nr:6-9`:
  - `DOM_LEAF` = `0x10d2382af89f3c1732985422f0ba530d1dd0ed3066ecce5650b78f0c4ad8274a`
  - `DOM_BIND` = `0x14fa8513f19a07697a83cf582b40cb80bb2176f890614912553b81cdff71ec81`
  - `DOM_NULL` = `0x138891cc07f52d2ec29e835298ae2120acd9573ec4a83c573885abf9710b73b2`
  - `DOM_AUTH` = `0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906`
- **Poseidon2**: Aztec params via `@zkpassport/poseidon2` (must match noir-lang `poseidon` v0.2.0 used by the circuit). Arities used: 2, 4, 15. **Every arity is gated by `tests/vectors/zk-recovery/vectors.json`** — a test asserts the SDK output equals the vector output for `arity2_plain`, `arity2_dom_leaf`, `arity4_dom_bind`, `arity4_dom_null`, `arity15_dom_auth` before any dependent module is trusted.
- **Field encodings** (must match `contracts/zk-recovery/src/hash.rs`):
  - `split16(b32)`: two Fr limbs, each a 32-byte BE field with the source 16 bytes in the LOW 16 positions — `hi = 0x00…00 ‖ b32[0..16]`, `lo = 0x00…00 ‖ b32[16..32]`.
  - `u256_from_u64(n)`: BE into the low 8 bytes, top 24 zero. Used for `action`, `nonce`, `timelock_secs`, `pk_prefix`.
  - `p2(inputs)`: reduce EACH input `rem_euclid(r)` then Poseidon2 at the input's arity. (SDK inputs are already `< r`, so reduction is a no-op, but reject `>= r` on external inputs.)
- **Leaf/nullifier/auth_hash** (client-side):
  - `inner = P2_2(DOM_LEAF, secret)` — this is the commitment the SDK submits.
  - `N = P2_4(DOM_NULL, acct_hi, acct_lo, secret)` where `(acct_hi, acct_lo) = split16(contract_id_bytes(account))`.
  - Merkle interior: raw `P2_2(l, r)`; `zero[0] = 0`; `zero[i+1] = P2_2(zero[i], zero[i])`; DEPTH = 24.
  - `auth_hash = P2_15(DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo, ctrl_hi, ctrl_lo, pk_prefix, pk_x_hi, pk_x_lo, pk_y_hi, pk_y_lo, nonce, timelock_secs)`. `action`: 1=initiate, 2=cancel, 3=revoke. `pk_prefix = pubkey[0]` (0x04; 0 for cancel/revoke where no new key). `npass_hi/lo = split16(sha256(network_passphrase))`. pubkey65: `pk_x = pubkey[1..33]`, `pk_y = pubkey[33..65]`, each `split16`'d.
- **Public inputs** = exactly 3 Fr in order `[root, N, auth_hash]`, serialized as a 96-byte BE blob (3×32).
- **Proof blob** = `u32-BE(#pubs) ‖ pubs (32B each, BE) ‖ proof`. VK carried separately.
- **Secret derivation** (nothing persisted):
  - M1: `seed64 = BIP-39 PBKDF2` (`@scure/bip39`); `okm = HKDF-SHA256(ikm=seed64, salt=UTF8(networkPassphrase), info=UTF8("nido-recovery-v1:m1") ‖ 0x00 ‖ contractIdBytes(account), L=48)`; `secret = reduce384(okm)`.
  - M2: `sig64 = ed25519 over sha256("Stellar Signed Message:\n" ‖ message)` (SEP-53, produced by the wallet via kit `signMessage`); `okm = HKDF-SHA256(ikm=sig64, salt=UTF8(networkPassphrase), info=UTF8("nido-recovery-v1:m2") ‖ 0x00 ‖ contractIdBytes(account), L=48)`; `secret = reduce384(okm)`.
  - `reduce384(okm48)` = interpret 48 bytes as a 384-bit BE integer, mod r.
  - M2 message (exact UTF-8, `\n` line separators, NO trailing newline):
    ```
    nido-recovery-v1
    account: <C-address StrKey, canonical>
    network: <network passphrase verbatim>
    purpose: derive this nido account's recovery secret
    warning: only sign this inside the official nido enrollment or recovery flow
    ```
- **contractIdBytes(account)**: raw 32-byte contract ID (decode StrKey `C…`), never the StrKey string, when feeding field math.
- **Dual-stellar-base hazard** (`multisigRotation.ts:42-56`): every ScVal handed into a bindings op MUST be built through that bindings package's `Spec` (`client.spec.nativeToScVal(...)`), so it lives in the same stellar-base copy the bindings `instanceof`-check against. Never construct args from the bare `@stellar/stellar-sdk` specifier.
- **No secrets in localStorage.** Overlay staging may hold the new-passkey pubkey and non-secret recovery progress only.
- Package manager npm; SDK is ESM with `tsc` build; run tests with `vitest run`.

---

## File Structure

- `packages/passkey-sdk/src/zkRecovery/field.ts` — Fr type, `FIELD_ORDER`, `reduce384`, `split16`, `u256FromU64`, `bytesToField`/`fieldToBytes32`, canonical-range guard, DOM constants.
- `packages/passkey-sdk/src/zkRecovery/poseidon.ts` — `p2(inputs: Fr[]): Fr` over `@zkpassport/poseidon2` for arities {2,4,15}; arity dispatch.
- `packages/passkey-sdk/src/zkRecovery/derivation.ts` — `deriveSecretM1`, `deriveSecretM2`, `m2Message`.
- `packages/passkey-sdk/src/zkRecovery/merkle.ts` — `ZEROS[]`, `IncrementalTree` (depth 24), `computeRoot(leafIndex, siblings)`, `pathFor(leaves, index)`.
- `packages/passkey-sdk/src/zkRecovery/authHash.ts` — `computeAuthHash(params)`, `computeNullifier(account, secret)`, `wrapLeafInner(secret)`.
- `packages/passkey-sdk/src/zkRecovery/enrollment.ts` — `commitmentForCreation`, `dummyCommitment`, `buildMigrationEnroll`.
- `packages/passkey-sdk/src/zkRecovery/recovery.ts` — `buildInitiateRecovery`, `buildCancelRecovery`, `buildCompleteRecovery`, `buildBurnNullifier` (TxBuild objects).
- `packages/passkey-sdk/src/zkRecovery/poolSync.ts` — `mergeLeaves`, `rebuildRoot`, `verifyAgainstOnChainRoot`, `locateLeaf`.
- `packages/passkey-sdk/src/zkRecovery/overlay.ts` — advisory localStorage staging (namespaced, non-secret).
- `packages/passkey-sdk/src/zkRecovery/index.ts` — public surface.
- `packages/contract-bindings/zk-recovery/` — generated/hand-authored TS bindings package `@nidohq/zk-recovery`.
- `packages/frontend/src/lib/zk/prover.worker.ts` + `prover.ts` (client) + `manifest.ts` — prover worker + main-thread handle + artifact manifest check.
- `infra/pool-indexer/` — CF Worker (`src/index.ts`, `src/handler.ts`, `src/merkle.ts`, `wrangler.toml`, `vitest.config.ts`, tests).
- `infra/relayer/plugins/channels/allowlist.ts` (+ wire into `index.ts`) — host-function allowlist.
- `contracts/zk-recovery/tests/drift.rs` (or a `#[test]` in an existing module) — cross-crate constant drift guard.

---

## Task 1: SDK field + poseidon (parity-gated)

**Files:**
- Create: `packages/passkey-sdk/src/zkRecovery/field.ts`, `packages/passkey-sdk/src/zkRecovery/poseidon.ts`
- Test: `packages/passkey-sdk/src/zkRecovery/field.test.ts`, `packages/passkey-sdk/src/zkRecovery/poseidon.test.ts`
- Modify: `packages/passkey-sdk/package.json` (add deps `@noble/hashes`, `@zkpassport/poseidon2`)

**Interfaces:**
- Produces:
  - `type Fr = bigint` (canonical, `0 <= x < r`).
  - `const FIELD_ORDER: bigint`, `const FIELD_ORDER_BE: Uint8Array` (32).
  - `const DOM_LEAF/DOM_BIND/DOM_NULL/DOM_AUTH: Fr`.
  - `reduce384(okm48: Uint8Array): Fr`
  - `split16(b32: Uint8Array): [Fr, Fr]`
  - `u256FromU64(n: bigint | number): Fr`
  - `fieldToBytes32(x: Fr): Uint8Array` (BE), `bytesToFieldCanonical(b: Uint8Array): Fr` (throws if `>= r`).
  - `p2(inputs: Fr[]): Fr` — dispatches to `@zkpassport/poseidon2` for `inputs.length ∈ {2,4,15}`; throws on unsupported arity.

**Constraints:** DOM constants and FIELD_ORDER_BE must byte-match the contract (values in Global Constraints). `p2` must reproduce the contract `p2` (reduce each input, then Poseidon2 at that arity).

- [ ] **Step 1: Write failing parity test** — `poseidon.test.ts` loads `tests/vectors/zk-recovery/vectors.json`, iterates `poseidon2[]`, parses `inputs[]` hex → `Fr[]`, asserts `p2(inputs) === BigInt(vector.output)` for every case (`arity2_plain`, `arity2_dom_leaf`, `arity4_dom_bind`, `arity4_dom_null`, `arity15_dom_auth`). Also assert the 4 DOM constants in `field.ts` equal `vectors.domain_constants`.
- [ ] **Step 2: Run — expect FAIL** (`cd packages/passkey-sdk && npx vitest run src/zkRecovery/poseidon.test.ts`) — module not found.
- [ ] **Step 3: Add deps** — `npm i @noble/hashes @zkpassport/poseidon2 -w packages/passkey-sdk`. Confirm the poseidon2 package exposes an arity-generic hash (Aztec params). If its API differs from noir's, add a thin adapter and document the exact call in a comment.
- [ ] **Step 4: Implement `field.ts`** — constants, `reduce384` (`BigInt('0x'+hex) % r`), `split16`, `u256FromU64`, canonical guard, byte helpers.
- [ ] **Step 5: Implement `poseidon.ts`** — `p2` reducing inputs then hashing at arity; dispatch on length.
- [ ] **Step 6: Add `field.test.ts`** — `reduce384` of a known 48-byte vector, `split16` round-trip vs a known 32-byte value (assert `hi`/`lo` low-16 placement), `bytesToFieldCanonical` throws on `FIELD_ORDER_BE`.
- [ ] **Step 7: Run both — expect PASS.** If poseidon vectors mismatch, STOP and report (parity is the gate for all downstream work).
- [ ] **Step 8: Commit** — `feat(zk-sdk): field arithmetic + poseidon2 parity-gated against vectors`.

---

## Task 2: SDK derivation (M1 BIP-39 + M2 SEP-53)

**Files:**
- Create: `packages/passkey-sdk/src/zkRecovery/derivation.ts`, `derivation.test.ts`
- Modify: `packages/passkey-sdk/package.json` (add `@scure/bip39`)
- Reference: `tests/spikes/sep53-verify.mjs` (SEP-53 preimage logic), Global Constraints (message + HKDF params)

**Interfaces:**
- Consumes: `field.ts` (`reduce384`), `@noble/hashes` (`hkdf`, `sha256`), `@scure/bip39`.
- Produces:
  - `m2Message(account: string, networkPassphrase: string): string`
  - `deriveSecretM1(mnemonic: string, passphrase: string, account: string, networkPassphrase: string): Promise<Fr>`
  - `deriveSecretM2(sig64: Uint8Array, account: string, networkPassphrase: string): Fr`
  - internal `hkdfSecret(ikm: Uint8Array, methodTag: 'm1'|'m2', accountId32: Uint8Array, networkPassphrase: string): Fr` (HKDF-SHA256, L=48, info = `UTF8("nido-recovery-v1:"+tag) ‖ 0x00 ‖ accountId32`, salt = UTF8(networkPassphrase)) → `reduce384`.

**Constraints:** `contractIdBytes(account)` = raw 32 bytes decoded from the `C…` StrKey (use stellar-sdk `StrKey.decodeContract` or the SDK's existing address decoder — check `src/encoding.ts`/`src/resolve.ts`). M2 message must be byte-exact (Global Constraints). M2 does not sign here — it consumes the wallet-produced `sig64`.

- [ ] **Step 1: Write failing test** — `m2Message` equals the exact expected string for a fixed account+passphrase (assert no trailing newline, `\n` separators). `deriveSecretM1` for a fixed mnemonic/passphrase/account/network yields a deterministic `Fr` (compute the expected value once implemented and pin it; document it as an SDK-internal golden). `deriveSecretM2` for a fixed `sig64` yields a deterministic `Fr`. Cross-check: if `tests/spikes/sep53-verify.mjs` or `vectors.json` exposes a derivation vector, assert against it.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Add `@scure/bip39`**, implement `derivation.ts`.
- [ ] **Step 4: Run — expect PASS.** Pin the computed goldens into the test.
- [ ] **Step 5: Commit** — `feat(zk-sdk): M1 BIP-39 + M2 SEP-53 secret derivation`.

---

## Task 3: SDK merkle + authHash

**Files:**
- Create: `merkle.ts`, `merkle.test.ts`, `authHash.ts`, `authHash.test.ts`
- Reference: `contracts/zk-recovery/src/merkle.rs` (DEPTH, zero chain), `hash.rs::compute_auth_hash`, `vectors.json.circuit` (`path_siblings_zero_hash_chain`, `root`, `nullifier`, `auth_hash`)

**Interfaces:**
- Consumes: `field.ts`, `poseidon.ts`.
- Produces (`merkle.ts`):
  - `const DEPTH = 24`, `const ZEROS: Fr[]` (length 25, `ZEROS[24]` = empty-tree root).
  - `computeRoot(leaf: Fr, index: number, siblings: Fr[]): Fr`
  - `class IncrementalTree { insert(leaf: Fr): number; root(): Fr; pathFor(index: number): { siblings: Fr[]; bits: number[] } }`
- Produces (`authHash.ts`):
  - `wrapLeafInner(secret: Fr): Fr` (= `P2_2(DOM_LEAF, secret)`)
  - `computeNullifier(accountId32: Uint8Array, secret: Fr): Fr`
  - `computeAuthHash(p: { action: 1|2|3; accountId32: Uint8Array; networkPassphrase: string; controllerId32: Uint8Array; newPubkey65: Uint8Array | null; nonce: bigint; timelockSecs: number }): Fr`

**Constraints:** `ZEROS` must match `merkle.rs` (`zero[0]=0`, `zero[i+1]=P2_2(zero[i],zero[i])`). `computeRoot` bit order must match circuit membership. `computeAuthHash` field order EXACTLY per Global Constraints; for `action ∈ {2,3}` (no new key) set `pk_prefix=0, pk_x=pk_y=0`.

- [ ] **Step 1: Write failing merkle test** — `ZEROS` equals `vectors.json.circuit.path_siblings_zero_hash_chain` (24 entries → compare `ZEROS[0..24]`). Single-leaf witness: insert the vector's leaf at index 0, assert `root()` equals `vectors.circuit.root`; assert `computeRoot(leaf, 0, ZEROS[0..24])` equals same.
- [ ] **Step 2: Write failing authHash test** — using the `hash.rs` pinned fixture (NETWORK_PASSPHRASE="Test SDF Network ; September 2015", NONCE=1, TIMELOCK_SECS=1_209_600, ACTION=1, SECRET_HEX, NEW_PUBKEY_HEX): assert `computeNullifier` equals `NULLIFIER_HEX`, `computeAuthHash` equals `AUTH_HASH_HEX`, `wrapLeafInner`→wrap gives `LEAF_STORED_HEX` when bound (`P2_4(DOM_BIND, acct_hi, acct_lo, inner)`). Also assert against `vectors.circuit.nullifier`/`auth_hash`.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement `merkle.ts` then `authHash.ts`.**
- [ ] **Step 5: Run — expect PASS.** Mismatch on auth_hash ordering is a hard stop (it must match the on-chain recompute).
- [ ] **Step 6: Commit** — `feat(zk-sdk): depth-24 merkle + auth_hash/nullifier (contract parity)`.

---

## Task 4: SDK enrollment + leaf wrap

**Files:**
- Create: `enrollment.ts`, `enrollment.test.ts`
- Reference: `contracts/factory` (dummy = `sha256("nido-zk-dummy"||salt) mod r`), pool insert semantics.

**Interfaces:**
- Consumes: `field.ts`, `authHash.ts` (`wrapLeafInner`), `derivation.ts`.
- Produces:
  - `commitmentForCreation(secret: Fr): Uint8Array` — 32-byte BE of `wrapLeafInner(secret)` (the `inner`; pool wraps with DOM_BIND on-chain). Reject if `>= r`.
  - `dummyCommitment(saltBytes: Uint8Array): Uint8Array` — `sha256("nido-zk-dummy" ‖ salt) mod r`, matching factory legacy path.
  - `buildMigrationEnroll(account, secret): { commitment: Uint8Array }` — the `inner` for `insert_for`.

**Constraints:** SDK submits `inner` only; never computes the DOM_BIND wrap for submission (that is on-chain). A test must assert the wrap is NOT applied to the submitted commitment. `dummyCommitment` must byte-match the factory formula so a skipped-enrollment client and the factory agree.

- [ ] **Step 1: Failing test** — `commitmentForCreation(secret)` equals `fieldToBytes32(P2_2(DOM_LEAF, secret))` (NOT the DOM_BIND-wrapped value); `dummyCommitment(salt)` equals `sha256("nido-zk-dummy"||salt) mod r` for a fixed salt (compute expected).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(zk-sdk): enrollment commitments (inner leaf + canonical dummy)`.

---

## Task 5: `@nidohq/zk-recovery` contract bindings

**Files:**
- Create: `packages/contract-bindings/zk-recovery/` (package.json, tsconfig, `src/index.ts`)
- Reference: existing `packages/contract-bindings/smart-account/` layout; `contracts/zk-recovery` wasm at `target/wasm32v1-none/release/zk_recovery.wasm` (build if absent via `just build-contracts`).

**Interfaces:**
- Produces: `@nidohq/zk-recovery` exporting a `Client` with `spec` and methods `insert`, `insert_for`, `initiate_recovery`, `cancel_recovery`, `burn_nullifier`, `current_root`, `is_known_root`, `next_index`, `get_pending` — matching §3.3 signatures.

**Constraints:** Prefer generating with `stellar contract bindings typescript --wasm <path> --output-dir …` (CLI 26.0.0 present). Match the package.json shape of sibling bindings (`@nidohq/*`, ESM, `@stellar/stellar-sdk` peer). If generation can't run (no built wasm and build infeasible), STOP with BLOCKED — do not hand-fake a Spec that could drift from the contract.

- [ ] **Step 1:** Ensure `zk_recovery.wasm` exists (`just build-contracts` or targeted cargo build to `wasm32v1-none`).
- [ ] **Step 2:** Generate bindings into `packages/contract-bindings/zk-recovery/`. Align package.json name/exports with `smart-account` bindings.
- [ ] **Step 3:** Add to workspace; `npm install`; `npm run build -w packages/contract-bindings/zk-recovery` (or `tsc`) succeeds.
- [ ] **Step 4:** Smoke test — instantiate `Client({contractId: <dummy C-addr>, networkPassphrase, rpcUrl})` and assert `spec.getFunc('initiate_recovery')` exists with the expected input names.
- [ ] **Step 5: Commit** — `feat(bindings): @nidohq/zk-recovery TypeScript bindings`.

---

## Task 6: SDK recovery tx builders

**Files:**
- Create: `recovery.ts`, `recovery.test.ts`
- Reference: `policyBlocks/multisigRotation.ts` (dual-SDK hazard + `extractXdrOperations`/`assembledTx.ts`), `src/types.ts` (`TxBuild`), spec §3.1 completion shape.

**Interfaces:**
- Consumes: `@nidohq/zk-recovery` (Task 5), `@nidohq/smart-account` bindings, `assembledTx.ts` (`extractXdrOperations`).
- Produces (each returns a `TxBuild`-shaped object with the built op(s) + any `contextRuleIds`):
  - `buildInitiateRecovery({ controllerId, account, newPubkey65, nonce, timelockSecs, root, nullifier, proof }): TxBuild`
  - `buildCancelRecovery({ controllerId, account, nonce, root, nullifier, proof }): TxBuild`
  - `buildBurnNullifier({ controllerId, account, nonce, root, nullifier, proof }): TxBuild`
  - `buildCompleteRecovery({ account, recoveryRuleId, newPubkey65, webauthnVerifierId }): TxBuild` — a direct `smart_account.add_context_rule(Default, "recovered", None, [Signer::External(webauthn_verifier, new_pubkey)], {})` carrying `AuthPayload{signers:{}, context_rule_ids:[recoveryRuleId]}`.

**Constraints:** DUAL-STELLAR-BASE HAZARD — build every ScVal through the relevant bindings' `spec.nativeToScVal(...)`, never the bare specifier (Global Constraints). Completion is a zero-signer add_context_rule (matches the proven M1 spike shape); reproduce it exactly.

- [ ] **Step 1: Failing test** — for fixed inputs, `buildInitiateRecovery` produces one invoke op whose function name is `initiate_recovery` and whose decoded args round-trip to the given values (decode via the bindings spec). `buildCompleteRecovery` produces an `add_context_rule` op with fn name `recovered`, `context_rule_ids=[recoveryRuleId]`, zero signers. Assert ScVals are from the bindings' stellar-base copy (constructing via bare specifier is not used).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement builders through bindings Spec + `extractXdrOperations`.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(zk-sdk): initiate/cancel/burn/complete recovery tx builders`.

---

## Task 7: SDK poolSync + overlay + index exports

**Files:**
- Create: `poolSync.ts`, `poolSync.test.ts`, `overlay.ts`, `overlay.test.ts`, `index.ts`
- Modify: `packages/passkey-sdk/src/index.ts` (re-export `zkRecovery`)

**Interfaces:**
- Consumes: `merkle.ts`, `field.ts`.
- Produces (`poolSync.ts`):
  - `mergeLeaves(known: Leaf[], incoming: Leaf[]): Leaf[]` (`Leaf = { index: number; commitment: Uint8Array }`) — dedup by index, reject conflicting commitment at same index, require contiguous from 0.
  - `rebuildRoot(leaves: Leaf[]): Fr` (feeds `IncrementalTree`).
  - `verifyAgainstOnChainRoot(leaves: Leaf[], onChainRoot: Fr): boolean`.
  - `locateLeaf(leaves: Leaf[], myCommitment: Uint8Array): { index: number; siblings: Fr[]; bits: number[] } | null` (myCommitment = the DOM_BIND-wrapped stored value; caller wraps).
- Produces (`overlay.ts`): namespaced advisory storage `stageRecovery(account, { newPubkey65Hex, initiatedAt, executableAfter })` / `readStaged` / `clearStaged` — NO secrets, guarded to be a no-op without `localStorage`.

**Constraints:** trust-free — `verifyAgainstOnChainRoot` is the only authority; the indexer is never trusted. Handle gaps (non-contiguous → throw), duplicates (identical → dedup; conflicting → throw), reorder (sort by index).

- [ ] **Step 1: Failing tests** — merge: contiguous merge, duplicate-identical dedup, conflicting-index throw, gap throw, reordered input sorted. rebuildRoot on the single-leaf vector equals `vectors.circuit.root`. overlay round-trips without leaking secrets; no-op when storage absent.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(zk-sdk): trust-free pool sync + advisory overlay + public exports`.

---

## Task 8: Prover worker module

**Files:**
- Create: `packages/frontend/src/lib/zk/prover.worker.ts`, `prover.ts`, `manifest.ts`, `blob.ts`, `blob.test.ts`
- Modify: `packages/frontend/package.json` (add `@noir-lang/noir_js`, `@aztec/bb.js`)
- Reference: `/home/willem/c/s/zk/soroban-zk-demo/src/services/NoirService.ts` (proving flow + blob layout), circuit artifacts in `circuits/zk_recovery/target/`.

**Interfaces:**
- Produces:
  - `buildProofBlob(publicInputs: Uint8Array[], proof: Uint8Array): Uint8Array` (`blob.ts`) — `u32-BE(#pubs) ‖ pubs(32B) ‖ proof`.
  - `manifestCheck(fetchedSha: string, expectedSha: string): void` (`manifest.ts`) — throws on mismatch.
  - worker message contract (`prover.worker.ts`): in `{ circuitName, inputs }` → out `{ blobHex, publicInputsHex[], proofId }`; ports the NoirService flow (`Noir.execute` → `UltraHonkBackend.generateProof({verifierTarget:'evm-no-zk'})`).
  - `prove(inputs): Promise<{ blob: Uint8Array; proofId: string }>` (`prover.ts`) — main-thread handle spawning the module worker, single-threaded fallback when Worker unavailable.

**Constraints:** Live in-browser proving is NOT unit-tested here (deferred to M4) — but `blob.ts` MUST be unit-tested against the committed `circuits/zk_recovery/target/{public_inputs,proof}` fixture: build the blob from those bytes and assert length = `4 + 96 + 6976` and that slicing recovers the fixture parts. Artifacts under `packages/frontend/public/circuits/` + a `manifest.json` (sha256 of `.json`/`vk`) pinning the toolchain triple (nargo 1.0.0-beta.18, bb.js 3.0-train). Do NOT require COOP/COEP (single-threaded fallback).

- [ ] **Step 1: Failing blob test** — read the two fixture files, `buildProofBlob([...96B split into 3×32], proof)`; assert total length `4+96+6976=7076`, header decodes to `3`, tail equals proof bytes, middle equals public_inputs bytes.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `blob.ts` + `manifest.ts`.** Run blob test — PASS.
- [ ] **Step 4: Implement `prover.worker.ts` + `prover.ts`** porting NoirService (imports guarded so the module type-checks without a browser). Add deps. Copy artifacts to `public/circuits/` + write `manifest.json`. `tsc`/build of frontend succeeds (no execution of proving in CI).
- [ ] **Step 5: Commit** — `feat(frontend): browser prover worker + proof-blob (fixture-tested)`.

---

## Task 9: pool-indexer Cloudflare Worker

**Files:**
- Create: `infra/pool-indexer/{package.json, wrangler.toml, tsconfig.json, vitest.config.ts, src/index.ts, src/handler.ts, src/merkle.ts, test/handler.test.ts}`
- Reference: `infra/recovery-relay/` (worker shape, KV, routes, CORS), zk-recovery events (`LeafInserted{index, commitment}`).

**Interfaces:**
- Produces:
  - fetch handler routes: `GET /` → `{service:"pool-indexer"}`; `GET /leaves?from=N` → `{ leaves: [{index, commitment}] }` (from cursor); `GET /snapshot` → `{ root, nextIndex, leaves }`.
  - a scheduled (cron) handler that calls Soroban RPC `getEvents` for the pool contract's `LeafInserted` topic, appends new leaves to storage (KV or D1) idempotently by index.
  - `src/merkle.ts` — a minimal depth-24 root rebuild (mirrors SDK `merkle.ts`) to publish `root` in `/snapshot`.

**Constraints:** availability-only/trust-free — the client re-verifies; the indexer never signs anything. Append-only, idempotent by index (a re-scan must not duplicate). Config the pool contract id + RPC via `wrangler.toml` vars. `getEvents` retention is ~7d, so the cron cadence and cursor persistence must not lose leaves.

- [ ] **Step 1: Failing tests** — `handler.test.ts` (vitest, mocked storage): posting/seeding leaves 0..2 then `GET /leaves?from=1` returns indices 1..2; idempotent append (same index twice → one entry); `GET /snapshot` returns a `root` matching the SDK/`vectors.circuit.root` for the single-leaf case; malformed cursor → 400.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement handler + merge + merkle + cron skeleton** (the `getEvents` call can be a thin, injectable client so tests mock it).
- [ ] **Step 4: Run — PASS.** `wrangler` typecheck/dry build if available; otherwise `tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(infra): trust-free pool-indexer worker (leaves + snapshot)`.

---

## Task 10: Relayer channels host-function allowlist

**Files:**
- Create: `infra/relayer/plugins/channels/allowlist.ts`, `infra/relayer/plugins/channels/allowlist.test.ts`
- Modify: `infra/relayer/plugins/channels/index.ts` (wrap/wire the allowlist), `infra/relayer/plugins/channels/package.json` (add vitest if needed)
- Reference: existing `index.ts` (`export { handler } from '@openzeppelin/relayer-plugin-channels'`), relayer submit payload (`{ func, auth }` base64 XDR).

**Interfaces:**
- Produces:
  - `ALLOWED_FUNCTIONS: Set<string>` = `{ create_account, create_account_v2, insert_for, initiate_recovery, cancel_recovery, burn_nullifier, add_context_rule }` (add_context_rule only for the completion shape).
  - `isAllowed(hostFunctionXdrBase64: string): boolean` — decode the invoke host function, extract the invoked contract fn name, return membership.
  - `assertAllowedOrReject(payload): void` — pre-simulation gate throwing on disallowed fn.

**Constraints:** allowlist is the security boundary — decode the actual HostFunction (don't trust a client-declared name). Pre-simulation drop of failing proofs stays a documented follow-up if simulation isn't reachable in the plugin; the allowlist + per-IP rate limit are the M3 deliverable. Rate limit: reuse any existing limiter in the plugin config; if none, add a simple per-IP token bucket with a documented default (e.g. 5 / 90d for initiate is enforced ON-CHAIN — the relayer limit is a coarse anti-spam, document the number chosen).

- [ ] **Step 1: Failing test** — `isAllowed` true for an `initiate_recovery` invoke XDR, false for an arbitrary `transfer` invoke XDR (build both with stellar-sdk in the test). `assertAllowedOrReject` throws on the disallowed one.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement allowlist; wire into `index.ts` so the exported handler gates before submit.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(relayer): host-function allowlist for recovery + genesis txs`.

---

## Task 11: Cross-crate constant drift guard (M2 residual)

**Files:**
- Create: `contracts/zk-recovery/tests/drift.rs` (or add `#[cfg(test)]` asserts where the consts live)
- Reference: `pool.rs` `FIELD_ORDER_BE`, `smart-account`/`factory` copies of `FIELD_ORDER_BE` + `ZkRecoveryInstallParams`; SDK `field.ts` DOM constants + `merkle.ts` DEPTH.

**Interfaces:**
- Produces: a compiled test that fails if any hand-copied constant drifts.

**Constraints:** This closes the deferred M2 residual (FIELD_ORDER_BE + ZkRecoveryInstallParams duplicated across crates). Assert the byte arrays are equal across crates and that DEPTH=24 and the 4 DOM constants match their canonical definition. Where crates can't depend on each other (the `#[contract]` wasm-export collision), copy the canonical bytes into the test and assert each crate's const equals them (the test itself becomes the single source the CI guards).

- [ ] **Step 1: Failing/《guard》test** — assert `factory::FIELD_ORDER_BE == pool::FIELD_ORDER_BE == <canonical 32 bytes>`; assert the `ZkRecoveryInstallParams` field layout/encoding matches (encode a fixed instance in each crate, compare bytes). Assert `merkle::DEPTH == 24`.
- [ ] **Step 2: Run — expect PASS now** (consts currently agree); then mutate one locally to confirm the test FAILS (falsification), revert.
- [ ] **Step 3: Commit** — `test(zk): cross-crate constant drift guard (closes M2 residual)`.

---

## Self-Review notes (author)

- Spec coverage: §4.1 SDK (T1–T7), §4.2 prover (T8), §4.3 indexer (T9), §4.4 relayer (T10) — covered. M4 owns UX + live browser proving + testnet e2e; T8 tests only the blob layout, not live proof gen (documented).
- The load-bearing parity gates (poseidon vectors T1, auth_hash/nullifier T3, merkle root T3/T7) all assert against committed vectors or the `hash.rs` fixture — a drift here fails CI before any tx is built.
- Known verification limit (state in PR): live in-browser proving, real-wallet SEP-53 signing, and the wallet-determinism matrix are M4 — M3 lands the code + unit/parity tests only.
