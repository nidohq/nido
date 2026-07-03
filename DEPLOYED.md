# Deployed contracts (testnet)

Current set of contracts the frontend talks to.

| Name | Address | Notes |
|---|---|---|
| Factory | `CBQKB6GYPO7P2CGDKN7KYLEFEBBN6FY5NXZJ7HNR43ZK2DDOU5N7NCV5` | Random-salt account factory. `create_account(salt, key)` deploys v0.7 smart accounts through the relayer. Registered as `unverified/factory`. Embeds smart-account wasm hash `00825acd…`. |
| WebAuthn verifier | `CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY` | Registered as `unverified/verifier`. Implements `canonicalize_key` / `batch_canonicalize_key` per current OZ `Verifier` trait. |
| Multisig policy | `CCSDKJYOFCPTCCGQZPF73RJNHFC7TPO532Q36N3M2VBYZFWQOTDB7J7G` | Registered as `unverified/multisig-policy`. Built against soroban-sdk 26 + OZ stellar-contracts main — accepts v0.7 `ContextRule` (with `signer_ids`/`policy_ids`). |
| Spending-limit policy | `CCJMCPGADKMVKYOIZXMV7UWH62XYDAIT6GJRNJPQSZ2CHPOF4K2AU2QC` | Registered as `unverified/spending-limit-policy`. Built against soroban-sdk 26 + OZ stellar-contracts rev `637c53a` — wraps `policies::spending_limit` (rolling window, meters SAC `transfer`). |
| Stellar Registry (unverified) | `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S` | The registry the factory queries via `Self::resolve(env, name)`. |
| Name registry | `CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX` | Human-readable account names. Independent of the policy-builder set. |
| Status Message demo | `CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV` | Hardcoded in `packages/frontend/src/pages/status-message/index.astro`. Predates the policy-builder work. |

## ZK Recovery (M1 — not yet deployed)

Passkey-secretless recovery via a depth-24 Merkle pool + UltraHonk proof
verification (`contracts/zk-recovery`, `contracts/zk-verifier`,
`circuits/zk_recovery`). Design/implementation complete through M1 Task 8;
**not yet deployed to testnet** — this section is the pre-deploy budget
confirmation plus placeholders to fill in once it is.

### Real, metered CPU cost (GO/NO-GO gates)

Both numbers below are real Wasm-metered costs (contracts registered from
compiled `.wasm` artifacts, not native Rust test-contracts — see
`crates/zk-bench/tests/budget.rs` and
`crates/integration-tests/tests/it/initiate_cost.rs`), measured against the
real depth-24 circuit's proof/vk/public-inputs fixtures, not a toy circuit.

| Measurement | CPU instructions | Gate | Headroom under gate | Test |
|---|---|---|---|---|
| `verify_proof` alone | 159,058,972 | ≤250,000,000 | ~90.9M | `just bench-zk` (`crates/zk-bench/tests/budget.rs`) |
| Full `initiate_recovery` (insert + recompute auth_hash + verify_proof + nullifier reserve + pending write + event) | 167,831,840 | ≤350,000,000 | ~182.2M | `just bench-zk-initiate` (`crates/integration-tests/tests/it/initiate_cost.rs`) |

The real per-transaction CPU limit on Stellar mainnet/testnet (protocol 27)
is `tx_max_instructions = 400,000,000`. Full `initiate_recovery` measures
**167,831,840** — only ~8.8M CPU above `verify_proof` alone, because
everything outside the pairing-heavy UltraHonk verification (root-ring
lookup, nonce/timelock checks, rate-limit prune, the `compute_auth_hash`
Poseidon2 recompute, and the storage writes) is cheap by comparison. That
leaves **~232.2M CPU (58%) of headroom** under the real 400M cap — the
deferred M0 budget question ("does the whole initiate flow fit on-chain?")
is answered **yes**, with substantial margin.

`cancel_recovery` also calls `verify_proof` and is expected to cost roughly
the same as `initiate_recovery` (same verifier cross-call, similar
bookkeeping) — not separately gated yet.

**Completion path (`ZkRecovery::enforce`, after the timelock elapses) does
NOT call `verify_proof` at all** — it authorizes the pending key rotation
via OZ's `Policy::enforce` against the already-stored `PendingRecovery`
record (`contracts/zk-recovery/src/policy.rs`, M1 Task 7), so it carries
none of the UltraHonk pairing cost and is cheap relative to both numbers
above (not yet separately gated/measured under real metering — the
completion spike (`zk_completion_spike.rs`) and
`zk_recovery_completion.rs` prove correctness, not cost).

### Toolchain pins (circuit/proof reproducibility)

- Noir: `nargo 1.0.0-beta.18` (enforced by
  `circuits/zk_recovery/scripts/gen_artifacts.sh`'s version guard — the
  script refuses to run against any other version).
- `bb` (Barretenberg): must match the `nargo`/ACIR version above (no
  separate `bb --version` pin is currently enforced by the script beyond
  requiring it to successfully consume that ACIR) — pin the exact `bb`
  build used for the deployed VK/proof here once chosen, e.g. `bb x.y.z`.
