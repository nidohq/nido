# Adsum Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the two canonical Soroban contracts for Adsum — `petitions` (single-registry petition store) and `web-of-trust` (vouch edges + pre-vouch invites) — with unit tests, integration tests, and testnet deployment.

**Architecture:** Two independent `#![no_std]` Soroban contracts in the root cargo workspace (`contracts/*` glob). `petitions` stores petitions in typed maps with indexed signer enumeration; `web-of-trust` stores directed vouch edges plus ed25519-keyed pre-vouch invites. No cross-contract calls; they are coupled only in the (separately planned) dapp UI. Spec: `docs/superpowers/specs/2026-07-08-petition-dapp-design.md`.

**Tech Stack:** soroban-sdk 26.0.1 (workspace pin), soroban-sdk-tools (`#[contractstorage]`, `PersistentMap`, `InstanceItem`), `#[contracterror]` + `Result` returns, `#[contractevent]` events, ed25519 via `env.crypto().ed25519_verify`, `ed25519-dalek` 2 in tests only.

## Global Constraints

- soroban-sdk = 26.0.1 via `{ workspace = true }`; soroban-sdk-tools via `{ workspace = true }` (both pinned in root `Cargo.toml`).
- Crate names: `nido-petitions`, `nido-web-of-trust`. Dirs: `contracts/petitions/`, `contracts/web-of-trust/`.
- Every fallible mutation returns `Result<_, ContractError>`; views return `Option`/plain values. Error enums use explicit stable discriminants; never renumber, only append.
- Events: `#[contractevent(topics = ["..."], data_format = "map")]` structs with lifetime + reference fields, published via `Struct { .. }.publish(e)` (precedent: `contracts/zk-recovery/src/types.rs`).
- Constants (from spec, exact): `TITLE_MAX = 100`, `BODY_MAX = 2000` (chars via `String::len`), `TTL_LEDGERS = 518_400` (~30 days), claim domain tag `b"adsum:claim_vouch"`.
- `sign()` rejects at/after deadline: `current_ledger >= deadline` → `Expired`. `create_petition` rejects `deadline <= current_ledger` → `DeadlineInPast`.
- All code must pass `cargo clippy --all --tests -- -Dclippy::pedantic` (part of `just check`) and `cargo fmt`.
- Unit tests: inline `#[cfg(test)] mod test` at the bottom of `contract.rs`, native `env.register(Contract, ())`, `env.mock_all_auths()`, error cases via `client.try_*` asserting `Err(Ok(Error::X))`. Do NOT use `#[should_panic]` for typed errors (only for host traps).
- Run unit tests scoped: `cargo test -p <crate>` (the workspace-wide `cargo test` needs contract wasm built first).
- Commit after every task with a conventional short message; branch `petition-dapp`.

---

### Task 1: `petitions` crate — create/read

**Files:**
- Create: `contracts/petitions/Cargo.toml`
- Create: `contracts/petitions/src/lib.rs`
- Create: `contracts/petitions/src/contract.rs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (later tasks build on these exact items):
  - `pub struct Petition { creator: Address, title: String, body: String, goal: Option<u32>, deadline: Option<u32>, sig_count: u32, created_ledger: u32 }`
  - `pub enum PetitionError { NotFound = 1, TitleInvalid = 2, BodyInvalid = 3, DeadlineInPast = 4, Expired = 5, AlreadySigned = 6 }`
  - `create_petition(e: &Env, creator: &Address, title: &String, body: &String, goal: &Option<u32>, deadline: &Option<u32>) -> Result<u32, PetitionError>`
  - `get_petition(e: &Env, id: u32) -> Option<Petition>`
  - `petition_count(e: &Env) -> u32`
  - Storage struct `Registry` with `petitions`, `signatures`, `signer_by_index`, `count` fields (fields for tasks 2–3 declared now so the storage layout never changes).

- [ ] **Step 1: Crate scaffold**

`contracts/petitions/Cargo.toml`:

```toml
[package]
name = "nido-petitions"
version.workspace = true
edition.workspace = true
license.workspace = true
publish = false

[package.metadata.stellar]
contract = true

[lib]
crate-type = ["cdylib"]
doctest = false

[dependencies]
soroban-sdk = { workspace = true }
soroban-sdk-tools = { workspace = true }

[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
```

`contracts/petitions/src/lib.rs`:

```rust
#![no_std]
#![allow(dead_code)]

mod contract;
```

- [ ] **Step 2: Write types, storage, and failing tests**

`contracts/petitions/src/contract.rs` — types, storage, contract skeleton, and the Task-1 test module. The `create_petition` body is NOT written yet; declare it with `unimplemented!()` so the tests compile and fail (RED):

```rust
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String, Vec,
};
use soroban_sdk_tools::{contractstorage, InstanceItem, PersistentMap};

pub const TITLE_MAX: u32 = 100;
pub const BODY_MAX: u32 = 2000;
const TTL_LEDGERS: u32 = 518_400; // ~30 days of ledgers

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Petition {
    pub creator: Address,
    pub title: String,
    pub body: String,
    pub goal: Option<u32>,
    pub deadline: Option<u32>,
    pub sig_count: u32,
    pub created_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PetitionError {
    NotFound = 1,
    TitleInvalid = 2,
    BodyInvalid = 3,
    DeadlineInPast = 4,
    Expired = 5,
    AlreadySigned = 6,
}

#[contractevent(topics = ["petition_created"], data_format = "map")]
pub struct PetitionCreated<'a> {
    #[topic]
    pub id: &'a u32,
    pub creator: &'a Address,
}

#[contractevent(topics = ["petition_signed"], data_format = "map")]
pub struct PetitionSigned<'a> {
    #[topic]
    pub id: &'a u32,
    pub signer: &'a Address,
}

#[contractstorage]
pub struct Registry {
    petitions: PersistentMap<u32, Petition>,
    signatures: PersistentMap<(u32, Address), ()>,
    signer_by_index: PersistentMap<(u32, u32), Address>,
    count: InstanceItem<u32>,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn create_petition(
        e: &Env,
        creator: &Address,
        title: &String,
        body: &String,
        goal: &Option<u32>,
        deadline: &Option<u32>,
    ) -> Result<u32, PetitionError> {
        let _ = (e, creator, title, body, goal, deadline);
        unimplemented!()
    }

    pub fn get_petition(e: &Env, id: u32) -> Option<Petition> {
        Registry::new(e).petitions.get(&id)
    }

    pub fn petition_count(e: &Env) -> u32 {
        Registry::new(e).count.get().unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
    use soroban_sdk::Env;

    fn setup() -> (Env, ContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Contract, ());
        let client = ContractClient::new(&env, &id);
        (env, client)
    }

    #[test]
    fn create_and_get() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let title = String::from_str(&env, "Save the park");
        let body = String::from_str(&env, "We the undersigned ask the city to keep the park.");

        let id = client.create_petition(&creator, &title, &body, &Some(100), &None);

