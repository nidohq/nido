//! Nido's factory under ENFORCING authorization, against the factory wasm:
//! who may change it (upgrade, verifier pin, manager, admin), who may create
//! an account once a manager is set, and that nobody — the manager
//! included — can put a passkey at a setup key's address without that setup
//! key's signature.
//!
//! The admin and the manager are Nido accounts, as on mainnet: each
//! authorizes through a rule its own document scopes to the factory, signed
//! by its passkey, and the factory only calls `require_auth()` on it. A
//! delay or a quorum is the same rule with a policy or more signers. A
//! stranger holding a rule scoped to the factory signs validly for its own
//! address, which is neither.

use nido_integration_tests::world::{
    contract_at, world, Account, Doc, FactoryClient, Passkey, SetupKey, World,
};
use nido_integration_tests::{
    FACTORY_WASM, OLD_PERCH_ACCOUNT_WASM, PERCH_ACCOUNT_WASM, PERCH_WEBAUTHN_VERIFIER_WASM,
};
use soroban_sdk::xdr::SorobanAuthorizationEntry;
use soroban_sdk::{Address, BytesN, Executable, Symbol};
use stellar_accounts::smart_account::Signer;

/// A factory administered by one Nido account and managed by another,
/// beside the world's own.
struct Governed {
    w: World,
    factory: Address,
    operators: Account,
    onboarder: Account,
    stranger: Account,
}

/// A Nido account whose document lets its owner act at `factory`.
fn holder(w: &World, label: &str, factory: &Address) -> Account {
    let account = w.mint(label, Passkey::labelled(label), std::vec![]);
    let doc = Doc {
        signers: std::vec![("owner", account.key("owner").pubkey())],
        rules: std::vec![("factory", factory.clone())],
        recovery: None,
    };
    w.apply(&account, &doc, 0)
        .expect("document scoped to the factory");
    account
}

/// A factory at `label` administered by `admin`, pinned to the world's
/// verifier, managed by `manager`.
fn register(w: &World, label: &str, admin: &Account, manager: Option<&Account>) -> Address {
    let factory = contract_at(&w.env, label);
    w.env.register_at(
        &factory,
        FACTORY_WASM,
        (
            admin.address.clone(),
            Some(w.verifier.clone()),
            manager.map(|m| m.address.clone()),
        ),
    );
    w.env.set_auths(&[]);
    factory
}

fn governed() -> Governed {
    let w = world();
    let factory = contract_at(&w.env, "governed-factory");
    let operators = holder(&w, "operators", &factory);
    let onboarder = holder(&w, "onboarder", &factory);
    let stranger = holder(&w, "stranger", &factory);
    register(&w, "governed-factory", &operators, Some(&onboarder));
    Governed {
        w,
        factory,
        operators,
        onboarder,
        stranger,
    }
}

type Call<T> = Result<T, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>;

/// One account's setup: its setup key, passkey, and the setup key's
/// signature binding that passkey at `factory`.
struct Setup {
    pk: BytesN<32>,
    key: BytesN<65>,
    sig: BytesN<64>,
}

