# Adsum (petition dapp) — design

**Date:** 2026-07-08
**Status:** Approved — contracts implemented (petition-dapp branch); dapp pending

## Goal

**Adsum** (Latin "I am present" — the classical roll-call answer; signing a
petition as standing up to be counted) is a petition dapp seeded as a real
product (not just an integration demo): users create petitions, sign them,
and vouch for each other in an on-chain web of trust. Version 1 is deliberately non-zk; the long-term goal is zero-knowledge
signing — a user proves "I signed with an identity that satisfies the
petition's trust criteria" without revealing which identity — and this design
keeps that migration path clean (see "ZK migration path").

Two new Soroban contracts (`petitions`, `web-of-trust`) plus a new example
dapp at `examples/adsum/`, following the `status-message-dapp` scaffold
precedent. Contract names stay product-neutral (`petitions`, `web-of-trust`);
the Adsum brand lives at the dapp layer.

## Decisions (from design review)

| Decision | Choice |
| --- | --- |
| Purpose | Real petition product seed; example status secondary |
| Name | Adsum — vetted: no crypto/dapp/token collision; `adsum.fyi` unregistered (candidate custom domain); `adsum.xyz` on aftermarket. Sound-alikes (Adshares, Adaxum) distinct. Non-crypto namesakes exist (London fintech, app agency) — brand distinctly |
| Petition storage | Single registry contract (not contract-per-petition) |
| Content | Full text on-chain, size-capped |
| Lifecycle | Optional signature goal + optional deadline; no edit/close/un-sign |
| Trust model v1 | No on-chain eligibility enforcement; open signing; trust shown as client-computed badges |
| Vouch semantics | Directed, revocable edges; no weights, no expiry |
| Pre-vouch invites | Secret-based: ephemeral ed25519 keypair (front-run-safe, unlike hash preimages), QR carries secret, claim binds signature to claimant address. Multi-use with cap + optional expiry |
| Error handling | `#[contracterror]` enums + `Result` returns (typed errors preferred over the existing string-panic idiom; pattern for these and future contracts) |
| Storage idiom | `soroban-sdk-tools` (`#[contractstorage]`, `PersistentMap`, `InstanceItem`) |
| Events | Yes — `#[contractevent]` structs on both contracts (zk-recovery set the precedent); enables a `getEvents` indexer later |
| Placement | Dual-copy precedent: canonical crates in `contracts/`, vendored copies in the example's own cargo workspace |
| Deploy | Cloudflare Pages, `adsum.pages.dev` first; custom domain later |
| ZK in v1 | None in code; migration path documented here |

## Contract: `contracts/petitions/` (`nido-petitions`)

House style: `#![no_std]`, `src/lib.rs` + `src/contract.rs`, workspace deps
(soroban-sdk 26.0.1, soroban-sdk-tools), `crate-type = ["cdylib"]`,
`publish = false`, `[package.metadata.stellar] contract = true`.

### Types and storage

```rust
#[contracttype]
pub struct Petition {
    pub creator: Address,
    pub title: String,         // 1..=100 bytes (UTF-8)
    pub body: String,          // 1..=2000 bytes (UTF-8)
    pub goal: Option<u32>,     // signature target; display only, never enforced
    pub deadline: Option<u32>, // ledger sequence; sign() rejects at/after
    pub sig_count: u32,
    pub created_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PetitionError {
    NotFound = 1,
    TitleInvalid = 2,   // empty or over cap
    BodyInvalid = 3,    // empty or over cap
    DeadlineInPast = 4, // create: deadline <= current ledger sequence
    Expired = 5,        // sign: current ledger sequence >= deadline
    AlreadySigned = 6,
}

#[contractstorage]
struct Registry {
    petitions: PersistentMap<u32, Petition>,
    signatures: PersistentMap<(u32, Address), ()>,       // dedupe lookup
    signer_by_index: PersistentMap<(u32, u32), Address>, // enumeration
    count: InstanceItem<u32>,
}
```

