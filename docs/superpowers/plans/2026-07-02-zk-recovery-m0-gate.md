# ZK Account Recovery — M0 Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the four load-bearing feasibility assumptions of the ZK recovery design before any product build-out: (1) the depth-24 recovery circuit compiles and exposes exactly 3 public inputs; (2) the vendored UltraHonk verifier builds and verifies our proof on `soroban-sdk 26.0.1`; (3) on-chain `verify_proof` fits the ≤80M CPU-instruction budget; (4) the zero-signer `AuthPayload` policy-completion path works against OZ rev `637c53a`. Plus a wallet-determinism spike matrix for M2.

**Architecture:** A new Noir circuit (`circuits/zk_recovery/`) reuses the `tornado_classic` Merkle/nullifier substrate, extended to depth 24 with a two-layer account-bound leaf, a per-account nullifier, and a 15-input `auth_hash`. The `rs-soroban-ultrahonk` verifier crate is vendored into the nido workspace and retargeted from its pinned soroban-sdk git rev to `26.0.1`. A budget harness (`crates/zk-bench/`) measures real CPU instructions. A spike test in `crates/integration-tests` proves the completion auth path.

**Tech Stack:** Noir (nargo `1.0.0-beta.18`), Barretenberg (`bb`, matched to beta.18; `@aztec/bb.js` 3.0-train), soroban-sdk 26.0.1, OZ stellar-accounts rev 637c53a, `soroban-poseidon` (git main), Rust, `just`.

## Global Constraints

