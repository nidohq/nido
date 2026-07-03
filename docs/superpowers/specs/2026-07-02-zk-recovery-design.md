# ZK Account Recovery — Design Spec

**Date:** 2026-07-02
**Status:** Approved (implementation plan: M0–M4; M0 is a hard gate)
**Repos:** implementation in `nido`; ZK substrate reused from sibling `../zk` (`rs-soroban-ultrahonk`, `tornado_classic`, `soroban-zk-demo`)

## 1. Goal

Add ZK-proof account recovery to Nido smart accounts with two user-facing methods sharing one circuit, one pool, and one controller:

- **M1 "seed"** — the user holds a BIP-39 mnemonic on paper. Recovery proves knowledge of a secret derived from it. The secret never appears on-chain, at enrollment or recovery.
- **M2 "wallet"** — the user signs a fixed message with their Stellar wallet (Freighter et al., via Stellar Wallets Kit). The deterministic ed25519 signature (SEP-53) derives the secret. The wallet's public key never appears on-chain. No signature verification in-circuit (ed25519-in-circuit deferred).

Privacy goals (user-locked): hide the secret and wallet pubkey always; hide **which method** an account uses; hide **whether** an account has ZK recovery enrolled at all; hide cross-account wallet reuse. Hard limit acknowledged: a recovery names its target account publicly — registration→recovery linkage for the same account is unavoidable.

Security posture: timelocked recovery (initiate → cancel window → complete) with an in-account guard, so neither a stolen secret alone nor a stolen passkey alone wins quickly or silently.

## 2. Cryptographic protocol (normative)

Notation: `Fr` = BN254 scalar field, `r ≈ 2^253.5`. `P2_n(x1..xn)` = Poseidon2 hash, Aztec parameter set, exactly Noir stdlib `Poseidon2::hash([..], n)`; on-chain via `soroban_poseidon` over the `poseidon2_permutation` host function; in JS via `@zkpassport/poseidon2` (parity-gated, see §7.1). `split(b32)` = big-endian 16-byte halves of a 32-byte value as two <2^128 Fr limbs. `contract_id(A)` = raw 32-byte contract ID from `ScAddress::Contract` — never StrKey. `reduce384(okm48)` = 48 bytes as a 384-bit BE integer mod r (bias ≤ 2^-130).

Domain constants (`DOM_X = BE(sha256(label)) mod r`, hardcoded identically in circuit, contract, SDK):

| Constant | Label |
|---|---|
| `DOM_LEAF` | `nido/recovery/v1/leaf` |
| `DOM_BIND` | `nido/recovery/v1/bind` |
| `DOM_NULL` | `nido/recovery/v1/nullifier` |
| `DOM_AUTH` | `nido/recovery/v1/auth` |

Merkle interior nodes use raw 2-to-1 `P2_2(l, r)` with `zero[0] = 0`, `zero[i+1] = P2_2(zero[i], zero[i])` — unchanged from `tornado_classic` so the frontier code is reused. Leaves cannot collide with interior nodes because the stored leaf is a `DOM_BIND`-tagged hash.

### 2.1 Secret derivation (client-side only; nothing persisted, ever)

**M1 (seed):**
1. `seed64 = PBKDF2-HMAC-SHA512(NFKD(mnemonic), "mnemonic" || NFKD(passphrase), 2048, 64)` — standard BIP-39; passphrase supported, empty by default.
2. `okm = HKDF-SHA256(ikm = seed64, salt = UTF8(network_passphrase), info = UTF8("nido-recovery-v1:m1") || 0x00 || contract_id(account), L = 48)`
3. `secret = reduce384(okm)`

**M2 (wallet):** the message to sign (exact UTF-8 bytes, `\n` = 0x0A, no trailing newline):

```
nido-recovery-v1
account: <C-address StrKey, canonical uppercase>
network: <network passphrase verbatim>
purpose: derive this nido account's recovery secret
warning: only sign this inside the official nido enrollment or recovery flow
```

Requested via Stellar Wallets Kit `signMessage` (SEP-43). Conformant wallets implement SEP-53: `sig64 = ed25519_sign(sk, sha256("Stellar Signed Message:\n" || message))` — deterministic per RFC 8032. Then HKDF as in M1 with `info` tag `"nido-recovery-v1:m2"`.

