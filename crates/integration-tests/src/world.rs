//! The Perch stack as Nido deploys it, under ENFORCING authorization.
//!
//! Every contract runs from its wasm: Nido's factory (`just build-contracts`),
//! and Perch's account, `WebAuthn` verifier, doc compiler, interpreter,
//! spending limit, recovery controller, ZK membership pool, and ZK adapter,
//! exactly as deployed on testnet (`just perch-infra`). Accounts are minted by the factory, so
//! their code is the exact Perch account wasm the factory embeds.
//!
//! Every key is a P-256 passkey checked by the `WebAuthn` verifier. Every
//! authorization is a hand-built `SorobanAuthorizationEntry` signed like a
//! browser assertion and installed with `set_auths`: `mock_all_auths` never
//! runs a custom account's `__check_auth`, so it could prove none of the
//! freeze, reserved-name, recovery-rule, or guardian properties. Guardians are
//! Nido accounts themselves, approving through a rule their own document
//! scopes to the controller.
//!
//! Addresses, keys, and ledger numbers are all deterministic, so a statement
//! built through the controller is byte-identical across runs; that is what
//! lets [`crate::zk`] replay committed real proofs.

// A test harness: every helper either returns the contract's own result or
// panics on a failed setup step (which fails the test), so per-function
// `# Panics` / `# Errors` sections would only restate that.
#![allow(clippy::missing_panics_doc, clippy::missing_errors_doc)]

extern crate std;

use crate::{
    build_contract_assertion, test_key, FACTORY_WASM, PERCH_ACCOUNT_WASM, PERCH_DOC_COMPILER_WASM,
    PERCH_INTERPRETER_WASM, PERCH_RECOVERY_WASM, PERCH_SPENDING_LIMIT_WASM,
    PERCH_WEBAUTHN_VERIFIER_WASM, PERCH_ZK_ADAPTER_WASM, PERCH_ZK_POOL_WASM,
};
use p256::ecdsa::SigningKey;
use perch_account::{PerchAccountClient, PerchAccountError};
use perch_doc_compiler::PerchDocCompilerClient;
use perch_recovery::{EvidenceDomain, PerchRecoveryClient, RecoveryError};
use perch_recovery_interface::credential::{Credential, Replacement, ReplacementSet, ZkEnrollment};
use perch_recovery_interface::{RecoveryAction, RecoveryStatement, StatementSubject};
use perch_smart_account::infra;
use perch_zk_pool::PerchZkPoolClient;
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::xdr::{
    HashIdPreimage, HashIdPreimageSorobanAuthorization, InvokeContractArgs, Limits, ScVal,
    SorobanAddressCredentials, SorobanAuthorizationEntry, SorobanAuthorizedFunction,
    SorobanAuthorizedInvocation, SorobanCredentials, StringM, ToXdr as _, VecM, WriteXdr,
};
use soroban_sdk::{
    contract, contractclient, contractimpl, symbol_short, vec, Address, Bytes, BytesN, Env,
    IntoVal, Map, Symbol, TryFromVal, Val, Vec,
};
use std::cell::Cell;
use std::format;
use std::string::String;
use stellar_accounts::smart_account::{AuthPayload, Signer, SmartAccountStorageKey};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

/// The network every document names (its hash is the test ledger's id).
pub const NETWORK: &str = "Test SDF Network ; September 2015";
/// The ledger the world starts at.
pub const START: u32 = 1_000;
/// Default recovery timing for test documents, in ledgers.
pub const DELAY: u32 = 10;
pub const EXPIRY: u32 = 100;

// ---------------------------------------------------------------------------
// Stand-ins and clients
// ---------------------------------------------------------------------------

/// Ordinary activity: a dApp entry point that needs the account's
/// authorization.
#[contract]
pub struct Target;

const HITS: Symbol = symbol_short!("hits");

#[contractimpl]
impl Target {
    // `#[contractimpl]` entry point: the SDK ABI takes owned arguments.
    #[allow(clippy::needless_pass_by_value, clippy::must_use_candidate)]
    pub fn protected(e: Env, account: Address) -> u32 {
        account.require_auth();
        let hits: u32 = e.storage().instance().get(&HITS).unwrap_or(0) + 1;
        e.storage().instance().set(&HITS, &hits);
        hits
    }
}