        assert_eq!(id, 0);
        assert_eq!(client.petition_count(), 1);
        let p = client.get_petition(&0).unwrap();
        assert_eq!(p.creator, creator);
        assert_eq!(p.title, title);
        assert_eq!(p.body, body);
        assert_eq!(p.goal, Some(100));
        assert_eq!(p.deadline, None);
        assert_eq!(p.sig_count, 0);
        assert_eq!(p.created_ledger, env.ledger().sequence());
    }

    #[test]
    fn create_emits_event() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        assert_eq!(env.events().all().events().len(), 1);
    }

    #[test]
    fn ids_increment() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let title = String::from_str(&env, "t");
        let body = String::from_str(&env, "b");
        assert_eq!(client.create_petition(&creator, &title, &body, &None, &None), 0);
        assert_eq!(client.create_petition(&creator, &title, &body, &None, &None), 1);
        assert_eq!(client.petition_count(), 2);
    }

    #[test]
    fn title_validation() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let body = String::from_str(&env, "b");

        let empty = String::from_str(&env, "");
        assert_eq!(
            client.try_create_petition(&creator, &empty, &body, &None, &None),
            Err(Ok(PetitionError::TitleInvalid))
        );

        // 101 chars: over TITLE_MAX
        let over = String::from_str(&env, core::str::from_utf8(&[b'a'; 101]).unwrap());
        assert_eq!(
            client.try_create_petition(&creator, &over, &body, &None, &None),
            Err(Ok(PetitionError::TitleInvalid))
        );

        // exactly 100: OK
        let max = String::from_str(&env, core::str::from_utf8(&[b'a'; 100]).unwrap());
        assert!(client
            .try_create_petition(&creator, &max, &body, &None, &None)
            .is_ok());
    }

    #[test]
    fn body_validation() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let title = String::from_str(&env, "t");

        let empty = String::from_str(&env, "");
        assert_eq!(
            client.try_create_petition(&creator, &title, &empty, &None, &None),
            Err(Ok(PetitionError::BodyInvalid))
        );

        let over = String::from_str(&env, core::str::from_utf8(&[b'a'; 2001]).unwrap());
        assert_eq!(
            client.try_create_petition(&creator, &title, &over, &None, &None),
            Err(Ok(PetitionError::BodyInvalid))
        );

        let max = String::from_str(&env, core::str::from_utf8(&[b'a'; 2000]).unwrap());
        assert!(client
            .try_create_petition(&creator, &title, &max, &None, &None)
            .is_ok());
    }

    #[test]
    fn deadline_must_be_future() {
        let (env, client) = setup();
        env.ledger().with_mut(|l| l.sequence_number = 1000);
        let creator = Address::generate(&env);
        let title = String::from_str(&env, "t");
        let body = String::from_str(&env, "b");

        assert_eq!(
            client.try_create_petition(&creator, &title, &body, &None, &Some(1000)),
            Err(Ok(PetitionError::DeadlineInPast))
        );
        assert_eq!(
            client.try_create_petition(&creator, &title, &body, &None, &Some(999)),
            Err(Ok(PetitionError::DeadlineInPast))
        );
        assert!(client
            .try_create_petition(&creator, &title, &body, &None, &Some(1001))
            .is_ok());
    }

    #[test]
    fn get_missing_returns_none() {
        let (_env, client) = setup();
        assert_eq!(client.get_petition(&42), None);
    }
}
```

- [ ] **Step 3: Run tests, verify RED**

Run: `cargo test -p nido-petitions`
Expected: FAIL — `create_and_get`, `create_emits_event`, `ids_increment`, and the validation tests panic with `not implemented`; `get_missing_returns_none` passes.

- [ ] **Step 4: Implement `create_petition`**

Replace the `unimplemented!()` body:

```rust
    pub fn create_petition(
        e: &Env,
        creator: &Address,
        title: &String,
        body: &String,
        goal: &Option<u32>,
        deadline: &Option<u32>,
    ) -> Result<u32, PetitionError> {
        creator.require_auth();
        if title.len() == 0 || title.len() > TITLE_MAX {
            return Err(PetitionError::TitleInvalid);
        }
        if body.len() == 0 || body.len() > BODY_MAX {
            return Err(PetitionError::BodyInvalid);
        }
        let current = e.ledger().sequence();
        if let Some(d) = deadline {
            if *d <= current {
                return Err(PetitionError::DeadlineInPast);
            }
        }
        let registry = Registry::new(e);
        let id = registry.count.get().unwrap_or(0);
        let petition = Petition {
            creator: creator.clone(),
            title: title.clone(),
            body: body.clone(),
            goal: *goal,
            deadline: *deadline,
            sig_count: 0,
            created_ledger: current,
        };
        registry.petitions.set(&id, &petition);
        registry.petitions.extend_ttl(&id, TTL_LEDGERS, TTL_LEDGERS);
        registry.count.set(&(id + 1));
        PetitionCreated { id: &id, creator }.publish(e);
        Ok(id)
    }
```

Note: if `#[contractstorage]` rejects the tuple keys `(u32, Address)` / `(u32, u32)` at compile time, replace them with `#[contracttype]` key structs `SigKey { id: u32, signer: Address }` and `IdxKey { id: u32, index: u32 }` and update all uses in tasks 2–3 accordingly — the external API does not change.

- [ ] **Step 5: Run tests, verify GREEN**

Run: `cargo test -p nido-petitions`
Expected: PASS (8 tests).

- [ ] **Step 6: Lint + format**

Run: `cargo fmt --all && cargo clippy -p nido-petitions --tests -- -Dclippy::pedantic`
Expected: clean. Fix any pedantic findings (typical: add `#[must_use]` where suggested, avoid `needless_pass_by_value` — signatures already take references).

- [ ] **Step 7: Commit**

```bash
git add contracts/petitions
git commit -m "feat(petitions): create/read with typed errors and events"
```

---

### Task 2: `petitions` — sign + has_signed

**Files:**
- Modify: `contracts/petitions/src/contract.rs`

**Interfaces:**
- Consumes: Task 1's `Registry`, `Petition`, `PetitionError`, `PetitionSigned`.
- Produces:
  - `sign(e: &Env, id: u32, signer: &Address) -> Result<(), PetitionError>`
  - `has_signed(e: &Env, id: u32, addr: &Address) -> bool`

- [ ] **Step 1: Add failing tests to the test module**

```rust
    #[test]
    fn sign_happy_path() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let signer = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );

        assert!(!client.has_signed(&id, &signer));
        client.sign(&id, &signer);
        assert!(client.has_signed(&id, &signer));
        assert_eq!(client.get_petition(&id).unwrap().sig_count, 1);
    }

    #[test]
    fn sign_emits_event() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let signer = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        client.sign(&id, &signer);
        assert_eq!(env.events().all().events().len(), 1);
    }

    #[test]
    fn sign_unknown_petition() {
        let (env, client) = setup();
        let signer = Address::generate(&env);
        assert_eq!(client.try_sign(&99, &signer), Err(Ok(PetitionError::NotFound)));
    }

    #[test]
    fn double_sign_rejected() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let signer = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        client.sign(&id, &signer);
        assert_eq!(
            client.try_sign(&id, &signer),
            Err(Ok(PetitionError::AlreadySigned))
        );
        assert_eq!(client.get_petition(&id).unwrap().sig_count, 1);
    }

    #[test]
    fn sign_at_and_after_deadline_rejected() {
        let (env, client) = setup();
        env.ledger().with_mut(|l| l.sequence_number = 1000);
        let creator = Address::generate(&env);
        let signer = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &Some(1010),
        );

        // strictly before deadline: OK
        env.ledger().with_mut(|l| l.sequence_number = 1009);
        client.sign(&id, &signer);

        // at deadline: rejected
        let late = Address::generate(&env);
        env.ledger().with_mut(|l| l.sequence_number = 1010);
        assert_eq!(client.try_sign(&id, &late), Err(Ok(PetitionError::Expired)));

        // after deadline: rejected
        env.ledger().with_mut(|l| l.sequence_number = 2000);
        assert_eq!(client.try_sign(&id, &late), Err(Ok(PetitionError::Expired)));
    }

    #[test]
    fn distinct_signers_counted() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        for _ in 0..3 {
            client.sign(&id, &Address::generate(&env));
        }
        assert_eq!(client.get_petition(&id).unwrap().sig_count, 3);
    }
```

- [ ] **Step 2: Run tests, verify RED**

Run: `cargo test -p nido-petitions`
Expected: compile FAILS — `sign`/`has_signed`/`try_sign` do not exist yet.

- [ ] **Step 3: Implement**

Add to the `#[contractimpl]` block:

```rust
    pub fn sign(e: &Env, id: u32, signer: &Address) -> Result<(), PetitionError> {
        signer.require_auth();
        let registry = Registry::new(e);
        let mut petition = registry.petitions.get(&id).ok_or(PetitionError::NotFound)?;
        if let Some(d) = petition.deadline {
            if e.ledger().sequence() >= d {
                return Err(PetitionError::Expired);
            }
        }
        if registry.signatures.get(&(id, signer.clone())).is_some() {
            return Err(PetitionError::AlreadySigned);
        }
        registry.signatures.set(&(id, signer.clone()), &());
        registry.signer_by_index.set(&(id, petition.sig_count), signer);
        petition.sig_count += 1;
        registry.petitions.set(&id, &petition);
        registry.petitions.extend_ttl(&id, TTL_LEDGERS, TTL_LEDGERS);
        PetitionSigned { id: &id, signer }.publish(e);
        Ok(())
    }

    pub fn has_signed(e: &Env, id: u32, addr: &Address) -> bool {
        Registry::new(e)
            .signatures
            .get(&(id, addr.clone()))
            .is_some()
    }
```

- [ ] **Step 4: Run tests, verify GREEN**

Run: `cargo test -p nido-petitions`
Expected: PASS (14 tests).

- [ ] **Step 5: Lint, format, commit**

```bash
cargo fmt --all && cargo clippy -p nido-petitions --tests -- -Dclippy::pedantic
git add contracts/petitions
git commit -m "feat(petitions): sign with dedupe, deadline enforcement, event"
```

---

### Task 3: `petitions` — signer pagination + extend_ttl

**Files:**
- Modify: `contracts/petitions/src/contract.rs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `get_signers(e: &Env, id: u32, start: u32, limit: u32) -> Vec<Address>`
  - `extend_ttl(e: &Env, id: u32) -> Result<(), PetitionError>`

- [ ] **Step 1: Add failing tests**

```rust
    #[test]
    fn signer_pagination() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        let mut signers = soroban_sdk::Vec::new(&env);
        for _ in 0..5 {
            let s = Address::generate(&env);
            client.sign(&id, &s);
            signers.push_back(s);
        }

        // full page, insertion order
        assert_eq!(client.get_signers(&id, &0, &10), signers);
        // partial pages
        assert_eq!(client.get_signers(&id, &0, &2).len(), 2);
        assert_eq!(client.get_signers(&id, &4, &2).len(), 1);
        assert_eq!(client.get_signers(&id, &0, &2).get(0), signers.get(0));
        assert_eq!(client.get_signers(&id, &2, &2).get(0), signers.get(2));
        // start past end / zero limit / unknown petition
        assert_eq!(client.get_signers(&id, &5, &2).len(), 0);
        assert_eq!(client.get_signers(&id, &0, &0).len(), 0);
        assert_eq!(client.get_signers(&99, &0, &10).len(), 0);
    }

    #[test]
    fn extend_ttl_requires_existing() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        client.extend_ttl(&id); // no panic
        assert_eq!(client.try_extend_ttl(&99), Err(Ok(PetitionError::NotFound)));
    }
```

- [ ] **Step 2: Run tests, verify RED**

Run: `cargo test -p nido-petitions`
Expected: compile FAIL — `get_signers`/`extend_ttl` missing.

- [ ] **Step 3: Implement**

```rust
    pub fn get_signers(e: &Env, id: u32, start: u32, limit: u32) -> Vec<Address> {
        let registry = Registry::new(e);
        let mut out = Vec::new(e);
        if let Some(p) = registry.petitions.get(&id) {
            let end = start.saturating_add(limit).min(p.sig_count);
            for i in start..end {
                if let Some(a) = registry.signer_by_index.get(&(id, i)) {
                    out.push_back(a);
                }
            }
        }
        out
    }

    pub fn extend_ttl(e: &Env, id: u32) -> Result<(), PetitionError> {
        let registry = Registry::new(e);
        if registry.petitions.get(&id).is_none() {
            return Err(PetitionError::NotFound);
        }
        registry.petitions.extend_ttl(&id, TTL_LEDGERS, TTL_LEDGERS);
        Ok(())
    }
```

- [ ] **Step 4: Run tests, verify GREEN**

Run: `cargo test -p nido-petitions`
Expected: PASS (16 tests).

- [ ] **Step 5: Lint, format, commit**

```bash
cargo fmt --all && cargo clippy -p nido-petitions --tests -- -Dclippy::pedantic
git add contracts/petitions
git commit -m "feat(petitions): paginated signer enumeration and public extend_ttl"
```

---

### Task 4: `web-of-trust` crate — vouch/revoke/views

**Files:**
- Create: `contracts/web-of-trust/Cargo.toml`
- Create: `contracts/web-of-trust/src/lib.rs`
- Create: `contracts/web-of-trust/src/contract.rs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub enum TrustError { SelfVouch = 1, AlreadyVouched = 2, VouchNotFound = 3, PreVouchExists = 4, PreVouchNotFound = 5, PreVouchExpired = 6, InvalidMaxClaims = 7, ExpiryInPast = 8 }` (declare ALL variants now; tasks 5–6 use the pre-vouch ones)
  - `vouch(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError>`
  - `revoke(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError>`
  - `vouches_given(e: &Env, a: &Address) -> Vec<Address>`
  - `vouches_received(e: &Env, a: &Address) -> Vec<Address>`
  - `has_vouched(e: &Env, from: &Address, to: &Address) -> bool`
  - `extend_ttl(e: &Env, a: &Address)`
  - Internal `fn add_edge(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError>` — Task 6's `claim_vouch` reuses it.
  - Storage struct `Graph { given, received, pre_vouches }` (declare `pre_vouches` now).
  - `pub struct PreVouch { from: Address, expires: Option<u32>, max_claims: u32, claims: u32 }` (declared now, used in tasks 5–6).

- [ ] **Step 1: Crate scaffold**

`contracts/web-of-trust/Cargo.toml`:

```toml
[package]
name = "nido-web-of-trust"
version.workspace = true
edition.workspace = true
license.workspace = true
publish = false

[package.metadata.stellar]
contract = true

[lib]
crate-type = ["cdylib"]
doctest = false

[dependencies]
soroban-sdk = { workspace = true }
soroban-sdk-tools = { workspace = true }

[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
ed25519-dalek = "2"
```

`contracts/web-of-trust/src/lib.rs`:

```rust
#![no_std]
#![allow(dead_code)]

mod contract;
```

- [ ] **Step 2: Types, storage, skeleton, failing tests**

`contracts/web-of-trust/src/contract.rs`:

```rust
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN,
    Env, Vec,
};
use soroban_sdk_tools::{contractstorage, PersistentMap};

const TTL_LEDGERS: u32 = 518_400; // ~30 days of ledgers
const CLAIM_DOMAIN: &[u8] = b"adsum:claim_vouch";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TrustError {
    SelfVouch = 1,
    AlreadyVouched = 2,
    VouchNotFound = 3,
    PreVouchExists = 4,
    PreVouchNotFound = 5,
    PreVouchExpired = 6,
    InvalidMaxClaims = 7,
    ExpiryInPast = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreVouch {
    pub from: Address,
    pub expires: Option<u32>,
    pub max_claims: u32,
    pub claims: u32,
}

#[contractevent(topics = ["vouched"], data_format = "map")]
pub struct Vouched<'a> {
    #[topic]
    pub from: &'a Address,
    pub to: &'a Address,
}

#[contractevent(topics = ["vouch_revoked"], data_format = "map")]
pub struct VouchRevoked<'a> {
    #[topic]
    pub from: &'a Address,
    pub to: &'a Address,
}

#[contractevent(topics = ["pre_vouch_created"], data_format = "map")]
pub struct PreVouchCreated<'a> {
    #[topic]
    pub key: &'a BytesN<32>,
    pub from: &'a Address,
}

#[contractevent(topics = ["vouch_claimed"], data_format = "map")]
pub struct VouchClaimed<'a> {
    #[topic]
    pub key: &'a BytesN<32>,
    pub from: &'a Address,
    pub to: &'a Address,
}