- **Toolchain triple (frozen):** nargo `1.0.0-beta.18`; `bb` CLI installed by `bbup -nv 1.0.0-beta.18`; `@aztec/bb.js` `^3.0.0-nightly.20260102` + `@noir-lang/noir_js` `^1.0.0-beta.18`. Ground truth: `../zk/rs-soroban-ultrahonk/tornado_classic/circuit/scripts/gen_artifacts.sh`. The SDF proposal's beta.9/bb 0.87.0 is stale — do NOT use it.
- **bb invocations:** `bb write_vk --verifier_target evm-no-zk` and `bb prove --verifier_target evm-no-zk`. Circuit proofs consumed on-chain must be keccak-oracle (`--oracle_hash keccak` is the evm-no-zk default in this bb train).
- **soroban-sdk:** `26.0.1` (workspace pin, `../nido/Cargo.toml:15`). Any vendored crate MUST build against it, not a git rev.
- **stellar-accounts:** git rev `637c53a8c4928fd0c71d330bd866f482c3454578` (workspace pin).
- **Field:** BN254 Fr, `r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.
- **Poseidon2:** Aztec params. Noir stdlib `Poseidon2::hash([..], n)`; on-chain `soroban_poseidon::poseidon2_hash::<4, BnScalar>`; parity is arity-2-proven only (tornado) — arities 4 and 15 MUST be vector-checked (Task 2).
- **Domain constants** (`DOM_X = BE(sha256("nido/recovery/v1/<x>")) mod r`, precomputed, hardcode identically in circuit + contract + SDK):
  - `DOM_LEAF = 0x10d2382af89f3c1732985422f0ba530d1dd0ed3066ecce5650b78f0c4ad8274a`
  - `DOM_BIND = 0x14fa8513f19a07697a83cf582b40cb80bb2176f890614912553b81cdff71ec81`
  - `DOM_NULL = 0x138891cc07f52d2ec29e835298ae2120acd9573ec4a83c573885abf9710b73b2`
  - `DOM_AUTH = 0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906`
- **Tree depth:** 24. Zero-hash chain: `zero[0]=0`, `zero[i+1]=P2_2(zero[i],zero[i])` (matches `mixer.rs:62-72`).
- **Public inputs:** exactly `[root, nullifier, auth_hash]`, 96-byte BE concat.
- **Budget gate:** `verify_proof` ≤ 80,000,000 CPU insns; completion path < 10,000,000. Measured with real metering, NOT `reset_unlimited()`.
- **Spec:** `docs/superpowers/specs/2026-07-02-zk-recovery-design.md`.

---

## File Structure

**New (this milestone):**
- `circuits/zk_recovery/Nargo.toml` — Noir package manifest (poseidon dep `v0.2.0`).
- `circuits/zk_recovery/src/main.nr` — the recovery circuit.
- `circuits/zk_recovery/src/tests.nr` — in-circuit `nargo test` parity + witness tests.
- `circuits/zk_recovery/scripts/gen_artifacts.sh` — adapted from tornado; writes `target/{vk,proof,public_inputs,...}` + `manifest.json`.
- `contracts/vendor/ultrahonk-soroban-verifier/` — vendored verifier lib crate (from `../zk/rs-soroban-ultrahonk/ultrahonk-soroban-verifier/`), retargeted to sdk 26.0.1.
- `contracts/zk-verifier/` — thin Soroban contract wrapper (from `../zk/rs-soroban-ultrahonk/src/lib.rs`), VK-in-constructor.
- `crates/zk-bench/` — budget harness: registers the verifier wasm, submits our fixture proof, asserts CPU insns ≤ threshold.
- `tests/vectors/zk-recovery/vectors.json` — cross-language test vectors (Noir source of truth).
- `crates/integration-tests/tests/it/zk_completion_spike.rs` — zero-signer policy completion path spike.
- `crates/integration-tests/tests/it/zk_vectors.rs` — host-poseidon2 arity {2,4,15} + frontier parity vs vectors.json.
- `crates/integration-tests/fixtures/zk/` — checked-in `vk`, `proof`, `public_inputs` (~6KB).
- `tests/spikes/wallet-determinism.md` — M2 wallet spike matrix results.
- `docs/superpowers/plans/2026-07-02-zk-recovery-m1-m4-outline.md` — the downstream plan skeleton (written last).

**Modified:**
- `Cargo.toml` (workspace `members`: add `contracts/vendor/ultrahonk-soroban-verifier`, `contracts/zk-verifier`, `crates/zk-bench`).
- `justfile` (targets: `build-circuits`, `gen-zk-vectors`, `gen-zk-fixtures`, `bench-zk`).

---

### Task 1: Vendor and retarget the UltraHonk verifier crate onto soroban-sdk 26.0.1

**Files:**
- Create: `contracts/vendor/ultrahonk-soroban-verifier/` (copy of `../zk/rs-soroban-ultrahonk/ultrahonk-soroban-verifier/`)
- Create: `contracts/zk-verifier/Cargo.toml`, `contracts/zk-verifier/src/lib.rs`
- Modify: `Cargo.toml` (workspace members)

**Interfaces:**
- Produces: `zk_verifier` contract with `__constructor(vk: Bytes)` (immutable VK in instance storage) and `verify_proof(public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error>`. Mirrors `../zk/rs-soroban-ultrahonk/src/lib.rs`.
- Consumes: `soroban_poseidon` (git main), soroban-sdk 26.0.1, the vendored verifier lib.

- [ ] **Step 1: Copy the verifier lib and contract wrapper**

```bash
cd /home/willem/c/s/nido
mkdir -p contracts/vendor
cp -r ../zk/rs-soroban-ultrahonk/ultrahonk-soroban-verifier contracts/vendor/ultrahonk-soroban-verifier
mkdir -p contracts/zk-verifier/src
cp ../zk/rs-soroban-ultrahonk/src/lib.rs contracts/zk-verifier/src/lib.rs
```

- [ ] **Step 2: Retarget dependencies**

Edit `contracts/vendor/ultrahonk-soroban-verifier/Cargo.toml` and `contracts/zk-verifier/Cargo.toml`: replace any `soroban-sdk = { git = ..., rev = "3b031847..." }` with `soroban-sdk = { workspace = true }`; keep `soroban-poseidon = { git = "https://github.com/stellar/rs-soroban-poseidon", branch = "main" }`. Set `[lib] crate-type = ["cdylib", "rlib"]` on `zk-verifier`, `["rlib"]` on the vendored lib. Add both to `Cargo.toml` workspace `members`.

- [ ] **Step 3: Build for wasm and native**

Run: `cd /home/willem/c/s/nido && cargo build -p ultrahonk-soroban-verifier && just build-contracts 2>&1 | tail -20`
Expected: both compile against soroban-sdk 26.0.1. If `soroban-poseidon` pulls an incompatible soroban-sdk, pin its rev to one that uses 26.0.1 (record the rev in the crate's Cargo.toml comment). This is the dependency-skew risk resolving point — if it cannot reconcile, STOP and report (gate failure mode).

- [ ] **Step 4: Port the verifier's own proof-fixture test**

Copy `../zk/rs-soroban-ultrahonk/tests/integration_tests.rs` into `contracts/zk-verifier/tests/verifier_smoke.rs`, keeping only the `simple_circuit` verify-succeeds and tampered-input-rejects cases (drop budget/print). Keep `reset_unlimited()` here — this test proves the vendored math still verifies, not budget.

Run: `cargo test -p zk-verifier --test verifier_smoke 2>&1 | tail -20`
Expected: PASS (verifier verifies the upstream simple_circuit proof under sdk 26.0.1).

- [ ] **Step 5: Commit**

```bash
git add contracts/vendor contracts/zk-verifier Cargo.toml
git commit -m "feat(zk): vendor UltraHonk verifier retargeted to soroban-sdk 26.0.1"
```

---

### Task 2: Cross-language Poseidon2 arity parity (the keystone — do before the circuit)

**Files:**
- Create: `crates/integration-tests/tests/it/zk_vectors.rs`
- Create: `tests/vectors/zk-recovery/vectors.json` (hand-authored seed vectors this task fills in)

**Interfaces:**
- Produces: proven `p2(inputs: &[Fr]) -> Fr` semantics for arities 2, 4, 15 that agree between the Soroban host `poseidon2_hash::<4, BnScalar>` and (Task 3) Noir. Establishes the leaf/nullifier/auth_hash hashing contract.
- Consumes: `soroban_poseidon::{poseidon2_hash, Field}`, `soroban_sdk::crypto::BnScalar` (pattern: `../zk/rs-soroban-ultrahonk/tornado_classic/contracts/tests/mixer.rs:48-60`).

- [ ] **Step 1: Write a failing host-poseidon2 arity test**

```rust
// crates/integration-tests/tests/it/zk_vectors.rs
use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{crypto::BnScalar, Bytes, Env, U256, Vec as SVec};

fn p2(env: &Env, inputs: &[[u8;32]]) -> [u8;32] {
    let modulus = <BnScalar as Field>::modulus(env);
    let mut v = SVec::new(env);
    for x in inputs {
        v.push_back(U256::from_be_bytes(env, &Bytes::from_array(env, x)).rem_euclid(&modulus));
    }
    let out = poseidon2_hash::<4, BnScalar>(env, &v);
    let mut a = [0u8;32]; out.to_be_bytes().copy_into_slice(&mut a); a
}

#[test]
fn host_poseidon2_matches_noir_vectors() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let vectors = include_str!("../../../../tests/vectors/zk-recovery/vectors.json");
    let v: serde_json::Value = serde_json::from_str(vectors).unwrap();
    for tc in v["poseidon2"].as_array().unwrap() {
        let ins: Vec<[u8;32]> = tc["inputs"].as_array().unwrap().iter()
            .map(|h| hex32(h.as_str().unwrap())).collect();
        let want = hex32(tc["output"].as_str().unwrap());
        assert_eq!(p2(&env, &ins), want, "arity {}", ins.len());
    }
}
// hex32: parse 0x-prefixed 32-byte hex helper
```

- [ ] **Step 2: Run it, expect failure (no vectors yet)**

Run: `cargo test -p nido-integration-tests --test it host_poseidon2_matches_noir_vectors 2>&1 | tail`
Expected: FAIL (empty/missing `poseidon2` array or file).

- [ ] **Step 3: Generate authoritative vectors from Noir**

In `circuits/zk_recovery/` (created in Task 3, but the poseidon-only generator can run now with a throwaway `main.nr` that just prints `Poseidon2::hash` for fixed inputs at arities 2/4/15), run `nargo test --show-output` capturing outputs, and write them into `vectors.json` under `"poseidon2": [{inputs:[...],output:"0x.."}, ...]`. Include the four domain constants as arity-inputs so the exact leaf/null/auth sponge shapes are covered. If arity-4 or arity-15 host output ≠ Noir output, invoke the fallback: redefine all protocol hashes as chains of proven 2-to-1 `P2_2` and regenerate (record the decision in vectors.json `"hashing": "native"|"chained-2to1"`).

- [ ] **Step 4: Run to green**

Run: `cargo test -p nido-integration-tests --test it host_poseidon2_matches_noir_vectors 2>&1 | tail`
Expected: PASS for arities 2, 4, 15.

- [ ] **Step 5: Commit**

```bash
git add crates/integration-tests/tests/it/zk_vectors.rs tests/vectors/zk-recovery/vectors.json
git commit -m "test(zk): cross-language Poseidon2 arity parity (host vs Noir)"
```

---

### Task 3: The recovery circuit at depth 24

**Files:**
- Create: `circuits/zk_recovery/Nargo.toml`, `circuits/zk_recovery/src/main.nr`, `circuits/zk_recovery/src/tests.nr`
- Create: `circuits/zk_recovery/scripts/gen_artifacts.sh`
- Modify: `justfile` (add `build-circuits`)

**Interfaces:**
- Produces: a compiled ACIR + VK where public inputs are exactly `[root, nullifier, auth_hash]`. Witness semantics: `stored = P2_4(DOM_BIND, acct_hi, acct_lo, P2_2(DOM_LEAF, secret))`, membership to `root`, `nullifier = P2_4(DOM_NULL, acct_hi, acct_lo, secret)`, `auth_hash = P2_15(DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo, ctrl_hi, ctrl_lo, pk_prefix, pk_x_hi, pk_x_lo, pk_y_hi, pk_y_lo, nonce, timelock_secs)`.
- Consumes: `poseidon` Noir dep `v0.2.0` (pattern: `../zk/rs-soroban-ultrahonk/tornado_classic/circuit/`), the domain constants (Global Constraints), the parity decision from Task 2.

- [ ] **Step 1: Write `Nargo.toml` and the circuit**

```toml
# circuits/zk_recovery/Nargo.toml
[package]
name = "zk_recovery"
type = "bin"
compiler_version = ">=1.0.0"
[dependencies]
poseidon = { tag = "v0.2.0", git = "https://github.com/noir-lang/poseidon" }
```

```rust
// circuits/zk_recovery/src/main.nr
use dep::poseidon::poseidon2::Poseidon2;