/// The parts of Nido's factory the world drives (the factory crate is
/// cdylib-only, so it has no Rust client of its own).
#[contractclient(name = "FactoryClient")]
pub trait Factory {
    fn create_account(e: Env, salt: BytesN<32>, key: BytesN<65>) -> Address;
    fn get_c_address(e: Env, salt: BytesN<32>) -> Address;
    fn set_registry_pins(e: Env, verifier: Address);
}

/// The ZK adapter's identity views.
#[contractclient(name = "AdapterClient")]
pub trait Adapter {
    fn circuit_id(e: Env) -> BytesN<32>;
    fn tree_depth(e: Env) -> u32;
}

/// A contract address from a label: `sha256("nido-it/<label>")` as its id.
#[must_use]
pub fn contract_at(env: &Env, label: &str) -> Address {
    let id = env
        .crypto()
        .sha256(&Bytes::from_slice(
            env,
            format!("nido-it/{label}").as_bytes(),
        ))
        .to_bytes();
    soroban_sdk::address_payload::AddressPayload::ContractIdHash(id).to_address(env)
}

/// The raw 32-byte contract id of a contract address.
///
/// # Panics
/// Panics if `address` is not a contract.
#[must_use]
pub fn contract_id(address: &Address) -> [u8; 32] {
    match address.to_payload() {
        Some(soroban_sdk::address_payload::AddressPayload::ContractIdHash(id)) => id.to_array(),
        _ => panic!("not a contract address"),
    }
}

#[must_use]
pub fn strkey(a: &Address) -> String {
    let s = a.to_string();
    let mut buf = std::vec![0u8; s.len() as usize];
    s.copy_into_slice(&mut buf);
    String::from_utf8(buf).unwrap()
}

// ---------------------------------------------------------------------------
// Passkeys and accounts
// ---------------------------------------------------------------------------

/// A passkey: the P-256 key a browser authenticator holds.
#[derive(Clone)]
pub struct Passkey {
    pub key: SigningKey,
}

impl Passkey {
    /// The deterministic passkey for `seed` (see [`test_key`]).
    #[must_use]
    pub fn new(seed: u64) -> Self {
        Self {
            key: test_key(seed),
        }
    }

    /// The deterministic passkey for `label`.
    #[must_use]
    pub fn labelled(label: &str) -> Self {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(format!("nido-it/passkey/{label}"));
        Self::new(u64::from_le_bytes(digest[..8].try_into().unwrap()))
    }

    #[must_use]
    pub fn pubkey(&self) -> [u8; 65] {
        self.key
            .verifying_key()
            .to_sec1_bytes()
            .as_ref()
            .try_into()
            .unwrap()
    }

    #[must_use]
    pub fn signer(&self, env: &Env, verifier: &Address) -> Signer {
        Signer::External(verifier.clone(), Bytes::from_array(env, &self.pubkey()))
    }

    #[must_use]
    pub fn credential(&self, env: &Env, verifier: &Address) -> Credential {
        Credential::External(verifier.clone(), Bytes::from_array(env, &self.pubkey()))
    }
}