`signer_by_index` (petition id, index) → signer, with `sig_count` as the next
index, gives unbounded signer enumeration via paginated reads. A single
`Vec<Address>` per petition would hit the ledger-entry size ceiling at a few
thousand signers; the indexed map does not.

Caps are byte counts, not character counts: Soroban's `String::len()` counts
UTF-8 bytes, so a title/body full of multi-byte characters hits the cap well
before 100/2000 codepoints. Client-side validation must count UTF-8 bytes
(e.g. `new TextEncoder().encode(title).length`), not `.length`/codepoints, to
match what the contract will accept.

### Functions

```rust
pub fn create_petition(
    e: &Env, creator: &Address, title: &String, body: &String,
    goal: &Option<u32>, deadline: &Option<u32>,
) -> Result<u32, PetitionError>;
// creator.require_auth(); validate title/body lengths and deadline;
// id = count; store; count += 1; returns id.

pub fn sign(e: &Env, id: u32, signer: &Address) -> Result<(), PetitionError>;
// signer.require_auth(); petition exists; not expired; not already signed.
// Writes signatures[(id, signer)] and signer_by_index[(id, sig_count)];
// increments sig_count. Interface is deliberately (id, address) only —
// the zk variant arrives later as a NEW function, not a mutated parameter list.

pub fn get_petition(e: &Env, id: u32) -> Option<Petition>;
pub fn petition_count(e: &Env) -> u32;
pub fn has_signed(e: &Env, id: u32, addr: &Address) -> bool;
pub fn get_signers(e: &Env, id: u32, start: u32, limit: u32) -> Vec<Address>;
// Reads signer_by_index over [start, min(start+limit, sig_count)).

pub fn extend_ttl(e: &Env, id: u32) -> Result<(), PetitionError>;
// Callable by anyone (name-registry idiom); extends the petition entry
// ~30 days (518_400 ledgers threshold/extend_to).

pub fn extend_signatures_ttl(e: &Env, id: u32, start: u32, limit: u32) -> Result<(), PetitionError>;
// Callable by anyone; extends signer_by_index/signatures entries over
// [start, min(start+limit, sig_count)) — paginated, signer set is unbounded.
```

Views return `Option`/plain values; only fallible mutations return `Result`.

Events (`#[contractevent]` structs with `data_format = "map"`, published via
`.publish(env)` — the `zk-recovery` `types.rs` precedent): `PetitionCreated
{ id, creator }`, `PetitionSigned { id, signer }`.

## Contract: `contracts/web-of-trust/` (`nido-web-of-trust`)

### Types and storage

```rust
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TrustError {
    SelfVouch = 1,
    AlreadyVouched = 2,
    VouchNotFound = 3,
    PreVouchExists = 4,
    PreVouchNotFound = 5,   // also: exhausted (deleted at cap), never created,
                            // or revoke by non-creator (no creator leak)
    PreVouchExpired = 6,
    InvalidMaxClaims = 7,   // max_claims == 0
    ExpiryInPast = 8,       // pre_vouch: expires <= current ledger
}

#[contracttype]
pub struct PreVouch {
    pub from: Address,
    pub expires: Option<u32>, // ledger sequence
    pub max_claims: u32,      // >= 1
    pub claims: u32,          // claimed so far
}

#[contractstorage]
struct Graph {
    given:       PersistentMap<Address, Vec<Address>>, // whom `a` vouches for
    received:    PersistentMap<Address, Vec<Address>>, // who vouches for `a`
    pre_vouches: PersistentMap<BytesN<32>, PreVouch>,  // key = ed25519 pubkey
}
```

Per-account `Vec`s are acceptable here: realistic vouch lists are small
(tens), unlike petition signer lists.

### Functions