The account **is** bound into the message: it limits a phished signature's blast radius to one named account, and costs no on-chain privacy (the wallet already learns the account from the per-account subdomain origin).

**Enrollment determinism check (store nothing):** (1) request the signature twice, byte-compare; (2) locally verify the signature against the G-address's ed25519 key under the exact SEP-53 preimage — this pins the enrollment to the SEP-53 *standard*, not to a wallet implementation, so any conformant wallet holding the key can recover; (3) on any failure, refuse M2 and steer to M1. Signature and secret are wiped after leaf computation. A non-deterministic or preimage-drifting wallet fails safe (recovery just doesn't find the leaf) but the credential would be silently dead — hence the hard enrollment gate.

### 2.2 Leaf format (two-layer wrap — security-critical)

```
inner  = P2_2(DOM_LEAF, secret)                    // client-side; dummy = uniform random Fr
stored = P2_4(DOM_BIND, acct_hi, acct_lo, inner)   // computed BY THE POOL at insert time
```

`stored` enters the tree; `(acct_hi, acct_lo) = split(contract_id(account))` where `account` is the account the insert is **authorized for** (factory-supplied at genesis, `account.require_auth()` for migration/re-enroll). The `LeafInserted{index, leaf}` event carries `stored`.

Why the on-chain wrap: a membership proof alone shows "some leaf binds account X and a secret I know". If account binding were client-computed, any party able to insert could insert a leaf binding a *victim* account to an attacker secret, then recover the victim. The wrap makes the tree contain only leaves whose account binding was enforced by insert authorization. This is what lets Nido safely allow post-genesis inserts where the SDF proposal foreclosed them.

**Dummy leaves:** client draws `inner ← uniform Fr` from the browser CSPRNG (rejection-sample < r) and submits through the identical call path. The pool **rejects** any `inner ≥ r` (no silent `rem_euclid` — a non-canonical value could never be a real Poseidon2 output and would mark the leaf fake). Never derive dummies from the env PRNG (re-derivable by tx replay). Real `inner` values are Poseidon2 outputs on ≥252-bit-entropy secrets — computationally indistinguishable from uniform; M1/M2/dummy are identically distributed in everything observable.

### 2.3 Nullifier

```
N = P2_4(DOM_NULL, acct_hi, acct_lo, secret)
```

Scope: per enrollment credential (per leaf), not per initiation.

| Event | Effect |
|---|---|
| `initiate_recovery` | N revealed as public input; must not be Reserved/Spent; becomes `Reserved(account)` in the pending record |
| `cancel_recovery` | pending cleared; reservation released — **a cancel never burns the enrollment** (anti-griefing) |
| `complete_recovery` | N → `Spent` permanently (leaves are forever in the append-only tree; the nullifier is what kills a used credential) |
| `burn_nullifier` (revoke) | account-authed **and** an `action=3` ZK proof of secret-knowledge: instantly spend a leaked secret's N without waiting out a self-recovery; then re-enroll visibly. The proof requirement is essential — N is public after any initiate, so account-auth alone would let a third party grief a victim's released N (closed in M1) |

Replay protection does **not** ride on N (recovery is not anonymous): the per-account monotonic `nonce` inside `auth_hash` plus one-pending-per-account prevent proof replay; controller rate limit (3 initiations / 90-day rolling window) bounds spam by a secret thief.

### 2.4 `auth_hash` and public inputs

Public inputs, exactly 3 Fr, in order: `[root, N, auth_hash]` — a 96-byte BE blob for `verify_proof(public_inputs, proof_bytes)` (tornado `parse_public_inputs` pattern, extended).

```
auth_hash = P2_15(
  DOM_AUTH,
  action,                    // 1=initiate, 2=cancel-proof, 3=revoke (reserved)
  acct_hi, acct_lo,          // split(contract_id(account))
  npass_hi, npass_lo,        // split(sha256(network_passphrase))
  ctrl_hi, ctrl_lo,          // split(contract_id(controller))
  pk_prefix,                 // 0x04 (0 for cancel)
  pk_x_hi, pk_x_lo,          // new P-256 pubkey X (0 for cancel)
  pk_y_hi, pk_y_lo,          // new P-256 pubkey Y (0 for cancel)
  nonce,                     // per-account monotonic u64
  timelock_secs              // u32 (0 for cancel)
)
```