impl Governed {
    fn client(&self) -> FactoryClient<'_> {
        FactoryClient::new(&self.w.env, &self.factory)
    }

    /// `by`'s authorization of `factory.fn_name(args)` through its rule
    /// `rule`.
    fn entry(
        &self,
        by: &Account,
        rule: &str,
        factory: &Address,
        fn_name: &str,
        args: std::vec::Vec<soroban_sdk::xdr::ScVal>,
    ) -> SorobanAuthorizationEntry {
        let root = self.w.invocation(factory, fn_name, args);
        self.w.signed(by, "owner", rule, root)
    }

    /// `factory.fn_name(args)` authorized by `by` through its factory rule.
    fn signed<T>(
        &self,
        by: &Account,
        fn_name: &str,
        args: std::vec::Vec<soroban_sdk::xdr::ScVal>,
        call: impl FnOnce(&FactoryClient<'_>) -> T,
    ) -> T {
        let entry = self.entry(by, "factory", &self.factory, fn_name, args);
        self.w.with_auths(&[entry], || call(&self.client()))
    }

    fn upgrade(&self, by: &Account, wasm: &BytesN<32>) -> Call<()> {
        self.signed(by, "upgrade", std::vec![self.w.sc(wasm.clone())], |c| {
            c.try_upgrade(wasm).map(Result::unwrap)
        })
    }

    fn pin(&self, by: &Account, verifier: &Address) -> Call<()> {
        self.signed(
            by,
            "pin_verifier",
            std::vec![self.w.sc(verifier.clone())],
            |c| c.try_pin_verifier(verifier).map(Result::unwrap),
        )
    }

    fn set_manager(&self, by: &Account, manager: Option<&Address>) -> Call<()> {
        let manager = manager.cloned();
        self.signed(
            by,
            "set_manager",
            std::vec![self.w.sc(manager.clone())],
            |c| c.try_set_manager(&manager).map(Result::unwrap),
        )
    }

    fn set_admin(&self, by: &Account, admin: &Address) -> Call<()> {
        self.signed(by, "set_admin", std::vec![self.w.sc(admin.clone())], |c| {
            c.try_set_admin(admin).map(Result::unwrap)
        })
    }

    /// The setup `label`'s browser would produce for passkey `passkey` at
    /// `factory`.
    fn setup_at(&self, factory: &Address, label: &str, passkey: &Passkey) -> Setup {
        let setup = SetupKey::labelled(label);
        let key = BytesN::from_array(&self.w.env, &passkey.pubkey());
        Setup {
            pk: setup.public(&self.w.env),
            sig: setup.bind(&self.w.env, factory, &key),
            key,
        }
    }

    fn setup(&self, label: &str, passkey: &Passkey) -> Setup {
        self.setup_at(&self.factory, label, passkey)
    }

    fn create_args(&self, s: &Setup) -> std::vec::Vec<soroban_sdk::xdr::ScVal> {
        std::vec![
            self.w.sc(s.pk.clone()),
            self.w.sc(s.key.clone()),
            self.w.sc(s.sig.clone()),
        ]
    }

    /// `by`'s approval of `create_account(s)` at the governed factory.
    fn approval(&self, by: &Account, s: &Setup) -> SorobanAuthorizationEntry {
        self.entry(
            by,
            "factory",
            &self.factory,
            "create_account",
            self.create_args(s),
        )
    }

    /// `create_account(s)` at the governed factory with exactly `entries`.
    fn create(&self, entries: &[SorobanAuthorizationEntry], s: &Setup) -> Call<Address> {
        self.w.with_auths(entries, || {
            self.client()
                .try_create_account(&s.pk, &s.key, &s.sig)
                .map(Result::unwrap)
        })
    }

    /// Mint through the governed factory with the manager's approval.
    fn mint(&self, label: &str) -> Address {
        let s = self.setup(label, &Passkey::labelled(label));
        self.create(&[self.approval(&self.onboarder, &s)], &s)
            .expect("the manager approves")
    }

    /// The verifier an account's admin passkey names.
    fn verifier_of(&self, account: &Address) -> Address {
        let rule = nido_integration_tests::SmartAccountClient::new(&self.w.env, account)
            .get_context_rule(&0);
        match rule.signers.get(0).unwrap() {
            Signer::External(verifier, _) => verifier,
            Signer::Delegated(_) => panic!("not a passkey signer"),
        }
    }
}