```rust
pub fn vouch(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError>;
// from.require_auth(); from != to; not already present; push to both maps.

pub fn revoke(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError>;
// from.require_auth(); edge must exist; remove from both maps.

pub fn vouches_given(e: &Env, a: &Address) -> Vec<Address>;
pub fn vouches_received(e: &Env, a: &Address) -> Vec<Address>;
pub fn has_vouched(e: &Env, from: &Address, to: &Address) -> bool;
pub fn extend_ttl(e: &Env, a: &Address);
// Extends both of `a`'s entries if present; infallible no-op otherwise.
```

### Pre-vouch invites

A user creates an invite secret; whoever redeems it gets vouched by the
creator — including brand-new accounts that didn't exist when the invite was
made. The secret is an **ephemeral ed25519 keypair**, not a hash preimage: a
preimage scheme is front-runnable (the claim transaction reveals the secret,
which an observer could redirect to their own address), whereas here the
claim carries a signature over the claimant's address, so an observed claim
is useless to anyone else.

Two residual key-registration quirks, neither a privilege escalation: an
observer watching the mempool can front-run `pre_vouch` to register the same
pubkey first (squatting the key), in which case the victim's own transaction
simply fails loudly with `PreVouchExists`; and once an invite is exhausted
(deleted at `max_claims`) or revoked, its pubkey is free for anyone holding
the corresponding secret to register a new, unrelated `pre_vouch` under —
since vouching is unilateral (the registrant becomes the `from`) and claim
UIs resolve the invite's creator on-chain rather than trusting the key
itself, neither case lets an attacker impersonate or claim credit for
someone else's vouch.

```rust
pub fn pre_vouch(
    e: &Env, from: &Address, key: &BytesN<32>,
    expires: &Option<u32>, max_claims: u32,
) -> Result<(), TrustError>;
// from.require_auth(); key unused; max_claims >= 1; expires in future if set.

pub fn claim_vouch(
    e: &Env, key: &BytesN<32>, to: &Address, sig: &BytesN<64>,
) -> Result<(), TrustError>;
// Entry exists and not expired. Verifies `sig` with `key` (ed25519) over the
// domain-separated payload (current contract address, "adsum:claim_vouch",
// to). NOTE: env.crypto().ed25519_verify is a trapping host function — an
// invalid signature aborts with a host error rather than a typed
// TrustError (same behavior as the webauthn-verifier's secp256r1 check).
// Then the normal vouch checks (entry.from != to, edge not already present —
// which also dedupes repeat claims by the same account) and creates the
// entry.from -> to edge. claims += 1; the entry is deleted at max_claims.
// Deliberately NO require_auth on `to`: the signature IS the authorization,
// so any party (dapp, relayer) can submit the claim — a zero-balance new
// account can be vouched without signing its first transaction.

pub fn revoke_pre_vouch(e: &Env, from: &Address, key: &BytesN<32>)
    -> Result<(), TrustError>;
// from.require_auth(); entry must exist and entry.from == from.

pub fn get_pre_vouch(e: &Env, key: &BytesN<32>) -> Option<PreVouch>;
```

Invite secrets never touch the chain; the dapp keeps them (with their pubkeys)
in localStorage so the creator can re-display QR codes and read claim counts
via `get_pre_vouch` — no on-chain creator index needed.

Events: `Vouched { from, to }`, `VouchRevoked { from, to }`,
`PreVouchCreated { key, from }`, `VouchClaimed { key, from, to }`.

No eligibility computation lives on-chain in v1. The petitions contract has no
dependency on this contract; they are coupled only in the dapp UI.

## Example dapp: `examples/adsum/`