#[contractstorage]
pub struct Graph {
    given: PersistentMap<Address, Vec<Address>>,
    received: PersistentMap<Address, Vec<Address>>,
    pre_vouches: PersistentMap<BytesN<32>, PreVouch>,
}

#[contract]
pub struct Contract;

fn add_edge(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError> {
    let _ = (e, from, to);
    unimplemented!()
}

#[contractimpl]
impl Contract {
    pub fn vouch(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError> {
        from.require_auth();
        add_edge(e, from, to)
    }

    pub fn revoke(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError> {
        let _ = (e, from, to);
        unimplemented!()
    }

    pub fn vouches_given(e: &Env, a: &Address) -> Vec<Address> {
        Graph::new(e).given.get(a).unwrap_or_else(|| Vec::new(e))
    }

    pub fn vouches_received(e: &Env, a: &Address) -> Vec<Address> {
        Graph::new(e).received.get(a).unwrap_or_else(|| Vec::new(e))
    }

    pub fn has_vouched(e: &Env, from: &Address, to: &Address) -> bool {
        Graph::new(e)
            .given
            .get(from)
            .is_some_and(|v| v.contains(to))
    }

    pub fn extend_ttl(e: &Env, a: &Address) {
        let graph = Graph::new(e);
        if graph.given.get(a).is_some() {
            graph.given.extend_ttl(a, TTL_LEDGERS, TTL_LEDGERS);
        }
        if graph.received.get(a).is_some() {
            graph.received.extend_ttl(a, TTL_LEDGERS, TTL_LEDGERS);
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
    use soroban_sdk::Env;

    fn setup() -> (Env, ContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Contract, ());
        let client = ContractClient::new(&env, &id);
        (env, client)
    }

    #[test]
    fn vouch_and_views() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        assert!(!client.has_vouched(&a, &b));
        client.vouch(&a, &b);
        assert!(client.has_vouched(&a, &b));
        assert!(!client.has_vouched(&b, &a));
        assert_eq!(client.vouches_given(&a).len(), 1);
        assert_eq!(client.vouches_given(&a).get(0), Some(b.clone()));
        assert_eq!(client.vouches_received(&b).len(), 1);
        assert_eq!(client.vouches_received(&b).get(0), Some(a.clone()));
        assert_eq!(client.vouches_given(&b).len(), 0);
        assert_eq!(client.vouches_received(&a).len(), 0);
    }

    #[test]
    fn vouch_emits_event() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        client.vouch(&a, &b);
        assert_eq!(env.events().all().events().len(), 1);
    }

    #[test]
    fn self_vouch_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        assert_eq!(client.try_vouch(&a, &a), Err(Ok(TrustError::SelfVouch)));
    }

    #[test]
    fn duplicate_vouch_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        client.vouch(&a, &b);
        assert_eq!(client.try_vouch(&a, &b), Err(Ok(TrustError::AlreadyVouched)));
    }

    #[test]
    fn revoke_removes_both_directions() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        client.vouch(&a, &b);
        client.vouch(&a, &c);
        client.vouch(&c, &b);

        client.revoke(&a, &b);

        assert!(!client.has_vouched(&a, &b));
        assert_eq!(client.vouches_given(&a).len(), 1);
        assert_eq!(client.vouches_given(&a).get(0), Some(c.clone()));
        assert_eq!(client.vouches_received(&b).len(), 1);
        assert_eq!(client.vouches_received(&b).get(0), Some(c.clone()));
        // re-vouch after revoke works
        client.vouch(&a, &b);
        assert!(client.has_vouched(&a, &b));
    }

    #[test]
    fn revoke_nonexistent_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        assert_eq!(client.try_revoke(&a, &b), Err(Ok(TrustError::VouchNotFound)));
    }
}
```

- [ ] **Step 3: Run tests, verify RED**

Run: `cargo test -p nido-web-of-trust`
Expected: FAIL — `not implemented` panics from `add_edge`/`revoke`.

- [ ] **Step 4: Implement `add_edge` and `revoke`**

```rust
fn add_edge(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError> {
    if from == to {
        return Err(TrustError::SelfVouch);
    }
    let graph = Graph::new(e);
    let mut given = graph.given.get(from).unwrap_or_else(|| Vec::new(e));
    if given.contains(to) {
        return Err(TrustError::AlreadyVouched);
    }
    given.push_back(to.clone());
    graph.given.set(from, &given);
    graph.given.extend_ttl(from, TTL_LEDGERS, TTL_LEDGERS);

    let mut received = graph.received.get(to).unwrap_or_else(|| Vec::new(e));
    received.push_back(from.clone());
    graph.received.set(to, &received);
    graph.received.extend_ttl(to, TTL_LEDGERS, TTL_LEDGERS);

    Vouched { from, to }.publish(e);
    Ok(())
}
```

```rust
    pub fn revoke(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError> {
        from.require_auth();
        let graph = Graph::new(e);
        let mut given = graph.given.get(from).unwrap_or_else(|| Vec::new(e));
        let Some(gi) = given.first_index_of(to) else {
            return Err(TrustError::VouchNotFound);
        };
        given.remove(gi);
        graph.given.set(from, &given);

        let mut received = graph.received.get(to).unwrap_or_else(|| Vec::new(e));
        if let Some(ri) = received.first_index_of(from) {
            received.remove(ri);
            graph.received.set(to, &received);
        }

        VouchRevoked { from, to }.publish(e);
        Ok(())
    }
```

- [ ] **Step 5: Run tests, verify GREEN**

Run: `cargo test -p nido-web-of-trust`
Expected: PASS (6 tests).

- [ ] **Step 6: Lint, format, commit**

```bash
cargo fmt --all && cargo clippy -p nido-web-of-trust --tests -- -Dclippy::pedantic
git add contracts/web-of-trust
git commit -m "feat(web-of-trust): directed revocable vouch edges with events"
```

---

### Task 5: `web-of-trust` — pre-vouch create/revoke/read

**Files:**
- Modify: `contracts/web-of-trust/src/contract.rs`

**Interfaces:**
- Consumes: Task 4's `Graph`, `PreVouch`, `TrustError`, `PreVouchCreated`.
- Produces:
  - `pre_vouch(e: &Env, from: &Address, key: &BytesN<32>, expires: &Option<u32>, max_claims: u32) -> Result<(), TrustError>`
  - `revoke_pre_vouch(e: &Env, from: &Address, key: &BytesN<32>) -> Result<(), TrustError>`
  - `get_pre_vouch(e: &Env, key: &BytesN<32>) -> Option<PreVouch>`

- [ ] **Step 1: Add failing tests**

```rust
    #[test]
    fn pre_vouch_create_and_get() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);

        assert_eq!(client.get_pre_vouch(&key), None);
        client.pre_vouch(&a, &key, &None, &3);
        let pv = client.get_pre_vouch(&key).unwrap();
        assert_eq!(pv.from, a);
        assert_eq!(pv.expires, None);
        assert_eq!(pv.max_claims, 3);
        assert_eq!(pv.claims, 0);
        assert_eq!(env.events().all().events().len(), 1);
    }

    #[test]
    fn pre_vouch_duplicate_key_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);
        client.pre_vouch(&a, &key, &None, &1);
        assert_eq!(
            client.try_pre_vouch(&a, &key, &None, &1),
            Err(Ok(TrustError::PreVouchExists))
        );
    }

    #[test]
    fn pre_vouch_zero_claims_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_pre_vouch(&a, &key, &None, &0),
            Err(Ok(TrustError::InvalidMaxClaims))
        );
    }

    #[test]
    fn pre_vouch_expiry_must_be_future() {
        let (env, client) = setup();
        env.ledger().with_mut(|l| l.sequence_number = 1000);
        let a = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_pre_vouch(&a, &key, &Some(1000), &1),
            Err(Ok(TrustError::ExpiryInPast))
        );
        client.pre_vouch(&a, &key, &Some(1001), &1);
    }

    #[test]
    fn revoke_pre_vouch() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let stranger = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);
        client.pre_vouch(&a, &key, &None, &1);

        // non-creator cannot revoke (no creator leak: same NotFound error)
        assert_eq!(
            client.try_revoke_pre_vouch(&stranger, &key),
            Err(Ok(TrustError::PreVouchNotFound))
        );

        client.revoke_pre_vouch(&a, &key);
        assert_eq!(client.get_pre_vouch(&key), None);
        assert_eq!(
            client.try_revoke_pre_vouch(&a, &key),
            Err(Ok(TrustError::PreVouchNotFound))
        );
    }