/// A Nido account: its address and the passkeys its documents name.
#[derive(Clone)]
pub struct Account {
    pub address: Address,
    /// `(signer id, passkey)`; the first is the admin.
    pub keys: std::vec::Vec<(&'static str, Passkey)>,
}

impl Account {
    #[must_use]
    pub fn key(&self, id: &str) -> &Passkey {
        &self
            .keys
            .iter()
            .find(|(k, _)| *k == id)
            .unwrap_or_else(|| panic!("no signer `{id}`"))
            .1
    }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Guardian,
    Zk,
    Combined,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile {
    Loss,
    Protected,
}

impl Profile {
    fn as_str(self) -> &'static str {
        match self {
            Profile::Loss => "loss",
            Profile::Protected => "protected",
        }
    }
}

/// A document's `recovery` member.
#[derive(Clone)]
pub struct Recovery {
    pub profile: Profile,
    pub mode: Mode,
    pub guardians: std::vec::Vec<Address>,
    pub quorum: u32,
    pub enrollment: Option<ZkEnrollment>,
    pub baseline: Option<BytesN<32>>,
    pub replaceable: std::vec::Vec<&'static str>,
    pub delay: u32,
    pub expiry: u32,
    pub max_cancels: u32,
}

/// A policy document: the account's passkeys (the first is the admin), extra
/// rules (each scoped to a contract and signed by the admin), and recovery.
#[derive(Clone)]
pub struct Doc {
    pub signers: std::vec::Vec<(&'static str, [u8; 65])>,
    pub rules: std::vec::Vec<(&'static str, Address)>,
    pub recovery: Option<Recovery>,
}

impl Doc {
    #[must_use]
    pub fn json(&self, w: &World) -> String {
        let verifier = strkey(&w.verifier);
        let signers: std::vec::Vec<String> = self
            .signers
            .iter()
            .map(|(id, pk)| {
                format!(
                    r#"{{"id":"{id}","verifier":"{verifier}","key":"{}"}}"#,
                    hex::encode(pk)
                )
            })
            .collect();
        let admin = self.signers[0].0;
        let mut rules = std::vec![format!(
            r#"{{"name":"admin","scope":{{"type":"self-admin"}},"principals":{{"type":"all","signers":["{admin}"]}}}}"#
        )];
        for (name, scope) in &self.rules {
            rules.push(format!(
                r#"{{"name":"{name}","scope":{{"type":"contract","address":"{}"}},"principals":{{"type":"all","signers":["{admin}"]}}}}"#,
                strkey(scope)
            ));
        }
        let recovery = match &self.recovery {
            None => String::new(),
            Some(r) => format!(r#","recovery":{}"#, r.json(w)),
        };
        format!(
            r#"{{"version":1,"network":"{NETWORK}","signers":[{}],"rules":[{}]{recovery}}}"#,
            signers.join(","),
            rules.join(",")
        )
    }

    #[must_use]
    pub fn bytes(&self, w: &World) -> Bytes {
        Bytes::from_slice(&w.env, self.json(w).as_bytes())
    }
}

impl Recovery {
    fn json(&self, w: &World) -> String {
        let guardians: std::vec::Vec<String> = self
            .guardians
            .iter()
            .map(|g| format!(r#""{}""#, strkey(g)))
            .collect();
        let guardian_fields = format!(
            r#""guardians":[{}],"quorum":{}"#,
            guardians.join(","),
            self.quorum
        );
        let zk_fields = || {
            let z = self
                .enrollment
                .as_ref()
                .expect("a ZK mode needs an enrollment");
            format!(
                r#""adapter":"{}","circuit-id":"{}","pool":"{}","enrollment-id":"{}","commitment":"{}""#,
                strkey(&w.adapter),
                hex::encode(w.circuit_id().to_array()),
                strkey(&w.pool),
                hex::encode(z.id.to_array()),
                hex::encode(z.commitment.to_array())
            )
        };
        let mode = match self.mode {
            Mode::Guardian => format!(r#"{{"type":"guardian-only",{guardian_fields}}}"#),
            Mode::Zk => format!(r#"{{"type":"zk-only",{}}}"#, zk_fields()),
            Mode::Combined => format!(r#"{{"type":"combined",{guardian_fields},{}}}"#, zk_fields()),
        };
        let baseline = self
            .baseline
            .as_ref()
            .map(|b| {
                format!(
                    r#","baseline":{{"doc-hash":"{}"}}"#,
                    hex::encode(b.to_array())
                )
            })
            .unwrap_or_default();
        let replaceable: std::vec::Vec<String> = self
            .replaceable
            .iter()
            .map(|id| format!(r#""{id}""#))
            .collect();
        format!(
            r#"{{"profile":"{}","mode":{mode},"controller":"{}"{baseline},"replaceable":[{}],"delay-ledgers":{},"expiry-ledgers":{},"max-cancels":{}}}"#,
            self.profile.as_str(),
            strkey(&w.controller),
            replaceable.join(","),
            self.delay,
            self.expiry,
            self.max_cancels
        )
    }
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

/// An account enrolled in recovery, with the parties that can recover it.
pub struct Enrolled {
    pub account: Account,
    /// Guardian accounts, in the order the configuration lists them.
    pub guardians: std::vec::Vec<Account>,
    /// The ZK credential the configuration enrolls, if its mode has one.
    pub zk: Option<crate::zk::ZkCredential>,
    /// The recovery member that was applied.
    pub recovery: Recovery,
}

pub type AccountResult<T> = Result<T, Result<PerchAccountError, soroban_sdk::InvokeError>>;
pub type RecoveryResult<T> = Result<T, Result<RecoveryError, soroban_sdk::InvokeError>>;

pub struct World {
    pub env: Env,
    pub verifier: Address,
    pub factory: Address,
    pub compiler: Address,
    pub controller: Address,
    pub pool: Address,
    pub adapter: Address,
    /// A dApp contract that needs the account's authorization.
    pub target: Address,
    nonce: Cell<i64>,
}

/// A fresh world at ledger [`START`], with every contract registered at a
/// fixed address and the factory pinned to the `WebAuthn` verifier.
#[must_use]
pub fn world() -> World {
    // No test snapshot: every contract here is registered from wasm, which
    // would land in the snapshot, and the assertions are the record.
    let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    // Real wasm, real proofs: the cost suite reads `cost_estimate()` per
    // call against the network limits instead of the default test budget.
    env.cost_estimate().budget().reset_unlimited();
    let network_id = env
        .crypto()
        .sha256(&Bytes::from_slice(&env, NETWORK.as_bytes()))
        .to_array();
    env.ledger().with_mut(|l| {
        l.sequence_number = START;
        l.network_id = network_id;
        l.min_persistent_entry_ttl = 1_000_000;
        l.min_temp_entry_ttl = 1_000_000;
        l.max_entry_ttl = 10_000_000;
    });

    // Perch's shared infra at exactly the content addresses the account
    // derives from its build-time pins.
    let compiler = infra::perch_doc_compiler::address(&env);
    env.register_at(&compiler, PERCH_DOC_COMPILER_WASM, ());
    env.register_at(
        &infra::perch_interpreter::address(&env),
        PERCH_INTERPRETER_WASM,
        (),
    );
    env.register_at(
        &infra::perch_spending_limit::address(&env),
        PERCH_SPENDING_LIMIT_WASM,
        (),
    );

    let admin = contract_at(&env, "deployer");
    let verifier = contract_at(&env, "webauthn-verifier");
    env.register_at(&verifier, PERCH_WEBAUTHN_VERIFIER_WASM, ());
    let controller = contract_at(&env, "recovery-controller");
    env.register_at(&controller, PERCH_RECOVERY_WASM, ());
    let pool = contract_at(&env, "zk-pool");
    env.register_at(&pool, PERCH_ZK_POOL_WASM, ());
    let adapter = contract_at(&env, "zk-adapter");
    env.register_at(&adapter, PERCH_ZK_ADAPTER_WASM, ());
    let target = contract_at(&env, "target");
    env.register_at(&target, Target, ());

    let factory = contract_at(&env, "factory");
    env.register_at(&factory, FACTORY_WASM, (admin,));
    env.deployer().upload_contract_wasm(PERCH_ACCOUNT_WASM);
    env.mock_all_auths();
    FactoryClient::new(&env, &factory).set_registry_pins(&verifier);

    // Enforcing authorization from here on: only explicit entries pass.
    env.set_auths(&[]);
    World {
        env,
        verifier,
        factory,
        compiler,
        controller,
        pool,
        adapter,
        target,
        nonce: Cell::new(0),
    }
}

impl World {
    // --- clients -----------------------------------------------------------

    #[must_use]
    pub fn account(&self, account: &Account) -> PerchAccountClient<'_> {
        PerchAccountClient::new(&self.env, &account.address)
    }

    #[must_use]
    pub fn ctl(&self) -> PerchRecoveryClient<'_> {
        PerchRecoveryClient::new(&self.env, &self.controller)
    }

    #[must_use]
    pub fn compiler(&self) -> PerchDocCompilerClient<'_> {
        PerchDocCompilerClient::new(&self.env, &self.compiler)
    }

    #[must_use]
    pub fn pool_client(&self) -> PerchZkPoolClient<'_> {
        PerchZkPoolClient::new(&self.env, &self.pool)
    }

    #[must_use]
    pub fn circuit_id(&self) -> BytesN<32> {
        AdapterClient::new(&self.env, &self.adapter).circuit_id()
    }

    #[must_use]
    pub fn ledger(&self) -> u32 {
        self.env.ledger().sequence()
    }

    pub fn advance(&self, ledgers: u32) {
        self.env.ledger().with_mut(|l| l.sequence_number += ledgers);
    }

    // --- accounts ----------------------------------------------------------

    /// Mint an account through the factory: salt `sha256("nido-it/salt/<label>")`,
    /// admin passkey `owner`, plus `extra` passkeys its documents may name.
    #[must_use]
    pub fn mint(
        &self,
        label: &str,
        owner: Passkey,
        extra: std::vec::Vec<(&'static str, Passkey)>,
    ) -> Account {
        let salt = self
            .env
            .crypto()
            .sha256(&Bytes::from_slice(
                &self.env,
                format!("nido-it/salt/{label}").as_bytes(),
            ))
            .to_bytes();
        let address = FactoryClient::new(&self.env, &self.factory)
            .create_account(&salt, &BytesN::from_array(&self.env, &owner.pubkey()));
        let mut keys = std::vec![("owner", owner)];
        keys.extend(extra);
        Account { address, keys }
    }

    /// The default document for `account`: every passkey it holds (the first
    /// is the admin), a rule letting the admin use [`Target`], and `recovery`.
    #[must_use]
    pub fn doc(&self, account: &Account, recovery: Option<Recovery>) -> Doc {
        Doc {
            signers: account
                .keys
                .iter()
                .map(|(id, k)| (*id, k.pubkey()))
                .collect(),
            rules: std::vec![("app", self.target.clone())],
            recovery,
        }
    }

    /// A guardian: a Nido account whose document lets its owner approve at
    /// this world's controller.
    ///
    /// # Panics
    /// Panics if the guardian's document is refused.
    #[must_use]
    pub fn guardian(&self, label: &str, owner: Passkey) -> Account {
        let g = self.mint(label, owner, std::vec![]);
        let doc = Doc {
            signers: std::vec![("owner", g.key("owner").pubkey())],
            rules: std::vec![("guardian", self.controller.clone())],
            recovery: None,
        };
        self.apply(&g, &doc, 0).expect("guardian document");
        g
    }

    /// The recovery member most suites start from: `owner` is replaceable,
    /// timing is [`DELAY`]/[`EXPIRY`], three cancellations.
    #[must_use]
    pub fn recovery(
        &self,
        profile: Profile,
        mode: Mode,
        guardians: &[&Account],
        quorum: u32,
        enrollment: Option<ZkEnrollment>,
    ) -> Recovery {
        Recovery {
            profile,
            mode,
            guardians: guardians.iter().map(|g| g.address.clone()).collect(),
            quorum,
            enrollment,
            baseline: None,
            replaceable: std::vec!["owner"],
            delay: DELAY,
            expiry: EXPIRY,
            max_cancels: 3,
        }
    }

    /// Mint `label`'s account (passkeys `owner` and `device`), and for guardian
    /// modes three guardian accounts; enroll `profile`/`mode` with a 2-of-3
    /// quorum and, for ZK modes, a fresh credential, through the owner's
    /// `apply_doc`.
    ///
    /// # Panics
    /// Panics if enrollment fails.
    #[must_use]
    pub fn enrolled(&self, label: &str, profile: Profile, mode: Mode) -> Enrolled {
        let account = self.mint(
            label,
            Passkey::labelled(&format!("{label}/owner")),
            std::vec![("device", Passkey::labelled(&format!("{label}/device")))],
        );
        let guardians: std::vec::Vec<Account> = if mode == Mode::Zk {
            std::vec![]
        } else {
            (0..3u64)
                .map(|i| {
                    self.guardian(
                        &format!("{label}/guardian-{i}"),
                        Passkey::labelled(&format!("{label}/guardian-{i}")),
                    )
                })
                .collect()
        };
        let zk = (mode != Mode::Guardian).then(|| crate::zk::ZkCredential::new(label));
        let refs: std::vec::Vec<&Account> = guardians.iter().collect();
        let recovery = self.recovery(
            profile,
            mode,
            &refs,
            2,
            zk.as_ref().map(|c| c.enrollment(&self.env)),
        );
        self.apply(&account, &self.doc(&account, Some(recovery.clone())), 0)
            .expect("enrollment through apply_doc");
        Enrolled {
            account,
            guardians,
            zk,
            recovery,
        }
    }

    // --- authorization -----------------------------------------------------

    fn next_nonce(&self) -> i64 {
        let n = self.nonce.get() + 1;
        self.nonce.set(n);
        n
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn sc<T: IntoVal<Env, Val>>(&self, v: T) -> ScVal {
        let val: Val = v.into_val(&self.env);
        ScVal::try_from_val(&self.env, &val).unwrap()
    }

    #[must_use]
    pub fn invocation(
        &self,
        contract: &Address,
        fn_name: &str,
        args: std::vec::Vec<ScVal>,
    ) -> SorobanAuthorizedInvocation {
        SorobanAuthorizedInvocation {
            function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
                contract_address: contract.clone().into(),
                function_name: StringM::try_from(fn_name).unwrap().into(),
                args: args.try_into().unwrap(),
            }),
            sub_invocations: VecM::default(),
        }
    }

    /// `account`'s authorization of `root` through context rule `rule`,
    /// signed by each of `keys` exactly as a browser assertion would sign it:
    /// the host's signature payload for this entry, bound to the selected
    /// rule ids (OZ's auth digest), as the `WebAuthn` challenge.
    #[must_use]
    pub fn passkey_entry(
        &self,
        account: &Address,
        keys: &[&Passkey],
        rule: u32,
        root: SorobanAuthorizedInvocation,
    ) -> SorobanAuthorizationEntry {
        let nonce = self.next_nonce();
        let expiration = self.ledger() + 1_000;
        let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
            network_id: soroban_sdk::xdr::Hash(self.env.ledger().network_id().to_array()),
            nonce,
            signature_expiration_ledger: expiration,
            invocation: root.clone(),
        });
        let payload = self.env.crypto().sha256(&Bytes::from_slice(
            &self.env,
            &preimage.to_xdr(Limits::none()).unwrap(),
        ));
        let rule_ids = vec![&self.env, rule];
        let digest = crate::compute_auth_digest(&self.env, &payload, &rule_ids);
        let mut signers: Map<Signer, Bytes> = Map::new(&self.env);
        for key in keys {
            let a = build_contract_assertion(&key.key, &self.env, &digest);
            let sig = WebAuthnSigData {
                signature: a.signature,
                authenticator_data: a.authenticator_data,
                client_data: a.client_data,
            };
            signers.set(key.signer(&self.env, &self.verifier), sig.to_xdr(&self.env));
        }
        let signature = self.sc(AuthPayload {
            signers,
            context_rule_ids: rule_ids,
        });
        SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: account.clone().into(),
                nonce,
                signature_expiration_ledger: expiration,
                signature,
            }),
            root_invocation: root,
        }
    }

    /// `account`'s `key` authorizing `root` through the rule named `rule`.
    #[must_use]
    pub fn signed(
        &self,
        account: &Account,
        key: &str,
        rule: &str,
        root: SorobanAuthorizedInvocation,
    ) -> SorobanAuthorizationEntry {
        self.passkey_entry(
            &account.address,
            &[account.key(key)],
            self.rule_id(&account.address, rule),
            root,
        )
    }

    /// Anyone's selection of `account`'s zero-signer recovery rule for `root`.
    #[must_use]
    pub fn recovery_rule_entry(
        &self,
        account: &Address,
        root: SorobanAuthorizedInvocation,
    ) -> SorobanAuthorizationEntry {
        let nonce = self.next_nonce();
        SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: account.clone().into(),
                nonce,
                signature_expiration_ledger: self.ledger() + 1_000,
                signature: self.sc(AuthPayload {
                    signers: Map::new(&self.env),
                    context_rule_ids: vec![&self.env, self.rule_id(account, "recovery")],
                }),
            }),
            root_invocation: root,
        }
    }

