# Adsum (petition dapp) — design

**Date:** 2026-07-08
**Status:** Approved — not yet implemented

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
| Error handling | `#[contracterror]` enums + `Result` returns (typed errors preferred over the existing string-panic idiom; pattern for these and future contracts) |
| Storage idiom | `soroban-sdk-tools` (`#[contractstorage]`, `PersistentMap`, `InstanceItem`) |
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
    pub title: String,         // 1..=100 chars
    pub body: String,          // 1..=2000 chars
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
```

Views return `Option`/plain values; only fallible mutations return `Result`.

## Contract: `contracts/web-of-trust/` (`nido-web-of-trust`)

### Types and storage

```rust
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TrustError {
    SelfVouch = 1,
    AlreadyVouched = 2,
    VouchNotFound = 3,
}

#[contractstorage]
struct Graph {
    given:    PersistentMap<Address, Vec<Address>>, // whom `a` vouches for
    received: PersistentMap<Address, Vec<Address>>, // who vouches for `a`
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

No eligibility computation lives on-chain in v1. The petitions contract has no
dependency on this contract; they are coupled only in the dapp UI.

## Example dapp: `examples/adsum/`

Clone of the `status-message-dapp` skeleton: React 19 + Vite 7 + strict TS
(@theahaco/ts-config), stellar-scaffold project with its own self-contained
cargo workspace, **vendored copies** of both contracts under
`examples/adsum/contracts/`, joined to the root npm workspace
(`workspaces` gains `examples/adsum` and
`examples/adsum/packages/*`). `environments.toml` defines
development (local, run-locally) / testing (testnet, build+deploy) / staging
(testnet, pinned ids) / production (mainnet, commented). Generated staging
clients for both contracts are committed so the Pages build needs no
Rust/scaffold/RPC.

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
handling `AlreadySubmittedError` (Nido relayer may have already submitted)
and `ACCOUNT_SWITCH_REQUESTED`. The in-page session-passkey + relayer gasless
flow from status-message-dapp is explicitly deferred; it is the largest
complexity chunk in that example and not needed to seed the product.

### Trust badges (client-side)

For each visible signer: one `vouches_received` simulation read → badge
"N vouches". Highlight tiers computed against the viewer:

- **Vouched by you** — signer ∈ viewer's `given` list.
- **Vouched by someone you vouch for** — one extra hop: signer's `received`
  intersected with viewer's `given` (viewer's list fetched once and cached).

Reads are simulation-only, batched per visible page of signers, cached per
session. No indexer, no events.

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
- Testnet deploy of canonical contracts recorded in `DEPLOYED.md`; example's
  staging `environments.toml` pinned to those ids.
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
  partial last page), `has_*` on empty state.
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
- **Fast-lane e2e** (`@fast`, no chain): `/vouch?for=<addr>` renders the
  confirmation card from the URL param.
- **E2E**: quarantined `tests/e2e/testnet/adsum.testnet.spec.ts`
  driving create → vouch → sign → badge assertions against real testnet;
  never gates PRs.
- **Gates**: `just check` (fmt + clippy pedantic, tests included) and
  `just test` green.

## ZK migration path (documentation only — no v1 code)

The v1 interfaces were chosen so zk arrives additively:

1. **Trust-graph commitment.** `web-of-trust` later maintains a commitment to
   the edge set (e.g. an incrementally-updated Merkle root recomputed on
   `vouch`/`revoke`), exposed as `trust_root() -> BytesN<32>`. Plaintext
   edges remain during transition.
2. **Private signing.** `petitions` gains a new function:
   `sign_private(id, proof: Bytes, nullifier: BytesN<32>)`. The proof is a
   Groth16 proof verified on-chain via the Protocol 23 BLS12-381 host
   functions, asserting: "I control an identity that satisfies petition
   `id`'s trust criteria within the graph committed at root R". The
   `nullifier = PRF(sk, petition_id)` is stored in a per-petition nullifier
   set to block double-signing without cross-petition linkability. Public
   `sign` and private `sign_private` coexist; `sig_count` counts both.
3. **Criteria.** Per-petition eligibility criteria (trusted root accounts +
   max path depth — deliberately deferred from v1) enter the `Petition`
   struct when enforcement lands, and become public inputs to the circuit.
4. **Private vouching (later still).** Replace plaintext edges with vouch
   commitments so the graph itself is private; the prover then needs
   witnesses supplied off-chain by cooperating vouchers.

Wallet-side proving (circuit toolchain, proving keys, witness distribution)
is out of scope for this document.

## Out of scope for v1

- Any on-chain eligibility enforcement or per-petition criteria.
- Session-key / gasless relayer signing in the dapp.
- Petition editing, closing, or signature withdrawal.
- Vouch weights, expiry, or metadata.
- In-app QR camera scanner (phone camera + URL QR covers v1) and
  petition-share QR.
- Events/indexer; all reads are RPC simulation.
- Custom domain and mainnet deployment.