**Plumbing** from the `status-message-dapp` skeleton: React 19 + Vite 7 +
strict TS (@theahaco/ts-config), stellar-scaffold project with its own
self-contained cargo workspace, **vendored copies** of both contracts under
`examples/adsum/contracts/`, joined to the root npm workspace
(`workspaces` gains `examples/adsum` and
`examples/adsum/packages/*`). `environments.toml` defines
development (local, run-locally) / testing (testnet, build+deploy) / staging
(testnet, pinned to the deployed ids in `DEPLOYED.md`) / production (mainnet,
commented). Generated staging clients for both contracts are committed so the
Pages build needs no Rust/scaffold/RPC.

**Design, however, is NOT the scaffold template** (decision 2026-07-10:
design freedom granted; make it engaging). Direction — **civic print
culture**, "a living broadside":

- **Petitions are printed proclamations.** The detail page reads as a
  typographic document: Fraunces display serif (Nido's brand serif — family
  kinship without wearing the wallet's skin) for petition text, Hanken
  Grotesk for UI chrome. Paper/ink palette; dark mode is the ink/paper
  inversion of light mode, not a grey theme.
- **Signing is the ADSUM stamp.** The sign action is a stamp press — "ADSUM —
  I am present" impressed onto the document with a brief ink-settle
  animation; the signer's resolved name joins the signature wall beneath the
  text. Signature wall entries carry small ink-mark badges for vouch counts.
- **Invites are letters of introduction** (the historic vouching
  instrument). A pre-vouch invite renders as a sealed letter — wax-seal
  motif, QR inside; `/claim` opens as "a letter vouching for you from
  <resolved name>". Uses/expiry read as the letter's terms.
- **The trust page is a constellation:** the connected account's 1-hop ego
  graph (given/received edges) drawn client-side (SVG; no graph library
  unless genuinely needed), alongside the vouch form and invite drawer.
- **Home is a poster wall:** petition broadsides as cards, progress rendered
  as a filling ink line, deadlines humanized from ledger sequence.
- `@stellar/design-system` is dropped; custom CSS (modules + tokens).
  Wallet-kit's modal stays (functional necessity). Accessibility and
  responsiveness are requirements, not afterthoughts: the print aesthetic
  must degrade gracefully to small screens, and all interactions work
  without the animations.

### Pages

- **Home** — petition list (reads `petition_count` then `get_petition` per id;
  paginate the list client-side), create-petition form (title, body, optional
  goal, optional deadline as date → ledger-sequence estimate).
- **Petition detail** — full body, progress bar (`sig_count` vs `goal`),
  deadline countdown, sign button (disabled when signed/expired), paginated
  signer list (`get_signers`) with trust badges.
- **Trust** — connected account's vouches given/received, "My QR" vouch code
  (see "QR vouching"), vouch-for-address
  form (accepts G/C address or nido name via existing resolver lib), revoke
  buttons.
- **Debug** — `@theahaco/contract-explorer` over both generated clients
  (house pattern).

### Wallet and signing

`@creit.tech/stellar-wallets-kit` v2 static API with `NidoModule` registered
first (`moduleOrder` helper, unit-tested), `WalletProvider`/`useWallet`
pattern reused. **v1 signs everything through the standard kit
`signTransaction` path** — bindings `AssembledTransaction.signAndSend` with
the kit callback — for classic wallets and Nido (popup) alike, including
handling `ACCOUNT_SWITCH_REQUESTED` and the `submitted: true` sentinel guard
(`AlreadySubmittedError` pattern from `StatusMessage.tsx`): a Nido wallet in
relayer mode submits wallet-side and returns the hash, so Nido users are
already gasless on this path and `signAndSend` must not re-broadcast.

Deferred as one unit: **in-page session-passkey signing with relayer
submission** (`signSessionCallInPage` core + `extractFuncAndAuth` →
`submitSorobanTransaction` → `waitForConfirmation` from `@nidohq/passkey-sdk`,
`expirationOffset` ≈ 120 ledgers since signed auth entries leave the page).
There is no sanctioned fee-payer/friendbot intermediate — that pattern was
deleted from status-message-dapp as a bug (#129). The relayer client is
already exported and `nidoSign.ts` is a clean copy reference, so deferral is
a UX/scope call, not a plumbing one.

### Trust badges (client-side)

For each visible signer: one `vouches_received` simulation read → badge
"N vouches". Highlight tiers computed against the viewer:

- **Vouched by you** — signer ∈ viewer's `given` list.
- **Vouched by someone you vouch for** — one extra hop: signer's `received`
  intersected with viewer's `given` (viewer's list fetched once and cached).

Reads are simulation-only, batched per visible page of signers, cached per
session. No indexer in v1; the contracts emit events so a `getEvents`-based
indexer (the `infra/pool-indexer` Cloudflare Worker precedent — mind the
7-day event retention) can be added when listing outgrows simulation reads.

### QR vouching

In-person vouching without typing addresses. No contract change — `vouch`
already takes an arbitrary target.

- **"My QR"** on the Trust page renders a QR (client-side, `qrcode` npm
  package) encoding `https://<dapp origin>/vouch?for=<address>` for the
  connected account.
- **`/vouch?for=<addr>` route**: validates the param as a G/C strkey, shows a
  confirmation card, and submits `vouch(viewer, addr)` on confirm. Handles
  the not-connected case by preserving the param through the wallet-connect
  flow (localStorage pattern, as status-message-dapp does for pending
  delegation), plus already-vouched and self-vouch states.
- **Anti-spoof rule**: the URL carries the address only — never a display
  name. The confirmation card resolves the name from the on-chain name
  registry (existing resolver lib) and displays resolved name + address, so
  a QR cannot claim an identity it doesn't have; an unrecognized address
  simply looks unrecognized.
- **Helpers**: pure `buildVouchUrl` / `parseVouchParam` functions with
  colocated vitest tests.
- **Pre-vouch invites**: Trust page "Create invite" form (uses, default 1;
  expiry, default ~30 days ≈ 518,400 ledgers) generates a keypair client-side,
  submits `pre_vouch(me, pk, expires, max_claims)`, then shows a QR of
  `/claim?k=<secret key>`. Invites (secret + pk + label) persist in
  localStorage; the Trust page lists them with live `x/y claimed` from
  `get_pre_vouch`, re-showable QR, and revoke buttons. The `/claim` route
  derives the pubkey, loads the invite, and shows "<resolved name> has
  pre-vouched you" (same anti-spoof rule: names resolved on-chain, never from
  the URL). Not connected → onboarding CTA (Nido account creation via the
  wallet selector), secret held in localStorage across the roundtrip, then
  the claim signature is built (stellar-sdk `Keypair`) and submitted.
  UI copy warns: the QR *is* the vouch — anyone scanning it can claim one of
  its uses; revocable until exhausted.