```

- [ ] **Step 2: Run tests, verify RED**

Run: `cargo test -p nido-web-of-trust`
Expected: compile FAIL — the three functions do not exist.

- [ ] **Step 3: Implement**

Add to the `#[contractimpl]` block:

```rust
    pub fn pre_vouch(
        e: &Env,
        from: &Address,
        key: &BytesN<32>,
        expires: &Option<u32>,
        max_claims: u32,
    ) -> Result<(), TrustError> {
        from.require_auth();
        if max_claims == 0 {
            return Err(TrustError::InvalidMaxClaims);
        }
        if let Some(x) = expires {
            if *x <= e.ledger().sequence() {
                return Err(TrustError::ExpiryInPast);
            }
        }
        let graph = Graph::new(e);
        if graph.pre_vouches.get(key).is_some() {
            return Err(TrustError::PreVouchExists);
        }
        let pv = PreVouch {
            from: from.clone(),
            expires: *expires,
            max_claims,
            claims: 0,
        };
        graph.pre_vouches.set(key, &pv);
        graph.pre_vouches.extend_ttl(key, TTL_LEDGERS, TTL_LEDGERS);
        PreVouchCreated { key, from }.publish(e);
        Ok(())
    }

    pub fn revoke_pre_vouch(e: &Env, from: &Address, key: &BytesN<32>) -> Result<(), TrustError> {
        from.require_auth();
        let graph = Graph::new(e);
        let pv = graph
            .pre_vouches
            .get(key)
            .ok_or(TrustError::PreVouchNotFound)?;
        if pv.from != *from {
            return Err(TrustError::PreVouchNotFound);
        }
        graph.pre_vouches.remove(key);
        Ok(())
    }

    pub fn get_pre_vouch(e: &Env, key: &BytesN<32>) -> Option<PreVouch> {
        Graph::new(e).pre_vouches.get(key)
    }
```

- [ ] **Step 4: Run tests, verify GREEN**

Run: `cargo test -p nido-web-of-trust`
Expected: PASS (11 tests).

- [ ] **Step 5: Lint, format, commit**

```bash
cargo fmt --all && cargo clippy -p nido-web-of-trust --tests -- -Dclippy::pedantic
git add contracts/web-of-trust
git commit -m "feat(web-of-trust): pre-vouch invites (create/revoke/read)"
```

---

### Task 6: `web-of-trust` — claim_vouch (ed25519)

**Files:**
- Modify: `contracts/web-of-trust/src/contract.rs`

**Interfaces:**
- Consumes: Task 4's `add_edge`, Task 5's `PreVouch` storage, `VouchClaimed` event.
- Produces:
  - `claim_vouch(e: &Env, key: &BytesN<32>, to: &Address, sig: &BytesN<64>) -> Result<(), TrustError>` — NO `require_auth`; the ed25519 signature over the domain-separated payload IS the authorization. Invalid signature TRAPS (host error), it does not return a typed error.
  - `pub fn claim_payload_for(e: &Env, contract: &Address, to: &Address) -> Bytes` — payload builder, public so tests (and the later dapp parity fixture) can call it: `contract.to_xdr(e) || "adsum:claim_vouch" || to.to_xdr(e)`.

- [ ] **Step 1: Add failing tests**

Test-side signing uses `ed25519-dalek` (dev-dependency added in Task 4). The dapp will later reproduce this payload in TS, so one test pins the payload bytes against fixed inputs via `register_at`.

```rust
    // -- claim_vouch tests --

    fn dalek_key(seed: u8) -> ed25519_dalek::SigningKey {
        ed25519_dalek::SigningKey::from_bytes(&[seed; 32])
    }

    /// Creates a pre-vouch for `from` under `signing_key`'s pubkey and returns
    /// (key, valid signature over `to`).
    fn make_invite(
        env: &Env,
        client: &ContractClient<'static>,
        from: &Address,
        to: &Address,
        signing_key: &ed25519_dalek::SigningKey,
        expires: Option<u32>,
        max_claims: u32,
    ) -> (BytesN<32>, BytesN<64>) {
        use ed25519_dalek::Signer as _;
        let key = BytesN::from_array(env, &signing_key.verifying_key().to_bytes());
        client.pre_vouch(from, &key, &expires, &max_claims);
        let payload = Contract::claim_payload_for(env, &client.address, to);
        let mut buf = [0u8; 1024];
        let len = payload.len() as usize;
        payload.copy_into_slice(&mut buf[..len]);
        let sig = signing_key.sign(&buf[..len]);
        (key, BytesN::from_array(env, &sig.to_bytes()))
    }

    #[test]
    fn claim_happy_path() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 2);

        client.claim_vouch(&key, &bob, &sig);

        assert!(client.has_vouched(&alice, &bob));
        assert_eq!(client.get_pre_vouch(&key).unwrap().claims, 1);
    }

    #[test]
    fn claim_deletes_entry_at_cap() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 1);

        client.claim_vouch(&key, &bob, &sig);

        assert_eq!(client.get_pre_vouch(&key), None);
        // further claims fail as NotFound (exhausted)
        let carol = Address::generate(&env);
        let (_k2, sig2) = {
            use ed25519_dalek::Signer as _;
            let payload = Contract::claim_payload_for(&env, &client.address, &carol);
            let mut buf = [0u8; 1024];
            let len = payload.len() as usize;
            payload.copy_into_slice(&mut buf[..len]);
            let sig = sk.sign(&buf[..len]);
            (key.clone(), BytesN::from_array(&env, &sig.to_bytes()))
        };
        assert_eq!(
            client.try_claim_vouch(&key, &carol, &sig2),
            Err(Ok(TrustError::PreVouchNotFound))
        );
    }

    #[test]
    fn claim_repeat_by_same_account_rejected() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 5);

        client.claim_vouch(&key, &bob, &sig);
        assert_eq!(
            client.try_claim_vouch(&key, &bob, &sig),
            Err(Ok(TrustError::AlreadyVouched))
        );
        // counter not consumed by the failed claim
        assert_eq!(client.get_pre_vouch(&key).unwrap().claims, 1);
    }

    #[test]
    fn claim_by_creator_rejected() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &alice, &sk, None, 1);
        assert_eq!(
            client.try_claim_vouch(&key, &alice, &sig),
            Err(Ok(TrustError::SelfVouch))
        );
    }

    #[test]
    fn claim_expired_rejected() {
        let (env, client) = setup();
        env.ledger().with_mut(|l| l.sequence_number = 1000);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, Some(1500), 1);

        env.ledger().with_mut(|l| l.sequence_number = 1500);
        assert_eq!(
            client.try_claim_vouch(&key, &bob, &sig),
            Err(Ok(TrustError::PreVouchExpired))
        );
    }

    #[test]
    #[should_panic] // host trap from ed25519_verify, not a typed error
    fn claim_with_wrong_signature_traps() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        let sk = dalek_key(7);
        // signature binds to bob; submitting for carol must trap
        let (key, sig_for_bob) = make_invite(&env, &client, &alice, &bob, &sk, None, 1);
        client.claim_vouch(&key, &carol, &sig_for_bob);
    }

    #[test]
    #[should_panic] // signature from a different secret key
    fn claim_with_wrong_key_traps() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, _sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 1);
        use ed25519_dalek::Signer as _;
        let other = dalek_key(9);
        let payload = Contract::claim_payload_for(&env, &client.address, &bob);
        let mut buf = [0u8; 1024];
        let len = payload.len() as usize;
        payload.copy_into_slice(&mut buf[..len]);
        let bad = other.sign(&buf[..len]);
        client.claim_vouch(&key, &bob, &BytesN::from_array(&env, &bad.to_bytes()));
    }

    #[test]
    fn claim_emits_vouched_and_claimed_events() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 1);
        client.claim_vouch(&key, &bob, &sig);
        // add_edge publishes Vouched, claim_vouch publishes VouchClaimed
        assert_eq!(env.events().all().events().len(), 2);
    }
```