global DEPTH: u32 = 24;
global DOM_LEAF: Field = 0x10d2382af89f3c1732985422f0ba530d1dd0ed3066ecce5650b78f0c4ad8274a;
global DOM_BIND: Field = 0x14fa8513f19a07697a83cf582b40cb80bb2176f890614912553b81cdff71ec81;
global DOM_NULL: Field = 0x138891cc07f52d2ec29e835298ae2120acd9573ec4a83c573885abf9710b73b2;
global DOM_AUTH: Field = 0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906;

fn hash2(a: Field, b: Field) -> Field { Poseidon2::hash([a, b], 2) }

fn compute_root(leaf: Field, sib: [Field; DEPTH], bits: [Field; DEPTH]) -> Field {
    let mut cur = leaf;
    for i in 0..DEPTH {
        assert(bits[i] * (1 - bits[i]) == 0);
        cur = if bits[i] == 0 { hash2(cur, sib[i]) } else { hash2(sib[i], cur) };
    }
    cur
}

pub fn main(
    root: pub Field,
    nullifier: pub Field,
    auth_hash: pub Field,
    secret: Field,
    acct_hi: Field, acct_lo: Field,
    path_siblings: [Field; DEPTH],
    path_bits: [Field; DEPTH],
    action: Field,
    npass_hi: Field, npass_lo: Field,
    ctrl_hi: Field, ctrl_lo: Field,
    pk_prefix: Field, pk_x_hi: Field, pk_x_lo: Field, pk_y_hi: Field, pk_y_lo: Field,
    nonce: Field, timelock_secs: Field,
) {
    let inner  = Poseidon2::hash([DOM_LEAF, secret], 2);
    let stored = Poseidon2::hash([DOM_BIND, acct_hi, acct_lo, inner], 4);
    assert(compute_root(stored, path_siblings, path_bits) == root);
    assert(Poseidon2::hash([DOM_NULL, acct_hi, acct_lo, secret], 4) == nullifier);
    assert(Poseidon2::hash(
        [DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo, ctrl_hi, ctrl_lo,
         pk_prefix, pk_x_hi, pk_x_lo, pk_y_hi, pk_y_lo, nonce, timelock_secs], 15) == auth_hash);
}
```

(If Task 2 chose `chained-2to1`, replace the arity-4/15 `Poseidon2::hash` calls with the agreed 2-to-1 chain.)

- [ ] **Step 2: Compile and assert public-input count == 3**

Run:
```bash
cd /home/willem/c/s/nido/circuits/zk_recovery
~/.nargo/bin/nargo compile
python3 -c "import json; abi=json.load(open('target/zk_recovery.json'))['abi']; n=sum(1 for p in abi['parameters'] if p['visibility']=='public'); print('public inputs:', n); assert n==3, n"
```
Expected: `public inputs: 3`. (Nargo lifts `pub` params into the ABI; exactly the three declared.)

- [ ] **Step 3: In-circuit witness test proving a known leaf**

Write `src/tests.nr` with a `#[test]` that constructs a depth-24 path for a single-leaf tree (siblings = zero-hash chain, bits all 0), fixed `secret`/`acct`, and asserts `main` succeeds; plus a negative test asserting a wrong `root` fails. Emit the same `secret/acct/root/nullifier/auth_hash` values to stdout so Task 4 and `vectors.json` reuse them.