The **controller is the canonicalization authority**: it recomputes `auth_hash` via the Poseidon2 host sponge from plaintext call args (decomposing the 65-byte pubkey itself) and compares with the proof's public input. A prover using non-canonical limbs produces a hash the controller never accepts — so the circuit carries **no** range/composition/on-curve checks on the auth components. This binds account, network, controller, new key, nonce, timelock — the full front-running/replay matrix. Cross-network replay is doubly dead (passphrase in both KDF salt and auth_hash).

No in-circuit on-curve check on the new P-256 key (deviation from SDF §3.4): malleability is closed by controller-side recomputation; a prover who could pass the proof could install a valid key anyway (bricking is dominated); the key comes from a fresh `navigator.credentials.create()` — authenticators mint valid P-256 points — and the client checks on-curve before proving. Keeps the circuit ECDSA-free.

### 2.5 Circuit

`circuits/zk_recovery/` (Noir). Tree depth **24** (16.7M leaves — every account burns one at creation, plus re-enrollments). Private inputs: `secret`, `acct_hi/lo`, `path_siblings[24]`, `path_bits[24]` (bit-constrained), and the auth-preimage components. Constraints:

1. `inner = P2_2(DOM_LEAF, secret)`; `stored = P2_4(DOM_BIND, acct_hi, acct_lo, inner)`
2. `compute_root(stored, path) == root` (tornado `compute_root`, `bit*(1-bit)==0`)
3. `P2_4(DOM_NULL, acct_hi, acct_lo, secret) == nullifier`
4. `P2_15(DOM_AUTH, ...) == auth_hash`