- **Deferred**: in-app camera scanner (`BarcodeDetector` is unsupported in
  Safari; the phone camera scanning a URL QR covers v1). Petition-share QR
  uses the same mechanics if wanted later.

### Deploy

New Cloudflare Pages project `adsum`, GitHub Actions workflow
path-filtered on `examples/adsum/**` (mirrors `pages.yml` structure
but deploys with wrangler using the repo's existing CF secrets, like
`deploy.yml`). Live at `adsum.pages.dev`; custom domain attached in
the CF dashboard later — nido.fyi subdomains are NOT usable (wildcard serves
per-account passkey origins).

## Repo integration checklist

- Root `Cargo.toml`: nothing to add — `contracts/*` glob picks up both crates.
- Root `package.json`: add example dirs to `workspaces`; extend
  `build:packages` if new binding packages are added for the main frontend
  (not required for v1 — the example generates its own clients via scaffold).
- `justfile`: add both names to `bindings-all` loop when/if
  `packages/contract-bindings/` clients are wanted (deferred; example uses
  scaffold-generated clients).
- Testnet deploy of canonical contracts recorded in `DEPLOYED.md` and names
  registered in the unverified registry. Deploy via a JS-SDK script following
  `scripts/deploy-zk-recovery.mjs` — stellar-cli 26.0.0 fails with "Missing
  Entry Context" on scaffold-built contracts (documented in `DEPLOYED.md`).
  Example's staging `environments.toml` pinned to those ids.