- `bb write_vk` / `bb prove` run with `--verifier_target evm-no-zk`
  (`gen_artifacts.sh`) — the deploy toolchain must additionally confirm/set
  `--oracle_hash keccak` (or nargo's equivalent transcript-hash config) to
  match, since the on-chain verifier's Fiat-Shamir transcript must use the
  same hash the circuit was compiled/proved against. **Not yet explicitly
  pinned in `gen_artifacts.sh`** — TODO before the real deploy: confirm and
  record the exact flag/config used.
- Current staged fixture hashes (`crates/integration-tests/fixtures/zk/manifest.json`,
  M0 circuit, not yet the deployed one): `vk` sha256
  `ba39b4ac4350a655792aa55acdf2a4855e099f48809db8569c88f2ed18ad3922`, `proof`
  sha256 `ac7cdbe247c06b3fadd8c6503c424558a724515787f2d5fdf393f613413bd1fa`,
  `public_inputs` sha256
  `6d5aa337af748dd36802e99b812b29ade948a010ac4a043afe706d56085b813b`.

### Deploy addresses (placeholder — fill in at real deploy time)

| Name | Address | Notes |
|---|---|---|
| `zk-verifier` | _TBD_ | `contracts/zk-verifier` — the UltraHonk verifier, constructed with the deployed VK bytes. |
| `zk-recovery` | _TBD_ | `contracts/zk-recovery` — the `ZkRecovery` pool/controller, constructed with `(factory, verifier, delay_secs, completion_window_secs, max_cancels, timelock_floor_secs, network_passphrase, webauthn_verifier)`. |
| Deployed circuit hash | _TBD_ | sha256 of the exact `zk_recovery.json` ACIR bytecode deployed with. |
| Deployed VK hash | _TBD_ | sha256 of the exact `vk` bytes the deployed verifier was constructed with. |

## ZK Recovery M2 (in-account guard + factory genesis-insert + migration — not yet deployed)

M2 wires the M1 `nido-zk-recovery` controller into the smart-account and
factory contracts: every account now installs the recovery rule + a genesis
Merkle leaf at construction time (enrollment is invisible — the anonymity
set is uniform whether or not an owner ever uses recovery), an in-account
guard blocks signer/rule eviction while a recovery is pending, and existing
`recovery_controller: None` accounts can opt in later via a visible
migration call. **Not yet deployed to testnet** — same pre-deploy-budget
posture as the M1 section above, plus placeholders below.

### Guard cross-call cost (GO/NO-GO gate)

The in-account guard (`contract.rs::guard_no_pending`) cross-calls the
controller's `has_pending` view on every signer/rule-mutating op
(`remove_signer`/`remove_context_rule`/`remove_policy`/
`update_context_rule_valid_until`) before doing anything else — this is the
"does calling into another contract to check a policy blow the budget"
question the SDF's policy-cross-call target (≤10,000,000 CPU) is about.
Measured with the same real-Wasm-metering methodology as the M1 numbers
above (real compiled `.wasm` bytes registered at both the account and
controller addresses, live budget raised to the real mainnet ceiling rather
than reset unlimited, `env.cost_estimate().resources().instructions` read
immediately after the one measured call) — see
`crates/integration-tests/tests/it/guard_cost.rs`.

| Measurement | CPU instructions | Gate | Test |
|---|---|---|---|
| `remove_signer`, guard fires (REAL live pending at a REAL Wasm-registered controller; cross-call + panic `RecoveryPendingBlocked`) | 1,173,794 | ≤10,000,000 | `just bench-zk-guard` (`crates/integration-tests/tests/it/guard_cost.rs::guard_fires_cost_with_real_pending`) |
| `remove_signer`, no recovery configured (guard is a no-op — no cross-call at all) | 816,591 | — (baseline) | `just bench-zk-guard` (`crates/integration-tests/tests/it/guard_cost.rs::no_recovery_configured_baseline_cost`) |

The guard's cross-call overhead in isolation (the delta between the two
rows above, separating it from `remove_signer`'s own fixed cost) is
**357,203 CPU** — both the guarded-fires number (1.17M) and the isolated
cross-call delta (357K) sit almost two orders of magnitude under the 10M
gate, with **~8.83M CPU of headroom**. The guard's cross-call is cheap
because `has_pending` is a single small-storage-read view with no
Poseidon2/pairing work, unlike `initiate_recovery`'s `verify_proof` (the
159M-CPU-dominated cost in the M1 section above).

### `create_account_v2` + genesis-insert shape

`Factory::create_account_v2(salt: BytesN<32>, key: BytesN<65>, commitment: BytesN<32>) -> Address`
deploys the account contract at the deterministic `get_c_address(salt)`
address (unchanged from `create_account`) AND, atomically in the same
transaction, cross-calls the resolved `zk-recovery` controller's
`insert(account, commitment)` to bind `commitment` as the account's genesis
Merkle leaf — if the insert fails for any reason the whole call (including
the just-deployed account) reverts, so there is never an account without a
leaf, nor a leaf without an account. The legacy `create_account(salt, key)`
entry point is kept for existing callers and now routes through the exact
same `deploy_and_insert` path, using a deterministic dummy commitment
(`sha256("nido-zk-dummy" || salt) mod r`) instead of a real one — so every
account this factory creates gets exactly one genesis leaf, real or dummy,
indistinguishable on-chain (`contracts/factory/src/contract.rs`'s
`create_account_and_create_account_v2_are_uniform_except_commitment` /
`dummy_and_real_enrollment_are_indistinguishable_on_chain` tests assert
this).