    /// The id of `account`'s live rule named `name`. `apply_doc` re-creates
    /// every rule, so ids move; the newest match wins.
    #[must_use]
    pub fn rule_id(&self, account: &Address, name: &str) -> u32 {
        let next: u32 = self.env.as_contract(account, || {
            self.env
                .storage()
                .instance()
                .get(&SmartAccountStorageKey::NextId)
                .unwrap_or(0)
        });
        let client = PerchAccountClient::new(&self.env, account);
        let wanted = soroban_sdk::String::from_str(&self.env, name);
        (0..next)
            .rev()
            .find(|id| matches!(client.try_get_context_rule(id), Ok(Ok(r)) if r.name == wanted))
            .unwrap_or(u32::MAX)
    }

    /// Run `f` with exactly `entries` authorized, then return to enforcing
    /// nothing.
    pub fn with_auths<T>(&self, entries: &[SorobanAuthorizationEntry], f: impl FnOnce() -> T) -> T {
        self.env.set_auths(entries);
        let out = f();
        self.env.set_auths(&[]);
        out
    }

    // --- account calls -----------------------------------------------------

    /// `apply_doc` signed by the admin passkey through the admin rule.
    pub fn apply(
        &self,
        account: &Account,
        doc: &Doc,
        valid_until: u32,
    ) -> AccountResult<BytesN<32>> {
        self.apply_bytes_as(account, "owner", &doc.bytes(self), valid_until)
    }

