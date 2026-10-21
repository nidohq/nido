//! What the wallet reads back after setting up an account, for an account
//! the user's own `create_account` made and for two it did not.
//!
//! The factory derives the address from a one-time setup key and puts there
//! only the passkey that setup key signed, so a front-runner needs the setup
//! secret itself, as a thief who reads the browser's storage before the
//! passkey exists would have it. This suite creates three accounts through
//! the real factory and Perch account wasm and records, per account, the two
//! things the wallet reads over RPC before trusting a new account: the
//! contract-instance ledger entry (its wasm hash) and the `configuration()`
//! view, as XDR.
//!
//! - `created`: the owner's own setup.
//! - `claimed`: a thief holding the owner's setup secret binds its own key
//!   first; the owner's `create_account` then fails, and the address is the
//!   claimant's.
//! - `handedOver`: a thief claims the address, then applies a document that
//!   names the owner's key as admin while making itself the recovery
//!   guardian. The admin key now matches; the account is still not the
//!   owner's.
//!
//! `newAccount.test.ts` decodes the recorded bytes as the wallet does and
//! requires it to accept `created` and refuse the other two. The test fails
//! if the committed record differs from a fresh one (a re-pin moves the
//! account wasm and infra addresses). Regenerate with
//! `NIDO_WRITE_NEW_ACCOUNT_READS=1 cargo test -p nido-integration-tests --test it new_account_reads`.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use nido_integration_tests::world::{
    strkey, world, Account, Doc, FactoryClient, Mode, Passkey, Profile, SetupKey, World,
};
use nido_integration_tests::PERCH_ACCOUNT_WASM;
use perch_account::PerchAccountClient;
use perch_smart_account::infra;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use soroban_sdk::xdr::{LedgerKey, Limits, ScAddress, ScVal, WriteXdr};
use soroban_sdk::{Address, BytesN};

const READS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/passkey-sdk/src/perch/testdata/new-account-reads.json"
);

fn factory(w: &World) -> FactoryClient<'_> {
    FactoryClient::new(&w.env, &w.factory)
}

/// `create_account` for setup key `label`, binding `key`.
fn create(w: &World, label: &str, key: &BytesN<65>) -> Result<Address, ()> {
    let setup = SetupKey::labelled(label);
    factory(w)
        .try_create_account(
            &setup.public(&w.env),
            key,
            &setup.bind(&w.env, &w.factory, key),
        )
        .map(Result::unwrap)
        .map_err(|_| ())
}

/// The account's contract-instance ledger entry data, as RPC's
/// `getLedgerEntries` returns it.
fn instance_entry(w: &World, account: &Address) -> String {
    let wanted: ScAddress = account.clone().into();
    let snapshot = w.env.to_ledger_snapshot();
    let (_, (entry, _)) = snapshot
        .ledger_entries
        .iter()
        .find(|(key, _)| {
            matches!(
                key.as_ref(),
                LedgerKey::ContractData(k)
                    if k.contract == wanted && k.key == ScVal::LedgerKeyContractInstance
            )
        })
        .expect("the account's instance entry");
    STANDARD.encode(entry.data.to_xdr(Limits::none()).unwrap())
}

/// What the wallet reads for `account`.
fn reads(w: &World, account: &Address) -> Value {
    let configuration = w.sc(PerchAccountClient::new(&w.env, account).configuration());
    json!({
        "account": strkey(account),
        "instance": instance_entry(w, account),
        "configuration": STANDARD.encode(configuration.to_xdr(Limits::none()).unwrap()),
    })
}

#[test]
fn new_account_reads() {
    let w = world();
    let owner = Passkey::labelled("new-account/owner");
    let claimant = Passkey::labelled("new-account/claimant");
    let owner_key = BytesN::from_array(&w.env, &owner.pubkey());
    let claimant_key = BytesN::from_array(&w.env, &claimant.pubkey());

    // The owner's own setup.
    let created = create(&w, "created", &owner_key).unwrap();

    // A thief with the owner's setup secret binds its own key first; the
    // owner's call is then refused, the setup key being used.
    let claimed = create(&w, "claimed", &claimant_key).unwrap();
    assert_eq!(
        claimed,
        factory(&w).get_c_address(&SetupKey::labelled("claimed").public(&w.env))
    );
    assert!(create(&w, "claimed", &owner_key).is_err());

    // A thief that hands the admin rule to the owner's key while keeping
    // recovery for itself.
    let handed = create(&w, "handed-over", &claimant_key).unwrap();
    let guardian = w.guardian("new-account/claimant-guardian", claimant.clone());
    let as_claimant = Account {
        address: handed.clone(),
        keys: std::vec![("claimant", claimant.clone())],
    };
    let doc = Doc {
        signers: std::vec![("owner", owner.pubkey())],
        rules: std::vec![],
        recovery: Some(w.recovery(Profile::Loss, Mode::Guardian, &[&guardian], 1, None)),
    };
    w.apply_bytes_as(&as_claimant, "claimant", &doc.bytes(&w), 0)
        .expect("the claimant's document");
    let admin =
        PerchAccountClient::new(&w.env, &handed).get_context_rule(&w.rule_id(&handed, "admin"));
    assert_eq!(
        admin.signers,
        soroban_sdk::vec![&w.env, owner.signer(&w.env, &w.verifier)],
        "the admin key is the owner's"
    );

    let fresh = json!({
        "deployment": {
            "accountWasmHash": hex::encode(Sha256::digest(PERCH_ACCOUNT_WASM)),
            "webauthnVerifier": strkey(&w.verifier),
            "docCompiler": strkey(&infra::perch_doc_compiler::address(&w.env)),
            "interpreter": strkey(&infra::perch_interpreter::address(&w.env)),
            "spendingLimit": strkey(&infra::perch_spending_limit::address(&w.env)),
        },
        "ownerKey": hex::encode(owner.pubkey()),
        "claimantKey": hex::encode(claimant.pubkey()),
        "created": reads(&w, &created),
        "claimed": reads(&w, &claimed),
        "handedOver": reads(&w, &handed),
    });
    let fresh = serde_json::to_string_pretty(&fresh).unwrap() + "\n";

    if std::env::var_os("NIDO_WRITE_NEW_ACCOUNT_READS").is_some() {
        std::fs::write(READS, &fresh).expect("write new-account reads");
        return;
    }
    let committed = std::fs::read_to_string(READS).expect("read committed new-account reads");
    assert!(
        committed == fresh,
        "new-account reads are stale; regenerate with NIDO_WRITE_NEW_ACCOUNT_READS=1"
    );
}