Note the tests call `Contract::claim_payload_for` as a plain associated function — declare it OUTSIDE the `#[contractimpl]` block (plain `impl Contract`) so it is not exported as a contract entry point but still callable from tests:

- [ ] **Step 2: Run tests, verify RED**

Run: `cargo test -p nido-web-of-trust`
Expected: compile FAIL — `claim_vouch` / `claim_payload_for` missing.

- [ ] **Step 3: Implement**

```rust
use soroban_sdk::xdr::ToXdr;

impl Contract {
    /// Builds the domain-separated claim payload signed by the invite secret:
    /// `contract.to_xdr || "adsum:claim_vouch" || to.to_xdr`. The dapp
    /// reproduces these bytes in TypeScript; keep them stable.
    pub fn claim_payload_for(e: &Env, contract: &Address, to: &Address) -> Bytes {
        let mut payload = contract.clone().to_xdr(e);
        payload.append(&Bytes::from_slice(e, CLAIM_DOMAIN));
        payload.append(&to.clone().to_xdr(e));
        payload
    }
}
```

Add to the `#[contractimpl]` block:

```rust
    pub fn claim_vouch(
        e: &Env,
        key: &BytesN<32>,
        to: &Address,
        sig: &BytesN<64>,
    ) -> Result<(), TrustError> {
        let graph = Graph::new(e);
        let mut pv = graph
            .pre_vouches
            .get(key)
            .ok_or(TrustError::PreVouchNotFound)?;
        if let Some(x) = pv.expires {
            if e.ledger().sequence() >= x {
                return Err(TrustError::PreVouchExpired);
            }
        }
        // The signature is the authorization: it binds this claim to `to`,
        // so an observed claim tx cannot be replayed for another address.
        // ed25519_verify TRAPS on an invalid signature (host error).
        let payload = Self::claim_payload_for(e, &e.current_contract_address(), to);
        e.crypto().ed25519_verify(key, &payload, sig);

        add_edge(e, &pv.from.clone(), to)?;

        pv.claims += 1;
        if pv.claims >= pv.max_claims {
            graph.pre_vouches.remove(key);
        } else {
            graph.pre_vouches.set(key, &pv);
        }
        VouchClaimed {
            key,
            from: &pv.from,
            to,
        }
        .publish(e);
        Ok(())
    }
```

- [ ] **Step 4: Run tests, verify GREEN**

Run: `cargo test -p nido-web-of-trust`
Expected: PASS (19 tests: 11 prior + 8 new).

- [ ] **Step 5: Lint, format, commit**

```bash
cargo fmt --all && cargo clippy -p nido-web-of-trust --tests -- -Dclippy::pedantic
git add contracts/web-of-trust
git commit -m "feat(web-of-trust): ed25519 pre-vouch claims with claim cap"
```

---

### Task 7: Integration tests — petitions (wasm + real smart-account auth)

**Files:**
- Create: `crates/integration-tests/tests/it/petitions.rs`
- Modify: `crates/integration-tests/tests/it/main.rs` (add `mod petitions;` in alphabetical position)

**Interfaces:**
- Consumes: `nido_integration_tests::{build_contract_assertion, compute_auth_digest, deploy_smart_account}` (exact usage model: `crates/integration-tests/tests/it/name_registry_passkey_auth.rs`); petitions contract API from tasks 1–3.
- Produces: nothing downstream; commits `test_snapshots/`.

- [ ] **Step 1: Build contract wasm**

Run: `just build-contracts`
Expected: `target/wasm32v1-none/contract/nido_petitions.wasm` and `nido_web_of_trust.wasm` exist. (stellar-scaffold picks the new crates up via the `contracts/*` workspace glob + `[package.metadata.stellar] contract = true`.)

- [ ] **Step 2: Write the integration test**

`crates/integration-tests/tests/it/petitions.rs`:

```rust
//! Wasm-level tests for `contracts/petitions`, including one REAL-auth-path
//! test that signs a petition through a deployed smart account with a
//! synthetic passkey assertion (no `mock_all_auths`) — the "bug #3" lesson:
//! mock-only suites never exercise `__check_auth`.

use nido_integration_tests::{build_contract_assertion, compute_auth_digest, deploy_smart_account};
use soroban_sdk::xdr::ToXdr as _;
use soroban_sdk::xdr::{
    Hash, HashIdPreimage, HashIdPreimageSorobanAuthorization, InvokeContractArgs, Limits, ScAddress,
    ScSymbol, ScVal, SorobanAddressCredentials, SorobanAuthorizationEntry,
    SorobanAuthorizedFunction, SorobanAuthorizedInvocation, SorobanCredentials, VecM, WriteXdr,
};
use soroban_sdk::{Bytes, Env, IntoVal, Map, String, TryFromVal, Val};
use stellar_accounts::smart_account::{AuthPayload, Signer};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

const PETITIONS_WASM: &[u8] =
    include_bytes!("../../../../target/wasm32v1-none/contract/nido_petitions.wasm");

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "PetitionsClient")]
trait PetitionsInterface {
    fn create_petition(
        env: soroban_sdk::Env,
        creator: soroban_sdk::Address,
        title: String,
        body: String,
        goal: Option<u32>,
        deadline: Option<u32>,
    ) -> u32;
    fn sign(env: soroban_sdk::Env, id: u32, signer: soroban_sdk::Address);
    fn has_signed(env: soroban_sdk::Env, id: u32, addr: soroban_sdk::Address) -> bool;
    fn get_signers(
        env: soroban_sdk::Env,
        id: u32,
        start: u32,
        limit: u32,
    ) -> soroban_sdk::Vec<soroban_sdk::Address>;
    fn petition_count(env: soroban_sdk::Env) -> u32;
}

/// Happy-path CRUD through the real wasm under mocked auth.
#[test]
fn petitions_wasm_crud() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PETITIONS_WASM, ());
    let client = PetitionsClient::new(&env, &id);

    use soroban_sdk::testutils::Address as _;
    let creator = soroban_sdk::Address::generate(&env);
    let signer = soroban_sdk::Address::generate(&env);

    let pid = client.create_petition(
        &creator,
        &String::from_str(&env, "Fix the bridge"),
        &String::from_str(&env, "It wobbles."),
        &Some(10),
        &None,
    );
    assert_eq!(pid, 0);
    assert_eq!(client.petition_count(), 1);

    client.sign(&pid, &signer);
    assert!(client.has_signed(&pid, &signer));
    assert_eq!(client.get_signers(&pid, &0, &10).len(), 1);
}

/// Sign a petition through the smart account via the REAL host auth path:
/// hand-built `SorobanAuthorizationEntry`, synthetic WebAuthn assertion,
/// `env.set_auths` in enforcing mode. Two sequential entries: the smart
/// account first creates the petition, then signs it.
#[test]
fn sign_petition_with_real_passkey_auth() {
    let env = Env::default();
    let (_sa_client, account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let petitions_addr = env.register(PETITIONS_WASM, ());
    let client = PetitionsClient::new(&env, &petitions_addr);

    let title = String::from_str(&env, "Open the commons");
    let body = String::from_str(&env, "We ask for public access.");

    // --- entry 1: create_petition(account, title, body, None, None) ---
    let title_val: Val = title.clone().into_val(&env);
    let body_val: Val = body.clone().into_val(&env);
    let none_u32: Option<u32> = None;
    let none_val: Val = none_u32.into_val(&env);
    let create_args: VecM<ScVal> = std::vec![
        ScVal::Address(ScAddress::from(&account_addr)),
        ScVal::try_from_val(&env, &title_val).unwrap(),
        ScVal::try_from_val(&env, &body_val).unwrap(),
        ScVal::try_from_val(&env, &none_val).unwrap(),
        ScVal::try_from_val(&env, &none_val).unwrap(),
    ]
    .try_into()
    .unwrap();
    let create_entry = build_entry(
        &env,
        &account_addr,
        &verifier_addr,
        &signing_key,
        &petitions_addr,
        "create_petition",
        create_args,
        0xCA01,
    );
    env.set_auths(&[create_entry]);
    let pid = client.create_petition(&account_addr, &title, &body, &None, &None);
    assert_eq!(pid, 0);

    // --- entry 2: sign(0, account) ---
    let sign_args: VecM<ScVal> = std::vec![
        ScVal::U32(0),
        ScVal::Address(ScAddress::from(&account_addr)),
    ]
    .try_into()
    .unwrap();
    let sign_entry = build_entry(
        &env,
        &account_addr,
        &verifier_addr,
        &signing_key,
        &petitions_addr,
        "sign",
        sign_args,
        0xCA02,
    );
    env.set_auths(&[sign_entry]);
    client.sign(&0, &account_addr);

    assert!(client.has_signed(&0, &account_addr));
}

/// Builds a real `SorobanAuthorizationEntry` for `contract.fn_name(args)`
/// authorized by the smart account's synthetic passkey (Default rule id 0).
/// Model: `name_registry_passkey_auth.rs`.
#[allow(clippy::too_many_arguments)]
fn build_entry(
    env: &Env,
    account_addr: &soroban_sdk::Address,
    verifier_addr: &soroban_sdk::Address,
    signing_key: &p256::ecdsa::SigningKey,
    contract_addr: &soroban_sdk::Address,
    fn_name: &str,
    args: VecM<ScVal>,
    nonce: i64,
) -> SorobanAuthorizationEntry {
    let invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: ScAddress::from(contract_addr),
            function_name: ScSymbol(fn_name.try_into().unwrap()),
            args,
        }),
        sub_invocations: VecM::default(),
    };

    let signature_expiration_ledger: u32 = 999_999;
    let network_id = Hash(env.ledger().network_id().to_array());
    let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id,
        nonce,
        signature_expiration_ledger,
        invocation: invocation.clone(),
    });
    let preimage_bytes = preimage.to_xdr(Limits::none()).unwrap();
    let signature_payload = env
        .crypto()
        .sha256(&Bytes::from_slice(env, &preimage_bytes));

    let context_rule_ids = soroban_sdk::vec![env, 0u32];
    let auth_digest = compute_auth_digest(env, &signature_payload, &context_rule_ids);
    let assertion = build_contract_assertion(signing_key, env, &auth_digest);

    let sig_data = WebAuthnSigData {
        signature: assertion.signature,
        authenticator_data: assertion.authenticator_data,
        client_data: assertion.client_data,
    };
    let pubkey_sec1 = signing_key.verifying_key().to_sec1_bytes();
    let signer = Signer::External(
        verifier_addr.clone(),
        soroban_sdk::Bytes::from_slice(env, &pubkey_sec1),
    );
    let mut sig_map: Map<Signer, Bytes> = Map::new(env);
    sig_map.set(signer, sig_data.to_xdr(env));
    let auth_payload = AuthPayload {
        signers: sig_map,
        context_rule_ids,
    };
    let payload_val: Val = auth_payload.into_val(env);
    let signature = ScVal::try_from_val(env, &payload_val).unwrap();
    SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: ScAddress::from(account_addr),
            nonce,
            signature_expiration_ledger,
            signature,
        }),
        root_invocation: invocation,
    }
}
```

Add `mod petitions;` to `crates/integration-tests/tests/it/main.rs` (alphabetical: after `name_registry_passkey_auth;`).

Note: if `AuthPayload`/`WebAuthnSigData` field shapes differ from this sketch, defer to `name_registry_passkey_auth.rs` — copy its exact construction; it is the compiling source of truth in-repo.

- [ ] **Step 3: Run, verify**

Run: `cargo test -p nido-integration-tests petitions`
Expected: both tests PASS; new snapshot files appear under `crates/integration-tests/test_snapshots/petitions/`.

- [ ] **Step 4: Commit (including snapshots)**

```bash
git add crates/integration-tests
git commit -m "test(petitions): wasm integration tests incl. real passkey auth path"
```

---

### Task 8: Integration tests — web-of-trust (wasm claim flow + payload parity fixture)

**Files:**
- Create: `crates/integration-tests/tests/it/web_of_trust.rs`
- Modify: `crates/integration-tests/tests/it/main.rs` (add `mod web_of_trust;` at the end, alphabetical)
- Modify: `crates/integration-tests/Cargo.toml` (add `ed25519-dalek = "2"` to `[dependencies]` next to `p256`)

**Interfaces:**
- Consumes: web-of-trust contract API (tasks 4–6). The claim payload is REBUILT here by hand (the contract crate is cdylib-only and cannot be imported): `contract_address.to_xdr(env) || b"adsum:claim_vouch" || to.to_xdr(env)`.
- Produces: `CLAIM_PAYLOAD_FIXTURE_HEX` — a committed hex constant of the payload for pinned inputs. The dapp's TS `buildClaimPayload` unit test (dapp plan) must reproduce these exact bytes.

- [ ] **Step 1: Write the test**

`crates/integration-tests/tests/it/web_of_trust.rs`:

```rust
//! Wasm-level tests for `contracts/web-of-trust`: vouch graph consistency and
//! the ed25519 pre-vouch claim flow, plus a pinned claim-payload fixture that
//! the dapp's TypeScript payload builder must match byte-for-byte.

use ed25519_dalek::Signer as _;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::xdr::ToXdr as _;
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};

const WOT_WASM: &[u8] =
    include_bytes!("../../../../target/wasm32v1-none/contract/nido_web_of_trust.wasm");

const CLAIM_DOMAIN: &[u8] = b"adsum:claim_vouch";

/// Pinned, known-valid strkeys for the payload fixture (values borrowed from
/// DEPLOYED.md/relayer docs purely as valid fixture inputs; nothing is
/// invoked on them — only their XDR encodings matter).
const FIXTURE_CONTRACT: &str = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";
/// Pinned claimant for the payload fixture.
const FIXTURE_CLAIMANT: &str = "GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2";

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "WotClient")]
trait WotInterface {
    fn vouch(env: soroban_sdk::Env, from: Address, to: Address);
    fn revoke(env: soroban_sdk::Env, from: Address, to: Address);
    fn has_vouched(env: soroban_sdk::Env, from: Address, to: Address) -> bool;
    fn vouches_given(env: soroban_sdk::Env, a: Address) -> Vec<Address>;
    fn vouches_received(env: soroban_sdk::Env, a: Address) -> Vec<Address>;
    fn pre_vouch(
        env: soroban_sdk::Env,
        from: Address,
        key: BytesN<32>,
        expires: Option<u32>,
        max_claims: u32,
    );
    fn claim_vouch(env: soroban_sdk::Env, key: BytesN<32>, to: Address, sig: BytesN<64>);
}

fn claim_payload(env: &Env, contract: &Address, to: &Address) -> std::vec::Vec<u8> {
    let mut payload = contract.clone().to_xdr(env);
    payload.append(&Bytes::from_slice(env, CLAIM_DOMAIN));
    payload.append(&to.clone().to_xdr(env));
    let mut out = std::vec![0u8; payload.len() as usize];
    payload.copy_into_slice(&mut out);
    out
}

#[test]
fn wasm_vouch_graph_roundtrip() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(WOT_WASM, ());
    let client = WotClient::new(&env, &id);

    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.vouch(&a, &b);
    assert!(client.has_vouched(&a, &b));
    assert_eq!(client.vouches_received(&b).len(), 1);
    client.revoke(&a, &b);
    assert!(!client.has_vouched(&a, &b));
    assert_eq!(client.vouches_received(&b).len(), 0);
}

#[test]
fn wasm_claim_flow_end_to_end() {
    let env = Env::default();
    env.mock_all_auths(); // covers pre_vouch's require_auth; claim needs none
    let id = env.register(WOT_WASM, ());
    let client = WotClient::new(&env, &id);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = ed25519_dalek::SigningKey::from_bytes(&[42u8; 32]);
    let key = BytesN::from_array(&env, &sk.verifying_key().to_bytes());

    client.pre_vouch(&alice, &key, &None, &1);
    let sig = sk.sign(&claim_payload(&env, &id, &bob));
    client.claim_vouch(&key, &bob, &BytesN::from_array(&env, &sig.to_bytes()));

    assert!(client.has_vouched(&alice, &bob));
}

/// Pins the claim payload bytes for fixed inputs. The dapp's TS
/// `buildClaimPayload(contractId, to)` test must produce EXACTLY these bytes
/// (see the adsum dapp plan). If this test ever changes, the TS fixture must
/// change with it — the two are one protocol.
#[test]
fn claim_payload_fixture() {
    let env = Env::default();
    let contract = Address::from_str(&env, FIXTURE_CONTRACT);
    let to = Address::from_str(&env, FIXTURE_CLAIMANT);
    let payload = claim_payload(&env, &contract, &to);
    let hex: std::string::String = payload.iter().map(|b| std::format!("{b:02x}")).collect();
    // Placeholder value: on FIRST run, take the printed value below, paste it
    // here, and re-run to confirm stability. This is a one-time capture of a
    // deterministic encoding, not a guess.
    std::println!("CLAIM_PAYLOAD_FIXTURE_HEX = {hex}");
    const CLAIM_PAYLOAD_FIXTURE_HEX: &str = "<capture-on-first-run>";
    if CLAIM_PAYLOAD_FIXTURE_HEX != "<capture-on-first-run>" {
        assert_eq!(hex, CLAIM_PAYLOAD_FIXTURE_HEX);
    }
}
```

After the first `cargo test -p nido-integration-tests claim_payload_fixture -- --nocapture` run, replace `<capture-on-first-run>` with the printed hex and delete the `if` guard so the assert always runs. The final committed test MUST assert unconditionally.

- [ ] **Step 2: Run, capture fixture, verify**

Run: `cargo test -p nido-integration-tests web_of_trust -- --nocapture`
Expected: 3 tests PASS; copy the printed `CLAIM_PAYLOAD_FIXTURE_HEX` into the constant, delete the guard, re-run, still PASS.

- [ ] **Step 3: Commit**

```bash
git add crates/integration-tests
git commit -m "test(web-of-trust): wasm claim flow and TS payload parity fixture"
```

---

### Task 9: Full workspace gates

**Files:**
- Modify: whatever the gates flag (expect none or trivial).

- [ ] **Step 1: Full build + test + lint**

```bash
just build-contracts
just test
just check
```

Expected: all green. `just check` runs `cargo fmt --all -- --check` and `cargo clippy --all --tests -- -Dclippy::pedantic` — pedantic must be clean across both new crates and the new integration tests.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A && git commit -m "chore: satisfy workspace gates for adsum contracts"
```

(Skip the commit if the tree is clean.)

---

### Task 10: Testnet deploy + registry + DEPLOYED.md

**Files:**
- Create: `scripts/deploy-adsum.mjs`
- Modify: `DEPLOYED.md` (new "Adsum" section)
- Modify: `justfile` (new `publish-adsum` recipe)

**Interfaces:**
- Consumes: built + optimized wasm from `just build-contracts`.
- Produces: testnet contract ids for `adsum-petitions` and `adsum-web-of-trust`, registered in the unverified registry, recorded in `DEPLOYED.md`. The dapp plan pins these ids in its staging `environments.toml`.

- [ ] **Step 1: Read the reference script**

Read `scripts/deploy-zk-recovery.mjs` end to end before writing anything. It exists because stellar-cli 26.0.0 fails with "Missing Entry Context" on scaffold-built contracts — deploys and invokes go through the JS SDK (`Operation.createCustomContract`, simulate → assemble → sign → send → poll). Reuse its helpers verbatim where possible.

- [ ] **Step 2: Write `scripts/deploy-adsum.mjs`**

Clone `scripts/deploy-zk-recovery.mjs` with these deltas (both contracts here are constructor-less, so this is a simplification pass):

- Upload + deploy `target/wasm32v1-none/contract/nido_petitions.wasm` and `nido_web_of_trust.wasm`, no `constructorArgs`.
- Env: `DEPLOY_SECRET` (source account secret), optional `NETWORK` (default testnet RPC + passphrase, same constants as the reference script).
- Register both under the unverified registry names `adsum-petitions` / `adsum-web-of-trust`, using the same registry-registration approach the reference script uses (same registry contract `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S`).
- Print both C-addresses and each wasm's sha256.

Add the justfile recipe:

```make
# Deploy adsum contracts (petitions + web-of-trust) and register names.
# Usage: DEPLOY_SECRET=S... just publish-adsum
publish-adsum:
    node scripts/deploy-adsum.mjs
```

- [ ] **Step 3: Deploy to testnet**

Run: `just build-contracts && DEPLOY_SECRET=<funded testnet secret> just publish-adsum`
Expected: two C-addresses printed, registry names registered. If no funded secret is available in the execution environment, STOP and ask the user to run this step — do not fabricate addresses.

- [ ] **Step 4: Record in `DEPLOYED.md`**

Add an "Adsum" section following the existing table format: contract name, C-address, registry name, wasm sha256, deploy date, deploying account. Note both contracts are admin-less (redeploy = fresh deploy + registry repoint).

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy-adsum.mjs justfile DEPLOYED.md
git commit -m "chore(adsum): testnet deploy script, registry names, DEPLOYED.md"
```

---

## Self-Review Notes (author-run)

- Spec coverage: every contract function, error variant, event, constant, and test case named in the spec maps to a task above. Dapp, QR/invite UI, CF Pages, e2e-browser tests, and the staging client pinning are OUT of this plan — they are the separately planned `examples/adsum` sub-project (see spec "Example dapp" section), which consumes Task 10's deployed ids.
- The `claim_payload_fixture` capture step is deliberate two-phase (print → pin → assert) because the XDR encoding, while deterministic, is cheaper to capture than to hand-compute; the committed end state asserts unconditionally.
- Type consistency: `sign(id: u32, signer: &Address)`, tuple storage keys, `TrustError` discriminants, and `claim_payload_for` naming are used identically across tasks 1–8.