    /// `apply_doc` of raw bytes, signed by `key` through the admin rule.
    pub fn apply_bytes_as(
        &self,
        account: &Account,
        key: &str,
        bytes: &Bytes,
        valid_until: u32,
    ) -> AccountResult<BytesN<32>> {
        let root = self.invocation(
            &account.address,
            "apply_doc",
            std::vec![self.sc(bytes.clone()), self.sc(valid_until)],
        );
        let entry = self.signed(account, key, "admin", root);
        self.with_auths(&[entry], || {
            self.account(account)
                .try_apply_doc(bytes, &valid_until)
                .map(|r| r.unwrap())
        })
    }

    /// Ordinary activity: `key` authorizes [`Target::protected`] directly,
    /// through the `app` rule.
    #[must_use]
    pub fn activity(&self, account: &Account, key: &str) -> bool {
        let root = self.invocation(
            &self.target,
            "protected",
            std::vec![self.sc(account.address.clone())],
        );
        let entry = self.signed(account, key, "app", root);
        self.with_auths(&[entry], || {
            TargetClient::new(&self.env, &self.target)
                .try_protected(&account.address)
                .is_ok()
        })
    }

    /// Ordinary activity through the account's `execute` wrapper, authorized
    /// by `key` through the admin rule.
    pub fn execute(&self, account: &Account, key: &str) -> AccountResult<Val> {
        let args: Vec<Val> = vec![&self.env, account.address.clone().into_val(&self.env)];
        let root = self.invocation(
            &account.address,
            "execute",
            std::vec![
                self.sc(self.target.clone()),
                self.sc(Symbol::new(&self.env, "protected")),
                self.sc(args.clone()),
            ],
        );
        let entry = self.signed(account, key, "admin", root);
        self.with_auths(&[entry], || {
            self.account(account)
                .try_execute(&self.target, &Symbol::new(&self.env, "protected"), &args)
                .map(|r| r.unwrap())
        })
    }