Run: `~/.nargo/bin/nargo test --show-output 2>&1 | tail`
Expected: PASS; captured field values recorded into `vectors.json` under `"circuit"`.

- [ ] **Step 4: Add `gen_artifacts.sh` and `just build-circuits`**

Adapt `../zk/rs-soroban-ultrahonk/tornado_classic/circuit/scripts/gen_artifacts.sh` (same nargo/bb version guards, `write_vk`/`prove --verifier_target evm-no-zk`), pointed at this package, additionally writing `public/circuits/manifest.json` `{circuitSha256, vkSha256, nargo, bb, builtAt}`. Add to `justfile`:
```
build-circuits:
    bash circuits/zk_recovery/scripts/gen_artifacts.sh
```

Run: `cd /home/willem/c/s/nido && just build-circuits 2>&1 | tail -20`
Expected: writes `circuits/zk_recovery/target/{vk,proof,public_inputs}` and a manifest; `bb` version matches beta.18.

- [ ] **Step 5: Commit**

```bash
git add circuits/zk_recovery justfile tests/vectors/zk-recovery/vectors.json
git commit -m "feat(zk): depth-24 recovery circuit + artifact generation"
```

---

### Task 4: Real proof fixtures + budget harness (the 80M gate)

**Files:**
- Create: `crates/zk-bench/Cargo.toml`, `crates/zk-bench/tests/budget.rs`
- Create: `crates/integration-tests/fixtures/zk/{vk,proof,public_inputs}`
- Modify: `Cargo.toml` (members), `justfile` (`gen-zk-fixtures`, `bench-zk`)