- CI: new Pages-deploy workflow; existing `test.yml` unaffected (vitest
  auto-discovers nothing new at root; example has its own `test`/`lint`/
  `typecheck` scripts run in the new workflow before deploy).

## Testing

- **Contract unit tests** (inline `#[cfg(test)] mod test` in each
  `contract.rs`, native registration, `mock_all_auths`, `setup()` helper):
  every public function happy path; every error via generated `try_` client
  methods asserting `Err(Ok(PetitionError::X))` — no `#[should_panic]`;
  boundaries: title/body at cap and over, empty strings, deadline at current
  ledger, sign at deadline boundary, double-sign, self-vouch, duplicate
  vouch, revoke-nonexistent, pagination edges (start past end, limit 0,
  partial last page), `has_*` on empty state. Pre-vouch: claim happy path,
  bad signature, wrong-key signature, signature bound to a different address,
  expired, exhausted (cap reached deletes entry), repeat claim by same
  account (`AlreadyVouched`), creator claims own invite (`SelfVouch`),
  revoke by non-creator, `max_claims == 0`. Test signatures need an ed25519
  signer (`ed25519-dalek` dev-dependency, alongside the existing p256 pattern
  in integration tests).
- **Integration tests**: `crates/integration-tests/tests/it/petitions.rs`
  and `web_of_trust.rs`, wasm-level (`include_bytes!` + `#[contractclient]`
  traits). At least one real-auth-path test signs a petition through a
  deployed smart account (`deploy_smart_account()` + hand-built
  `set_auths`) — the bug-#3 lesson from `tests/README.md`. Snapshots
  committed.
- **Dapp unit tests** (vitest, colocated): badge computation (pure), module
  order, env parsing, ledger/date conversion helpers, `buildVouchUrl` /
  `parseVouchParam` (valid strkeys, junk, missing param); `lint` and
  `typecheck` scripts.
- **Fast-lane e2e** (`@fast`-tagged titles, gates PRs): `/vouch?for=<addr>`
  renders the confirmation card from the URL param; petition list / sign /
  vouch flows against a chain double following the `tests/support/
  zkChainMock.ts` pattern — Playwright route interception of the RPC host
  answering real stellar-sdk-encoded XDR, dispatched by (contract id,
  function). Extend that helper rather than inventing a new mock.
- **E2E testnet**: quarantined `tests/e2e/testnet/adsum.testnet.spec.ts`
  (`@testnet`-tagged) driving create → vouch → sign → badge assertions
  against real testnet; never gates PRs (manual `test-testnet.yml` /
  `just test-e2e-testnet`).
- **Gates**: `just check` (fmt + clippy pedantic, tests included) and
  `just test` green.

## ZK migration path (documentation only — no v1 code)

The repo now ships a production ZK stack (ZK account recovery, M0–M4):
**Noir** circuits proven with **UltraHonk** (Barretenberg) over **BN254**,
verified on-chain by the vendored `contracts/vendor/ultrahonk-soroban-verifier`
library using Soroban's native `bn254` host functions and a keccak
Fiat-Shamir transcript (`--verifier_target evm-no-zk`). The petition zk
milestone reuses that stack wholesale — not Groth16/BLS12-381, which an
earlier draft of this section assumed.

What already exists and carries over:

- **Verifier**: `contracts/zk-verifier` is circuit-agnostic wasm; one deployed
  instance per verification key. Petition zk-signing = `bb write_vk` for the
  petition circuit, deploy a new instance with that VK, register it (e.g.
  `adsum-verifier`) in the registry. No new verifier code.