    /// Complete through the recovery rule: anyone may submit.
    pub fn complete(&self, account: &Account, target: &Bytes) -> AccountResult<BytesN<32>> {
        let root = self.invocation(
            &account.address,
            "apply_doc",
            std::vec![self.sc(target.clone()), self.sc(0u32)],
        );
        let entry = self.recovery_rule_entry(&account.address, root);
        self.with_auths(&[entry], || {
            self.account(account)
                .try_apply_doc(target, &0)
                .map(|r| r.unwrap())
        })
    }

    /// A `Loss` owner's cancellation, through the account.
    pub fn owner_cancel(&self, account: &Account, attempt: u64) -> AccountResult<()> {
        let root = self.invocation(
            &account.address,
            "cancel_recovery",
            std::vec![self.sc(attempt)],
        );
        let entry = self.signed(account, "owner", "admin", root);
        self.with_auths(&[entry], || {
            self.account(account)
                .try_cancel_recovery(&attempt)
                .map(|r| r.unwrap())
        })
    }

    /// `schedule_upgrade` signed by the admin passkey.
    pub fn schedule_upgrade(
        &self,
        account: &Account,
        wasm: &BytesN<32>,
        valid_until: u32,
    ) -> AccountResult<u64> {
        let root = self.invocation(
            &account.address,
            "schedule_upgrade",
            std::vec![self.sc(wasm.clone()), self.sc(valid_until)],
        );
        let entry = self.signed(account, "owner", "admin", root);
        self.with_auths(&[entry], || {
            self.account(account)
                .try_schedule_upgrade(wasm, &valid_until)
                .map(|r| r.unwrap())
        })
    }