~34 Poseidon2 permutations + 24 bit constraints → small circuit (low-thousands of constraints; UltraHonk pads to 2^13–2^15 rows). Browser prove estimate 2–8 s desktop / under 30 s mobile single-threaded, memory well within iOS Safari limits. One circuit, one VK; the cancel proof is the same circuit with `action=2` (a membership proof strictly subsumes SDF's separate preimage mini-circuit — one VK to govern and audit).

CI asserts the compiled VK exposes exactly 3 public inputs. Soundness does not hinge on in-circuit public-input use: the contract compares every public input against values it computes itself (the `soroban-zk-demo` `assert(x==x)` flaw class is closed at the contract).

**Toolchain (frozen triple, recorded in `public/circuits/manifest.json`):** nargo `1.0.0-beta.18`, matching bb CLI, `@aztec/bb.js` 3.0-train + `@noir-lang/noir_js` beta.18, `--oracle_hash keccak`, `verifierTarget: 'evm-no-zk'`. (The SDF proposal's beta.9 / bb 0.87.0 pin is stale; `tornado_classic/circuit/scripts/gen_artifacts.sh` and `soroban-zk-demo/package.json` are the ground truth.) Measured artifacts: VK 1888 B, proof 6976 B, public_inputs 96 B (3×32).

### 2.6 M0 gate results (measured 2026-07-02)

The four load-bearing assumptions were validated before any product build-out (branch `zk-recovery-m0`; details in `docs/superpowers/plans/2026-07-02-zk-recovery-m0-gate.md` and the SDD reports):

- **Poseidon2 parity: NATIVE.** Noir `Poseidon2::hash([..], n)` matches the Soroban host `poseidon2_hash::<4, BnScalar>` directly at arities 2, 4, and 15 (all four domain-separated shapes). No chained-2to1 fallback — the circuit uses direct arity-4/15 hashing.
- **On-chain verify budget: PASS.** `verify_proof` for the real depth-24 circuit measures **159,058,972 CPU instructions** under real metering (no `reset_unlimited`). The authoritative per-transaction limit on the live network (testnet/mainnet, protocol 27) is `tx_max_instructions = 400,000,000` — NOT the 100M the original plan assumed. `verify_proof` runs inside `initiate_recovery` (completion carries no proof), so 159M leaves ~240M for the rest of that transaction. Gate recalibrated to ≤250M; passes with margin. The authoritative full-`initiate_recovery` cost must still be confirmed by a live testnet simulate in M1.
- **Zero-signer completion path: PASS.** An `AuthPayload { signers: {} (empty), context_rule_ids: [recovery_rule_id] }` authorizes a self-call through OZ `do_check_auth` (rev 637c53a) purely via the rule's Policy `enforce` — proven with positive (permit) and negative (deny → error) tests. With empty signers, OZ `authenticate()` never runs, so the pass is genuinely the policy path.
- **SEP-53 wallet derivation: PASS (synthetic).** The M2 preimage `sha256("Stellar Signed Message:\n" || message)` signs deterministically and verifies against the G-address. Live-wallet determinism across Freighter/xBull/Albedo/Lobstr/Rabet/Hana remains human-gated (`tests/spikes/wallet-determinism.md`).

## 3. On-chain architecture

| Contract | Status | Role |
|---|---|---|
| `contracts/zk-recovery` | NEW | Pool + controller merged: depth-24 Poseidon2 frontier, 128-slot historic-root ring, nullifier map, pending-recovery state machine, per-account nonce/cancel counters, **OZ `Policy` impl** (completion authority) |
| `contracts/zk-verifier` | NEW deploy | `UltraHonkVerifierContract` vendored from `rs-soroban-ultrahonk`, retargeted to soroban-sdk 26.0.1; our VK immutable in `__constructor` |
| `contracts/smart-account` | MODIFIED | Constructor takes `recovery_controller`; installs the recovery rule on every account; guard behavior in account code |
| `contracts/factory` | MODIFIED | `create_account_v2(salt, key, commitment)`; legacy path derives a deterministic dummy |

### 3.1 Completion authority (and why not `Signer::Delegated(controller)`)

Every account gets, at construction, a zero-signer rule:

```
ContextRule { context_type: CallContract(self), name: "zk-recovery",
              signers: [], policies: { zk_recovery_controller } }
```

Completion is a **permissionless direct invocation** of `account.add_context_rule(Default, "recovered", None, [Signer::External(webauthn_verifier, new_pubkey)], {})` carrying `AuthPayload { signers: {}, context_rule_ids: [recovery_rule_id] }`. OZ `do_check_auth` validates the zero-signer rule (rules need signers OR policies) and calls `controller.enforce`, which: requires `smart_account.require_auth()` (invoker auth — blocks third-party calls), checks the rule id matches the one recorded at `install`, checks a pending exists / `now ≥ executable_after` / `now < expires_at`, checks the context decodes to exactly the pending new-signer set, then **consumes**: N → Spent, pending deleted, `RecoveryCompleted` emitted.

The SDF proposal's `Signer::Delegated(controller)` + controller-orchestrated completion is rejected: controller→account→`__check_auth`→controller.enforce puts the controller on the stack twice (Soroban reentrancy ban), and `require_auth_for_args` semantics for a non-invoker contract inside a host-synthesized `__check_auth` frame are not verifiable from documentation. The M0 spike (§2.6) proved the zero-signer path works against the live OZ host.

> **M1 HARD REQUIREMENT (from the M0 spike):** OZ `get_validated_context_by_id` validates only the target `contract` of a `CallContract(self)` rule — it does **not** check `fn_name` or `args` (storage.rs:289-301). So the zero-signer recovery rule, as OZ sees it, authorizes *any* self-call. The controller's `enforce` MUST therefore itself inspect `context` and reject anything other than `add_context_rule` with exactly the pending new-signer set. Without this check the recovery rule is a universal self-call authorizer (e.g. an attacker who reaches `enforce` could drive `remove_signer`). This gating is the controller's responsibility, not OZ's.

A **new Default rule** is added rather than `add_signer` on the existing one: OZ requires all signers of a policy-less rule to authenticate, so adding a second signer to the existing Default rule would deadlock the new passkey. The SDK builds the follow-up self-authorized cleanup (remove old Default rule and the lost/stolen key). This mechanic uses only stock entry points, so it works unchanged on legacy accounts.

### 3.2 Guard (in account code, not a policy)

A guard implemented as a removable OZ Policy is self-defeating — `remove_policy`/`remove_context_rule` need only self-auth, so a passkey thief strips the guard first. Nido owns the smart-account wasm, so the guard is code:

- Removal of the recovery rule: **announce-then-execute** with a 7-day delay when no recovery is pending (allows opt-out and controller migration without a fleet-wide backdoor), hard-blocked while pending.
- While `controller.get_pending(self)` is `Some`: `remove_signer`, `remove_context_rule` (any), `remove_policy`, `update_context_rule_valid_until` panic.

Legacy accounts (deployed wasm, no upgrade fn) migrate in documented degraded mode: visible enrollment, completion works, no hard guard.

### 3.3 `zk-recovery` interface

```rust
// pool
insert(commitment: BytesN<32>) -> u32               // factory-only (invoker auth)
insert_for(account: Address, commitment: BytesN<32>) -> u32  // account.require_auth(); migration/re-enroll (visible)
current_root() -> BytesN<32>;  is_known_root(BytesN<32>) -> bool;  next_index() -> u32

// recovery state machine
initiate_recovery(account: Address, new_pubkey: BytesN<65>, nonce: u64,
                  timelock_secs: u32, root: BytesN<32>, nullifier: BytesN<32>,
                  proof: Bytes) -> u64   // permissionless; returns executable_after
cancel_recovery(account: Address, nonce: u64, root: BytesN<32>, nullifier: BytesN<32>, proof: Bytes)
                  // account.require_auth() (passkey) + fresh action=2 proof; cap 2/initiation; 24h cooldown
burn_nullifier(account: Address, nonce: u64, root: BytesN<32>, nullifier: BytesN<32>, proof: Bytes)
                  // account.require_auth() + fresh action=3 (revoke) proof of secret-knowledge; also clears a matching in-flight pending
get_pending(account: Address) -> Option<PendingRecovery>

// OZ Policy (completion authority): enforce / install / uninstall
```

`initiate_recovery` checks, in order: no live pending (stale pendings past `expires_at` are supersedable); root ∈ 128-slot ring; N not Reserved/Spent; `nonce == stored + 1` (then increments); `timelock_secs ≥ 7-day floor` and `== account's configured duration`; rate limit 3/90d; recompute `auth_hash` from canonical args; cross-call `zk-verifier.verify_proof([root, N, auth_hash], proof)`; reserve N; store `PendingRecovery { new_pubkey, nullifier, initiated_at, executable_after, expires_at }`; emit `RecoveryInitiated{account, sha256(new_pubkey), executable_after}`.

Events: `LeafInserted{index, leaf}`, `RecoveryInitiated`, `RecoveryCanceled{account, cancels_used}`, `RecoveryCompleted{account, nullifier}`, `NullifierBurned{account, nullifier}`. Wallets surface `RecoveryInitiated` as the cancel-or-lose alarm.

**Defaults (product sign-off pending):** delay 14 days (7-day controller floor, per-account configurable, bound in auth_hash), cancel cap 2 per initiation, 24 h cancel cooldown, completion window 30 days after maturity.

### 3.4 Storage & rent

Frontier (24×32 B) and root ring (128×32 B) each a single persistent `Vec`, `extend_ttl(max)` on every write (refreshed by every account creation). Nullifier and pending entries per-key persistent, max-TTL at write; archival is fail-closed (restore-before-read; a restored entry returns its Spent state — no double-spend via archival). No commitment-dedup map: duplicate `stored` leaves are harmless (same N ⇒ one spend), and a dedup entry archiving would DoS `create_account`.

### 3.5 Trust surface & deployment

The controller's `enforce` is a fleet-wide root of trust. Mitigations: no wasm-upgrade fn, no admin over recovery logic, verifier address and VK immutable; the timelock plus mandatory events are the detection/response window; deprecation = deploy a new (verifier, controller) pair, repoint the registry name for new accounts, opt-in migration for old ones. Publish `zk-recovery` / `zk-verifier` to the Stellar Registry; record addresses, VK sha256, circuit git rev, and the toolchain triple in `DEPLOYED.md`. The verifier crate is unaudited and third-party-derived — mainnet is gated on circuit + contract audits.

## 4. Client

### 4.1 SDK — `packages/passkey-sdk/src/zkRecovery/`

Not a policyBlock (enrollment is factory-time and deliberately chain-unreadable; `fromChain` cannot exist). Standalone namespace: `field.ts`, `poseidon.ts` (`@zkpassport/poseidon2`, vector-gated, bb.js fallback), `derivation.ts` (M1 via `@scure/bip39`, M2 sig-ikm; §2.1 exactly), `merkle.ts` (depth-24 incremental tree, zeros match contract), `authHash.ts`, `enrollment.ts` (`commitmentForCreation({leaf|'dummy'})`, `buildMigrationEnroll`), `recovery.ts` (initiate/cancel/complete `TxBuild`s via new `@nidohq/zk-recovery` bindings — every ScVal through the bindings' Spec; dual stellar-base instanceof hazard per `multisigRotation.ts:42-56`), `poolSync.ts` (pure verify/merge), `overlay.ts` (advisory local metadata only — the ceremony never needs it). New deps: `@noble/hashes`, `@scure/bip39`, `@zkpassport/poseidon2`. No bb.js in the SDK.

### 4.2 Proving — `packages/frontend/src/lib/zk/`

Module worker porting `soroban-zk-demo/src/services/NoirService.ts`: noir_js execute → `UltraHonkBackend.generateProof({verifierTarget:'evm-no-zk'})` → blob `u32-BE #pubs || pubs || proof`; SDK splits into `(public_inputs, proof)`. Artifacts in `public/circuits/` with sha256 manifest verification (poisoned-artifact guard). Single-threaded fallback — COOP/COEP not required. `just build-circuits` adapted from tornado `gen_artifacts.sh`; CI reproducibility diff against the manifest.

### 4.3 Pool sync

`infra/pool-indexer/` Cloudflare Worker (clone of `infra/recovery-relay` shape): cron `getEvents` → append-only leaf list; `GET /leaves?from=`, `GET /snapshot`. **Availability-only, never trust**: the client rebuilds the root from downloaded leaves and compares with on-chain `current_root`; mismatch = hard error + direct `getEvents` tail top-up. RPC event retention (~7 d) makes the indexer mandatory; periodic dumb JSON snapshots published for anyone to mirror.

### 4.4 Relayer

Reuse `infra/relayer` (channels plugin) with: host-function allowlist (`create_account*`, `insert_for`, `initiate_recovery`, `cancel_recovery`, completion invocations), pre-simulation drop of failing txs (garbage proofs cost the attacker a request, not the relayer a fee), per-IP rate limits. Genesis inserts ride the existing `create_account` relay path — byte-identical across real/dummy/method, which is what keeps enrollment invisible. Residual: relayer sees IP/timing (documented; Tor/VPN note in recovery UX).

### 4.5 UX (Astro islands, fixed element-id convention)

- **Creation** (`new-account/index.astro`): "Never get locked out" step — `#bk-seed` (12-word grid + 2-word confirm), `#bk-wallet` (kit connect + double-sign check), `#bk-skip` ("a placeholder keeps your choice private"). All three produce a commitment arg; identical tx shape. Seed enrollment ends with a recovery-card screen (C-address + label only; the words are a separate paper artifact).
- **Migration** (`/security`): card when no local overlay → visible authenticated insert, honest copy.
- **Recovery** (`/security/recover`, new `#zk-*` mode): fresh passkey (capture 65-byte pubkey NOW) → seed entry / wallet sign → pool sync + leaf locate → worker prove with progress → relayer-submitted initiate → timelock countdown with localStorage staging (no secrets staged; "don't clear site data" warning — the staged new-key pubkey is unrecoverable otherwise) → complete → guided cleanup (remove old rule/key).
- **Cancel**: pending-recovery probe on security/home pages → red banner "Someone started account recovery — if this wasn't you, stop it" → cancel with passkey + fresh cancel proof; remaining cancels shown.

## 5. Attack catalog (defenses in place)

1. **Malicious leaf insert** → on-chain `DOM_BIND` wrap under insert authority (§2.2).
2. **Front-running initiate/complete** → everything consequential inside `auth_hash`; replay executes the user's own intent; substitution breaks the recomputed hash.
3. **Grief-lock (stolen secret spams initiate)** → one pending per account, 3/90d rate limit, nonce-fresh proofs, events; cancels never burn the leaf.
4. **Cancel-loop (stolen passkey blocks recovery)** → cancel requires passkey **and** fresh secret proof; cap 2 per initiation; 24 h cooldown; after the cap the recovery completes. A passkey-only thief cannot cancel; a thief with both has won regardless (documented residual).
5. **Guard stripping** → guard is account code; recovery-rule removal is announce-then-execute (7 d) when idle, blocked when pending.
6. **Root staleness** → 128-root ring; client re-fetches the frontier just before proving.
7. **Dummy distinguishability** → client CSPRNG dummies, `inner ≥ r` rejected, identical flows; behavioral uniformity regression-tested.
8. **Nullifier grinding / pre-burning** → preimage resistance on ≥252-bit secrets; burn requires the account's passkey.
9. **VK/verifier compromise** → immutable VK + pinned verifier; new deployments + opt-in migration only.
10. **Relayer deanonymization** → uniform payload shapes; derivation completes before the request is built; documented residual (IP/timing).

## 6. Milestones

- **M0 (hard gate):** (a) circuit at depth 24 compiles, VK public inputs == 3; (b) vendored verifier builds + passes proof-fixture tests on soroban-sdk 26.0.1; (c) budget bench with our exact VK/proof: `verify_proof` ≤ 80 M CPU instructions, completion path < 10 M (currently UNPROVEN — substrate tests use `reset_unlimited()`); (d) Rust spike proving the zero-signer AuthPayload policy-completion path against OZ 637c53a; (e) wallet-determinism spike matrix. Failure of (c) or (d) → redesign decision before any build-out.
- **M1:** `contracts/zk-recovery` + `zk-verifier` + Rust integration tests with checked-in proof fixtures.
- **M2:** smart-account guard/constructor + factory v2 + migration + lifecycle tests.
- **M3:** SDK `zkRecovery/` + bindings + prover worker + pool indexer + relayer allowlist.
- **M4:** UX flows + Playwright lanes + testnet deploy + `DEPLOYED.md`.

## 7. Testing

1. **Cross-language vector suite first** (`tests/vectors/zk-recovery/`): Noir is the source of truth; consumed by vitest, Rust integration tests, Noir tests. Arities {2, 4, 15}; if any arity mismatches across stacks, recompose all protocol hashes from the proven 2-to-1.
2. **Rust integration** (`crates/integration-tests/tests/it/zk_recovery.rs`, extending the `multisig_recovery.rs` pattern) with checked-in bb proof fixtures (hash-pinned to the circuit manifest; circuit-change CI job regenerates): full lifecycle + differentials — wrong/unknown/stale root, reused nullifier, each public input tampered, premature complete, cancel cap + cooldown, guard blocks during pending, wrap-binding bypass, nonce replay, `inner ≥ r`, legacy-account completion.
3. **Vitest:** derivation vectors, proof-blob golden bytes, poolSync (gaps/dupes/reorder), staging.
4. **Playwright:** fast lane with stubbed prover + mocked pool (DOM states, staging resume, cancel banner); quarantined testnet lane with real browser proving (180 s budget).
5. **`just bench-zk`** as a required CI gate: localnet prove → verify → initiate; thresholds in `budget.json`.

## 8. Known risks

1. On-chain verification budget unproven → M0 gate, fail fast (fallback: recursive aggregation or descope).
2. Zero-signer policy completion unproven on the live host → M0 spike.
3. Poseidon2 multi-arity parity (Noir/Rust/JS) → vector suite first; 2-to-1 recomposition fallback.
4. M2 wallet preimage drift across wallet versions → SEP-53 pinning + enrollment triple-check + M1 fallback; vendor dependency documented.
5. Controller as fleet-wide trust root → immutability, timelock-as-detection-window, audits before mainnet.
6. Shared-fate pool (one VK, one tree) + behavioral side channels → documented residuals; enrollment-uniformity trace test.
7. Dependency skew (nido soroban-sdk 26.0.1 vs verifier's unreleased git pin vs soroban-poseidon) → vendor + retarget with proof-fixture tests at M0.