/// Only the admin can upgrade, repin, set the manager, or rotate the admin.
/// A stranger's valid signature, or none at all, changes nothing.
#[test]
fn only_the_admin_can_upgrade_pin_set_the_manager_or_set_the_admin() {
    let g = governed();
    let code = g.factory.executable();
    let wasm = g.w.env.deployer().upload_contract_wasm(FACTORY_WASM);
    let verifier = contract_at(&g.w.env, "any-verifier");
    let stranger = g.stranger.address.clone();

    assert!(g.upgrade(&g.stranger, &wasm).is_err());
    assert!(g.pin(&g.stranger, &verifier).is_err());
    assert!(g.set_manager(&g.stranger, None).is_err());
    assert!(g.set_admin(&g.stranger, &stranger).is_err());
    assert!(g.client().try_upgrade(&wasm).is_err(), "no auth");
    assert!(g.client().try_pin_verifier(&verifier).is_err(), "no auth");
    assert!(g.client().try_set_manager(&None).is_err(), "no auth");
    assert!(g.client().try_set_admin(&stranger).is_err(), "no auth");
    assert_eq!(g.factory.executable(), code);
    assert_eq!(g.client().pinned_verifier(), Some(g.w.verifier.clone()));
    assert_eq!(g.client().manager(), Some(g.onboarder.address.clone()));
    assert_eq!(g.client().admin(), g.operators.address);

    assert_eq!(g.pin(&g.operators, &verifier), Ok(()));
    assert_eq!(g.set_manager(&g.operators, Some(&stranger)), Ok(()));
    assert_eq!(g.set_admin(&g.operators, &stranger), Ok(()));
    assert_eq!(g.client().pinned_verifier(), Some(verifier));
    assert_eq!(g.client().manager(), Some(stranger.clone()));
    assert_eq!(g.client().admin(), stranger);
    assert!(
        g.pin(&g.operators, &g.w.verifier).is_err(),
        "the old admin is no longer the admin"
    );
}

/// A repin reaches only accounts created after it; an account created
/// before keeps the verifier it was created with.
#[test]
fn a_repin_reaches_only_accounts_created_after_it() {
    let g = governed();
    let next = contract_at(&g.w.env, "webauthn-verifier-next");
    g.w.env.register_at(&next, PERCH_WEBAUTHN_VERIFIER_WASM, ());
    g.w.env.set_auths(&[]);

    let before = g.mint("before-repin");
    assert_eq!(g.verifier_of(&before), g.w.verifier);
    assert_eq!(g.pin(&g.operators, &next), Ok(()));
    assert_eq!(g.verifier_of(&g.mint("after-repin")), next);
    assert_eq!(g.verifier_of(&before), g.w.verifier);
}

/// The factory wasm deploys every account from exactly the hash it pins:
/// the testnet manifest's `perch-account`, which is the hash of the account
/// wasm the stack installs. An account-hash cache an earlier factory build
/// left in the instance changes nothing, before or after an upgrade, and an
/// upgrade installs exactly the given wasm.
#[test]
fn the_factory_deploys_exactly_the_pinned_account_before_and_after_an_upgrade() {
    let g = governed();
    let env = &g.w.env;
    let manifest: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../vendor/perch/deployments/testnet.json"
    ))
    .unwrap();
    let pinned = g.client().account_wasm_hash();
    assert_eq!(
        hex::encode(pinned.to_array()),
        manifest["contracts"]["perch-account"]["sha256"]
    );
    assert_eq!(
        env.deployer().upload_contract_wasm(PERCH_ACCOUNT_WASM),
        pinned
    );

    // The key an earlier factory build cached its account hash under.
    let previous = env.deployer().upload_contract_wasm(OLD_PERCH_ACCOUNT_WASM);
    env.as_contract(&g.factory, || {
        env.storage()
            .instance()
            .set(&Symbol::new(env, "Account"), &previous);
    });
    assert_eq!(
        g.mint("before-upgrade").executable(),
        Some(Executable::Wasm(pinned.clone()))
    );

    let code = match g.factory.executable() {
        Some(Executable::Wasm(hash)) => hash,
        other => panic!("factory executable {other:?}"),
    };
    assert_eq!(g.upgrade(&g.operators, &code), Ok(()));
    assert_eq!(g.factory.executable(), Some(Executable::Wasm(code)));
    assert_eq!(
        g.mint("after-upgrade").executable(),
        Some(Executable::Wasm(pinned))
    );
}

/// With a manager set, `create_account` needs the manager's authorization:
/// none, or a stranger's, is refused; the manager's creates the account at
/// the setup key's address.
#[test]
fn with_a_manager_only_its_approval_creates_an_account() {
    let g = governed();
    let s = g.setup("managed", &Passkey::labelled("managed"));

    assert!(g.create(&[], &s).is_err(), "no auth");
    assert!(g.create(&[g.approval(&g.stranger, &s)], &s).is_err());
    let account = g
        .create(&[g.approval(&g.onboarder, &s)], &s)
        .expect("the manager approves");
    assert_eq!(account, g.client().get_c_address(&s.pk));
}