- **Circuit shape**: `circuits/zk_recovery` is already the Semaphore pattern —
  Poseidon2 Merkle membership + nullifier + one `auth_hash` public input,
  fixed 3-public-input layout (`root || nullifier || auth_hash`, 96 bytes).
  The petition circuit keeps that shape; the existing verifier contract,
  blob layout, and prover plumbing then work unchanged.
- **Contract patterns** (from `contracts/zk-recovery`): cross-call the
  verifier via `try_invoke_contract("verify_proof", …)` mapping failure to
  one error; recompute `auth_hash` on-chain from the call's own arguments
  (binding contract address, network passphrase, petition id, nonce) — this
  is what makes submission permissionless and relayable; Poseidon2 host
  hashing via the pinned `soroban-poseidon` rev with fresh `DOM_*` domain
  constants; the depth-24 incremental Merkle frontier + 128-slot historic
  root ring (`merkle.rs`) is exactly the commitment pool a trust-graph
  membership proof needs; BN254 canonicality guard (reject values ≥ scalar
  order, never reduce); `NullifierState::Spent` persistent-key idiom.
- **Prover**: `packages/frontend/src/lib/zk/prover.ts` + worker (dynamic
  `@noir-lang/noir_js` + `@aztec/bb.js`, no COOP/COEP requirement,
  `__ZK_PROVER_STUB__` hook for fast-lane e2e). Proving takes tens of
  seconds — UX must plan for it. Circuit artifacts served from the dapp's
  `public/circuits/` with sha256-pinned `manifest.json`.
- **CI/cost discipline**: committed real bb fixtures so tests never need
  nargo/bb; hard budget gates (`verify_proof` ≤ 250M CPU, whole
  proof-carrying tx ≤ 350M vs the 400M cap — `crates/zk-bench` pattern);
  Poseidon2 parity vectors across Noir / Rust / TS implementations.

The migration itself:

1. **Trust-graph commitment.** `web-of-trust` gains a Poseidon2 Merkle pool
   of identity commitments (frontier + root ring per `merkle.rs`), exposed
   as `trust_root()`/`is_known_root()`. Plaintext edges remain during
   transition.
2. **Private signing.** `petitions` gains
   `sign_private(id, proof: Bytes, nullifier: BytesN<32>, …)`: verifier
   cross-call proves "I control an identity satisfying petition `id`'s
   criteria in the graph at a known root"; per-petition external nullifier
   `Poseidon2(DOM_ADSUM_NULL, petition_id, secret)` blocks double-signing
   without cross-petition linkability. Public `sign` and `sign_private`
   coexist; `sig_count` counts both.
3. **Criteria.** Per-petition eligibility criteria (trusted roots + max path
   depth — deferred from v1) will live in a parallel
   `criteria: PersistentMap<u32, Criteria>` map added alongside the existing
   `Registry` storage, keyed by petition id, and become public inputs to
   `sign_private`. Existing petition entries are left untouched — adding
   fields to the `Petition` struct itself would change its stored XDR shape,
   contradicting this section's no-storage-migration claim.
4. **Private vouching (later still).** Vouch commitments instead of plaintext
   edges; witnesses supplied off-chain by cooperating vouchers. Pre-vouch
   invites are a conceptual stepping stone: a vouch as a bearer credential
   rather than a public edge.

Because the primitives are live today, v1 needs no zk code to stay
compatible — the later milestone adds a Noir circuit, a verifier instance,
and new contract functions, with no storage-format migration.

## Out of scope for v1

- Any on-chain eligibility enforcement or per-petition criteria.
- Session-key / gasless relayer signing in the dapp.
- Petition editing, closing, or signature withdrawal.
- Vouch weights, expiry, or metadata.
- In-app QR camera scanner (phone camera + URL QR covers v1) and
  petition-share QR.
- Indexer; all v1 reads are RPC simulation (events are emitted but nothing
  consumes them yet).
- Custom domain and mainnet deployment.