Both entry points also install the recovery rule at construction
(`NidoSmartAccount::__constructor`'s `recovery_controller: Some(..)` path):
production factory deploys always resolve and pass the `zk-recovery`
registry entry, so **every account this factory creates now installs the
zero-signer `CallContract(self)` recovery rule + a genesis leaf, whether or
not its owner ever uses recovery** — enrollment is invisible, keeping the
anonymity set uniform across the whole pool.

### `enroll_zk_recovery` migration path

`NidoSmartAccount::enroll_zk_recovery(recovery_controller: Address)` lets an
account that was deployed WITHOUT a recovery controller
(`recovery_controller: None` at construction — e.g. non-factory or
pre-M2 deploys) opt in afterwards, as a self-authorized, VISIBLE call
(requires `e.current_contract_address().require_auth()`). Unlike the
factory's invisible genesis path, this is a two-step flow the caller must
complete separately: (1) `account.enroll_zk_recovery(controller)` installs
the rule on the account (same `install_recovery_rule` helper the
constructor's `Some(..)` path uses — identical rule shape), then (2)
`pool.insert_for(account, commitment)` inserts the account's leaf into the
controller's Merkle tree. Panics `RecoveryAlreadyEnrolled` if a rule is
already installed (construction or a prior enroll call). This is a
migration path for a NEW-wasm account that happened to skip recovery at
construction — it does NOT retrofit a genuinely OLD-wasm account (deployed
before `enroll_zk_recovery` existed in the bytecode); Soroban contract wasm
is immutable once deployed. See
`crates/integration-tests/tests/it/zk_recovery_migration.rs`.

### Deploy addresses (placeholder — fill in at real deploy time)

| Name | Address | Notes |
|---|---|---|
| Smart-account v2 wasm hash | _TBD_ | sha256 of the deployed `nido_smart_account.wasm` embedding the M2 guard/migration/constructor changes — the factory's `account_wasm_hash()` derives this at runtime from its own embedded copy, so this must match exactly. |
| Factory (v2, `create_account_v2`) | _TBD_ | `contracts/factory` — resolves both `verifier` and `zk-recovery` from the registry at deploy time; embeds the smart-account v2 wasm hash above. |

## Pre-v0.7 contracts (do not use)

These were deployed during earlier iterations and remain on chain but are
incompatible with the current OZ v0.7 smart-account WASM. Accounts created
via the old factory cannot be signed for by the current SDK and need to be
re-created against the new factory.

| Name | Address | Reason superseded |
|---|---|---|
| Factory (old funder-based) | `CDQDNOT4RWQKAIJIZYJE5HK7DMIVTYBJ4QXHIERNOZPPYMUNBT2JZ2SK` | Expected `create_account(funder, key, amount)` and `get_c_address(funder)`, requiring a friendbot-funded setup account. |
| Factory (old) | `CDDMELYHOSD6M2T53F5DUYCXDS3VVOQ72E4KZMMZP37GQWII2WRKM2CC` | Hardcodes pre-v0.7 smart-account WASM hash. No admin/upgrade. |
| Verifier (old) | `CD6IG543VWP4RRNAKJTX25GJEQ3QAR5WPMP44MCENF433IPDFQTIJRTG` | Built before `batch_canonicalize_key` was required by OZ `Verifier`. |
| Multisig policy (old) | `CCJVJVNUXLD6MZDLSQMRWYAV4EKHE7IPOM5UJEPZAQUCL4Q5JMZFEUQA` | Built against soroban-sdk 25 + OZ v0.6 `ContextRule` (6 fields). Traps with `Error(Object, UnexpectedSize)` when v0.7 callers pass it the 8-field rule. |

## Re-deploying

None of the policy-builder-v1 contracts have `admin()/upgrade()`. To ship a
new WASM you deploy a fresh contract and repoint the registry name:

```bash
# build
just build-contracts

# deploy fresh
stellar contract deploy --wasm target/wasm32v1-none/contract/nido_<name>.wasm \
  --source-account <alias> --network testnet
# → prints new C-address

# repoint registry (uses BARE name without 'unverified/' prefix)
stellar contract invoke --id CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S \
  --source-account <alias> --network testnet -- update_contract_address \
  --contract_name <name> \
  --new_address <new C-address>
```

The factory's `Self::resolve(env, name)` caches in instance storage, but the
cache lives across simulations only when they succeed — a failed sim rolls
the cache back, so the next live call re-reads the registry. Replacing the
factory itself is the same pattern, plus updating `FACTORY_CONTRACT_ID` in
the four frontend `.astro` pages.

For the upgradable-factory rewrite that would make all of this unnecessary,
see [#26](https://github.com/nidohq/nido/issues/26).