/// The manager's approval covers one `create_account` call: it is spent
/// once used, and it creates nothing for another setup key or passkey, or
/// at another factory the same manager serves.
#[test]
fn a_manager_approval_cannot_be_replayed_or_moved() {
    let g = governed();
    let owner = Passkey::labelled("approved");
    let s = g.setup("approved", &owner);
    let approval = g.approval(&g.onboarder, &s);

    let other = g.setup("not-approved", &Passkey::labelled("not-approved"));
    assert!(
        g.create(std::slice::from_ref(&approval), &other).is_err(),
        "another setup key"
    );
    let other_key = g.setup("approved", &Passkey::labelled("not-approved"));
    assert!(
        g.create(std::slice::from_ref(&approval), &other_key)
            .is_err(),
        "another passkey"
    );

    let twin = register(&g.w, "twin-factory", &g.operators, Some(&g.onboarder));
    let here = g.setup("twin", &owner);
    let there = g.setup_at(&twin, "twin", &owner);
    let entry = g.approval(&g.onboarder, &here);
    assert!(
        g.w.with_auths(&[entry], || FactoryClient::new(&g.w.env, &twin)
            .try_create_account(&there.pk, &there.key, &there.sig))
            .is_err(),
        "another factory"
    );

    assert!(g.create(std::slice::from_ref(&approval), &s).is_ok());
    assert!(g.create(&[approval], &s).is_err(), "spent");
}

/// The manager decides only whether an account is created, never whose it
/// is: even its own approval cannot put another passkey at a pending
/// user's address, or use a forged setup signature. The user's own call
/// still succeeds afterwards.
#[test]
fn the_manager_cannot_put_another_passkey_at_a_users_address() {
    let g = governed();
    let owner = g.setup("victim", &Passkey::labelled("victim"));
    let thief = Passkey::labelled("thief");
    let thief_key = BytesN::from_array(&g.w.env, &thief.pubkey());

    let attempts = [
        // The user's setup key with the thief's passkey and the user's
        // signature (which covers the user's passkey only).
        Setup {
            pk: owner.pk.clone(),
            key: thief_key.clone(),
            sig: owner.sig.clone(),
        },
        // The thief's own setup signature over its passkey.
        Setup {
            pk: owner.pk.clone(),
            key: thief_key.clone(),
            sig: g.setup("thief", &thief).sig,
        },
        // No signature at all.
        Setup {
            pk: owner.pk.clone(),
            key: thief_key,
            sig: BytesN::from_array(&g.w.env, &[0; 64]),
        },
    ];
    for attempt in &attempts {
        assert!(g
            .create(&[g.approval(&g.onboarder, attempt)], attempt)
            .is_err());
    }

    let account = g
        .create(&[g.approval(&g.onboarder, &owner)], &owner)
        .expect("the user's own setup");
    let admin =
        nido_integration_tests::SmartAccountClient::new(&g.w.env, &account).get_context_rule(&0);
    assert_eq!(
        admin.signers,
        soroban_sdk::vec![
            &g.w.env,
            Passkey::labelled("victim").signer(&g.w.env, &g.w.verifier)
        ]
    );
}

/// Without a manager, anyone creates an account with no authorization at
/// all, and the admin can open a managed factory that way.
#[test]
fn without_a_manager_creation_needs_no_authorization() {
    let g = governed();
    assert_eq!(FactoryClient::new(&g.w.env, &g.w.factory).manager(), None);
    let s = g.setup_at(&g.w.factory, "open", &Passkey::labelled("open"));
    let world_factory = FactoryClient::new(&g.w.env, &g.w.factory);
    assert_eq!(
        world_factory.create_account(&s.pk, &s.key, &s.sig),
        world_factory.get_c_address(&s.pk)
    );

    let s = g.setup("opened", &Passkey::labelled("opened"));
    assert!(g.create(&[], &s).is_err());
    assert_eq!(g.set_manager(&g.operators, None), Ok(()));
    assert_eq!(g.client().manager(), None);
    assert!(g.create(&[], &s).is_ok());
}