**Interfaces:**
- Consumes: `zk_verifier` wasm (Task 1), the artifacts from `just build-circuits` (Task 3).
- Produces: a red/green assertion that `verify_proof(our_public_inputs, our_proof)` costs ≤ 80M CPU insns under real metering.

- [ ] **Step 1: Stage fixtures from the real circuit build**

```bash
cd /home/willem/c/s/nido
mkdir -p crates/integration-tests/fixtures/zk
cp circuits/zk_recovery/target/vk crates/integration-tests/fixtures/zk/vk
cp circuits/zk_recovery/target/proof crates/integration-tests/fixtures/zk/proof
cp circuits/zk_recovery/target/public_inputs crates/integration-tests/fixtures/zk/public_inputs
```
Add `just gen-zk-fixtures` that reruns `build-circuits` then this copy, and records fixture sha256 into the manifest.

- [ ] **Step 2: Write the budget test (real metering, NOT reset_unlimited)**

```rust
// crates/zk-bench/tests/budget.rs
use soroban_sdk::{Bytes, Env};
mod v { soroban_sdk::contractimport!(
    file = "../../target/wasm32v1-none/release/zk_verifier.wasm"); }

const MAX_VERIFY_CPU: u64 = 80_000_000;

#[test]
fn verify_proof_within_budget() {
    let env = Env::default();
    let vk    = Bytes::from_slice(&env, include_bytes!("../../integration-tests/fixtures/zk/vk"));
    let proof = Bytes::from_slice(&env, include_bytes!("../../integration-tests/fixtures/zk/proof"));
    let pubs  = Bytes::from_slice(&env, include_bytes!("../../integration-tests/fixtures/zk/public_inputs"));
    let id = env.register(v::WASM, (vk,));
    let client = v::Client::new(&env, &id);
    // budget starts at default (metered) limits — no reset_unlimited
    client.verify_proof(&pubs, &proof);
    let cpu = env.cost_estimate().resources().cpu_instructions;
    println!("verify_proof cpu_instructions = {cpu}");
    assert!(cpu <= MAX_VERIFY_CPU, "verify_proof {cpu} > gate {MAX_VERIFY_CPU}");
}
```
(Confirm the exact field name via `soroban-sdk-26.0.1/src/testutils/cost_estimate.rs::resources() -> InvocationResources`; adjust `cpu_instructions` accessor if the struct exposes a method.)