    /// `execute_upgrade` signed by the admin passkey.
    pub fn execute_upgrade(&self, account: &Account, request: u64) -> AccountResult<()> {
        let root = self.invocation(
            &account.address,
            "execute_upgrade",
            std::vec![self.sc(request)],
        );
        let entry = self.signed(account, "owner", "admin", root);
        self.with_auths(&[entry], || {
            self.account(account)
                .try_execute_upgrade(&request)
                .map(|r| r.unwrap())
        })
    }

    /// `cancel_upgrade` signed by the admin passkey.
    pub fn cancel_upgrade(&self, account: &Account) -> AccountResult<()> {
        let root = self.invocation(&account.address, "cancel_upgrade", std::vec![]);
        let entry = self.signed(account, "owner", "admin", root);
        self.with_auths(&[entry], || {
            self.account(account)
                .try_cancel_upgrade()
                .map(|r| r.unwrap())
        })
    }

    // --- recovery ----------------------------------------------------------

    /// Replace `account`'s `owner` passkey with `new_owner`; with `zk` also
    /// rotate to a fresh ZK enrollment.
    #[must_use]
    pub fn replacements(&self, new_owner: &Passkey, zk: Option<ZkEnrollment>) -> ReplacementSet {
        ReplacementSet {
            signers: vec![
                &self.env,
                Replacement {
                    signer_id: soroban_sdk::String::from_str(&self.env, "owner"),
                    credential: new_owner.credential(&self.env, &self.verifier),
                },
            ],
            zk_enrollment: match zk {
                Some(z) => vec![&self.env, z],
                None => Vec::new(&self.env),
            },
        }
    }

    /// Open a lost-key attempt (permissionless). Returns its id.
    pub fn begin_lost_key(
        &self,
        account: &Account,
        replacements: &ReplacementSet,
    ) -> RecoveryResult<u64> {
        self.ctl()
            .try_begin_lost_key(&account.address, replacements)
            .map(|r| r.unwrap())
    }

    /// The canonical target an attempt installs, derived exactly as a
    /// completer would: the account's own compiler over the applied document.
    #[must_use]
    pub fn target_bytes(
        &self,
        account: &Account,
        action: RecoveryAction,
        source: &Bytes,
        replacements: &ReplacementSet,
    ) -> Bytes {
        let current = self.account(account).applied_doc().unwrap();
        self.compiler()
            .derive_target(source, &current, &action, replacements)
            .canonical
    }

    #[must_use]
    pub fn statement(
        &self,
        account: &Account,
        attempt: u64,
        domain: EvidenceDomain,
    ) -> RecoveryStatement {
        self.ctl().statement(&account.address, &attempt, &domain)
    }

    #[must_use]
    pub fn digest(&self, statement: &RecoveryStatement) -> BytesN<32> {
        statement.digest(&self.env).unwrap()
    }

    /// `guardian`'s approval of `account`'s attempt statement in `domain`,
    /// signed by the guardian's passkey through its `guardian` rule.
    pub fn try_guardian(
        &self,
        account: &Account,
        guardian: &Account,
        attempt: u64,
        domain: EvidenceDomain,
    ) -> RecoveryResult<()> {
        let digest = self.digest(&self.statement(account, attempt, domain));
        let root = self.invocation(
            &self.controller,
            "submit_guardian",
            std::vec![self.sc(digest)],
        );
        let entry = self.signed(guardian, "owner", "guardian", root);
        self.with_auths(&[entry], || {
            self.ctl()
                .try_submit_guardian(&account.address, &attempt, &domain, &guardian.address)
                .map(|r| r.unwrap())
        })
    }

    /// `guardian`'s approval of a `Reconfigure`/`Upgrade` statement.
    pub fn try_approve_change(
        &self,
        account: &Account,
        guardian: &Account,
        subject: &StatementSubject,
        valid_until: u32,
    ) -> RecoveryResult<()> {
        let statement = self
            .ctl()
            .change_statement(&account.address, subject, &valid_until);
        let digest = self.digest(&statement);
        let root = self.invocation(
            &self.controller,
            "approve_change",
            std::vec![self.sc(digest)],
        );
        let entry = self.signed(guardian, "owner", "guardian", root);
        self.with_auths(&[entry], || {
            self.ctl()
                .try_approve_change(&account.address, subject, &valid_until, &guardian.address)
                .map(|r| r.unwrap())
        })
    }

    /// The config hash a document's recovery member compiles to.
    #[must_use]
    pub fn config_hash(&self, doc: &Doc) -> BytesN<32> {
        self.compiler()
            .compile_doc(&doc.bytes(self))
            .recovery
            .get(0)
            .unwrap()
            .config_hash
    }

    #[must_use]
    pub fn doc_hash(&self, doc: &Doc) -> BytesN<32> {
        self.compiler().compile_doc(&doc.bytes(self)).doc_hash
    }
}

/// Unwrap the inner contract error of a failed `try_` call.
///
/// # Panics
/// Panics if `r` is not a contract error.
pub fn err<T: core::fmt::Debug, E: core::fmt::Debug + Clone>(
    r: Result<T, Result<E, soroban_sdk::InvokeError>>,
) -> E {
    match r {
        Err(Ok(e)) => e,
        other => panic!("expected a contract error, got {other:?}"),
    }
}