- [ ] **Step 3: Build verifier wasm, run the gate**

Run: `cd /home/willem/c/s/nido && just build-contracts && cargo test -p zk-bench --test budget -- --nocapture 2>&1 | tail`
Expected: prints the real CPU count and PASSES (≤ 80M). **If it FAILS the gate, STOP** — this is the project-gating outcome; report the number, do not proceed to M1. Fallback options to record: recursive proof aggregation, or descope.

- [ ] **Step 4: Wire `just bench-zk`**

```
bench-zk:
    cargo test -p zk-bench --test budget -- --nocapture
```

- [ ] **Step 5: Commit**

```bash
git add crates/zk-bench crates/integration-tests/fixtures/zk Cargo.toml justfile
git commit -m "test(zk): real-metering verify_proof budget gate (<=80M CPU)"
```

---

### Task 5: Zero-signer AuthPayload policy-completion spike

**Files:**
- Create: `crates/integration-tests/tests/it/zk_completion_spike.rs`

**Interfaces:**
- Consumes: `deploy_smart_account` (`crates/integration-tests/src/lib.rs:135`), `do_check_auth`, `AuthPayload`, `ContextRuleType`, `Signer`, a stub policy contract implementing OZ `Policy` (mirror `contracts/multisig-policy/src/contract.rs`).
- Produces: proof that an `AuthPayload { signers: {} (empty), context_rule_ids: [recovery_rule_id] }` authorizes an `add_context_rule` call on a smart account when the referenced rule has zero signers and one policy whose `enforce` permits — the completion mechanism of the design.

- [ ] **Step 1: Write a stub always-permit policy + failing spike test**

Define, in the test file, a `#[contract] SpikePolicy` implementing OZ `Policy`: `enforce` requires `smart_account.require_auth()` and otherwise returns (permit); `install` records nothing; `uninstall` no-op. Then a test that: deploys a smart account with a Default rule (one webauthn signer) plus a `CallContract(self)` rule with `signers: []` and `policies: {spike_policy}`; builds `AuthPayload { signers: Map::new(), context_rule_ids: vec![recovery_rule_id] }`; constructs the `Context::Contract` for `add_context_rule`; calls `do_check_auth(&env, &digest, &payload, &vec![context])`.

```rust
// core assertion
let res = do_check_auth(&env, &auth_digest, &empty_signer_payload, &vec![&env, context]);
assert!(res.is_ok(), "zero-signer policy rule must authorize via enforce");
```

- [ ] **Step 2: Run, expect failure first**

Run: `cargo test -p nido-integration-tests --test it zero_signer_policy_completion 2>&1 | tail -20`
Expected: FAIL initially (compile error or an OZ rejection) — iterate on the exact `AuthPayload`/context shape until it reflects reality. The POINT of this task is to discover the true shape; a red-then-green cycle here is the deliverable.

- [ ] **Step 3: Make it pass against real OZ 637c53a**

Adjust payload/context/rule construction until `do_check_auth` returns `Ok`. If OZ rejects zero-signer-with-policy rules outright (contradicting the storage.rs:381-395 reading), that is a **gate failure** — STOP and report; the completion design must change (fallback: a single dummy Delegated(controller) signer + `authorize_as_current_contract`, re-spiked).

Run: `cargo test -p nido-integration-tests --test it zero_signer_policy_completion 2>&1 | tail`
Expected: PASS.

- [ ] **Step 4: Add the negative case**

Add a sibling test: same setup but the policy's `enforce` panics (deny) → assert `do_check_auth` errors. Confirms the policy actually gates (not a vacuous pass).

Run: `cargo test -p nido-integration-tests --test it zero_signer_policy 2>&1 | tail`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/integration-tests/tests/it/zk_completion_spike.rs
git commit -m "test(zk): spike zero-signer AuthPayload policy-completion path (OZ 637c53a)"
```

---

### Task 6: Wallet-determinism spike matrix (M2 de-risk)

**Files:**
- Create: `tests/spikes/wallet-determinism.md`
- Create: `tests/spikes/sep53-verify.mjs` (Node script: given a wallet's returned signature + G-address + message, verify under the SEP-53 preimage)

**Interfaces:**
- Consumes: `@stellar/stellar-sdk` / `@noble/curves` ed25519, the fixed M2 message format (spec §2.1).
- Produces: a documented pass/fail table per wallet (Freighter, xBull, Albedo, Lobstr, Rabet, Hana) for: deterministic double-sign, and SEP-53 preimage verifiability.

- [ ] **Step 1: Write the SEP-53 verify helper + a synthetic determinism test**

```js
// tests/spikes/sep53-verify.mjs
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { StrKey } from '@stellar/stellar-sdk';
export function sep53Preimage(msg) {
  return sha256(new Uint8Array([...new TextEncoder().encode('Stellar Signed Message:\n'),
                                ...new TextEncoder().encode(msg)]));
}
export function verifySep53(gAddress, msg, sig64) {
  const pk = StrKey.decodeEd25519PublicKey(gAddress);
  return ed25519.verify(sig64, sep53Preimage(msg), pk);
}
// self-test: sign a fixed key over the preimage twice, assert equal + verify true
```

- [ ] **Step 2: Run the synthetic self-test**

Run: `cd /home/willem/c/s/nido && node tests/spikes/sep53-verify.mjs`
Expected: prints deterministic (two signs equal) + verify true for a synthetic key. Proves the derivation math before touching real wallets.

- [ ] **Step 3: Document the live-wallet matrix as a manual checklist**

Write `tests/spikes/wallet-determinism.md`: the exact message, the double-sign procedure via `StellarWalletsKit.signMessage`, and a table to fill (columns: wallet, returns-signature?, double-sign-identical?, SEP-53-verify?, verdict). Mark this as requiring a human with wallet extensions installed — flag it in the handoff. Pre-fill the expected outcomes (Freighter/xBull pass; Albedo verify wrapping; Ledger-backed likely nondeterministic).

- [ ] **Step 4: Commit**

```bash
git add tests/spikes/wallet-determinism.md tests/spikes/sep53-verify.mjs
git commit -m "test(zk): SEP-53 wallet-determinism spike (synthetic + live checklist)"
```

---

### Task 7: M0 gate report + downstream plan skeleton

**Files:**
- Create: `docs/superpowers/plans/2026-07-02-zk-recovery-m1-m4-outline.md`
- Modify: `docs/superpowers/specs/2026-07-02-zk-recovery-design.md` (record measured budget numbers + parity decision in §2.5/§6)

- [ ] **Step 1: Record real numbers in the spec**

Fill the spec's budget claims with the measured `verify_proof` CPU count, the completion-path estimate, the Poseidon2 parity decision (native vs chained-2to1), and the resolved dependency pin-set. Note the wallet matrix verdict once the human fills it.

- [ ] **Step 2: Write the M1–M4 outline**

One section per milestone (M1 zk-recovery contract, M2 smart-account+factory, M3 SDK+prover+indexer+relayer, M4 UX+e2e+deploy), each listing its tasks at title granularity with the pattern-source file for each. This becomes the input to a future `writing-plans` run once M0 passes.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers
git commit -m "docs(zk): M0 gate results + M1-M4 outline"
```

---

## Self-Review

- **Spec coverage:** Tasks map to spec §2 (circuit T3, derivation T6, domains Global Constraints), §3 (verifier T1, completion T5), §6 M0 gate (a→T3, b→T1, c→T4, d→T5, e→T6), §7.1 vectors (T2), §8 risks 1/2/3/4/7 (T4/T5/T2/T6/T1). Product build-out (§4 client, §5 attacks, M1–M4) is deliberately out of M0 scope → captured in T7 outline.
- **Placeholder scan:** budget field accessor flagged for confirmation against the real struct (T4 step 2); parity fallback branch explicit (T2/T3); no "TBD".
- **Type consistency:** `verify_proof(public_inputs, proof_bytes)`, `[root, nullifier, auth_hash]` order, `P2_4(DOM_BIND, acct_hi, acct_lo, inner)`, domain hex constants — identical across T2/T3/T4.

## Gate outcomes (STOP conditions)

- T4 budget > 80M → project gate failure; report, do not build M1.
- T5 OZ rejects zero-signer-with-policy rule → completion design changes; re-spike Delegated fallback.
- T1 dependency skew unreconcilable → report; substrate can't be reused as-is.
- T2 arity mismatch → not a stop; switch to chained-2to1 and continue.
