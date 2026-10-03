//! Real ZK evidence for the recovery suites.
//!
//! Every proof the suites submit is a real `UltraHonk` proof of Perch's release
//! circuit (`vendor/perch/circuits/perch_zk_recovery`, depth 32), verified on
//! chain by the Perch adapter's embedded audited verifier. Nothing here mocks
//! a verifier or an adapter.
//!
//! A proof binds the statement digest the controller builds, the account, the
//! enrollment, and a root of the enrolled pool, so it is specific to one
//! moment of one test. [`evidence`] computes every public input natively from
//! the live pool (the same Poseidon2 host function the pool runs) and then:
//!
//! - with `NIDO_ZK_PROVE=1`, proves those inputs with Perch's pinned
//!   nargo/bb (`NARGO`/`BB`, see `just gen-zk-fixtures`) and writes the proof
//!   to `fixtures/zk/<name>/`;
//! - otherwise replays the committed proof, after checking the fixture was
//!   proved for exactly this statement digest, root, and nullifier. A drifted
//!   statement fails here, with the regeneration command, rather than as an
//!   opaque `ProofRejected` from the chain.
//!
//! The proofs are zero-knowledge (the verifier's `UltraKeccakZKFlavor`), so
//! proving is randomized: a re-proof of the same statement has different
//! bytes. What a regeneration must reproduce is each `fixture.json`.

extern crate std;

use crate::world::{contract_id, World};
use perch_recovery_interface::credential::ZkEnrollment;
use perch_recovery_interface::zk::ZkEvidence;
use perch_recovery_interface::RecoveryStatement;
use perch_zk_prover::{hex, Bytes32, Inputs, Toolchain, Tree};
use serde::{Deserialize, Serialize};
use soroban_sdk::{Address, Bytes, BytesN, Env};
use std::path::PathBuf;
use std::string::{String, ToString};
use std::vec::Vec;

/// The Noir package every fixture is proved against (Perch's release
/// circuit; its VK is the one compiled into the adapter).
pub const CIRCUIT: &str = "perch_zk_recovery";

/// A ZK credential a wallet holds: the enrollment id its document names and
/// the secret behind the enrolled commitment.
#[derive(Clone, Debug)]
pub struct ZkCredential {
    pub enrollment_id: Bytes32,
    pub secret: Bytes32,
}

impl ZkCredential {
    /// The deterministic credential for `label`: a random-looking id and a
    /// canonical field-element secret (top three bits clear, so `< r`).
    #[must_use]
    pub fn new(label: &str) -> Self {
        use sha2::{Digest, Sha256};
        let enrollment_id: Bytes32 =
            Sha256::digest(std::format!("nido-it/zk-enrollment/{label}")).into();
        let mut secret: Bytes32 = Sha256::digest(std::format!("nido-it/zk-secret/{label}")).into();
        secret[0] &= 0x1f;
        Self {
            enrollment_id,
            secret,
        }
    }

    /// `H(DOM_LEAF, secret)`: what the document's `commitment` carries.
    #[must_use]
    pub fn commitment(&self) -> Bytes32 {
        perch_zk_prover::commitment(&perch_zk_prover::host(), &self.secret)
    }

    /// The document's ZK enrollment for this credential.
    #[must_use]
    pub fn enrollment(&self, env: &Env) -> ZkEnrollment {
        ZkEnrollment {
            id: BytesN::from_array(env, &self.enrollment_id),
            commitment: BytesN::from_array(env, &self.commitment()),
        }
    }
}

/// The statement a fixture proves, field by field, as the controller built
/// it: what another implementation (the SDK's TypeScript encoder) re-encodes
/// to `encoding` and `digest`.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
struct StatementMeta {
    network_id: String,
    account: String,
    controller: String,
    epoch: u64,
    config_hash: String,
    delay_ledgers: u32,
    expiry_ledgers: u32,
    valid_until_ledger: u32,
    /// `lost-key`, `compromise`, `cancel`, `reconfigure`, or `upgrade`.
    action: String,
    subject: serde_json::Value,
    /// The canonical encoding (`docs/recovery/statement.md`).
    encoding: String,
}

/// What a committed fixture was proved for, with the full witness, so the
/// SDK can recompute the public inputs and re-prove with bb.js. The secrets
/// are test credentials derived from labels.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
struct FixtureMeta {
    description: String,
    circuit: String,
    statement: StatementMeta,
    account_id: String,
    enrollment_id: String,
    secret: String,
    digest: String,
    tree_id: u32,
    leaf_index: u64,
    siblings: Vec<String>,
    root: String,
    nullifier: String,
    statement_hash: String,
}

fn h(b: &BytesN<32>) -> String {
    hex(&b.to_array())
}

fn statement_meta(env: &Env, s: &RecoveryStatement) -> StatementMeta {
    use perch_recovery_interface::statement::{ConfigChange, StatementSubject};
    use serde_json::json;
    let (action, subject) = match &s.subject {
        StatementSubject::LostKey(a) | StatementSubject::Compromise(a) => (
            if matches!(s.subject, StatementSubject::LostKey(_)) {
                "lost-key"
            } else {
                "compromise"
            },
            json!({
                "attempt_id": a.attempt_id,
                "source_doc_hash": h(&a.source_doc_hash),
                "target_doc_hash": h(&a.target_doc_hash),
                "replacements_hash": h(&a.replacements_hash),
            }),
        ),
        StatementSubject::Cancel(c) => (
            "cancel",
            json!({ "attempt_id": c.attempt_id, "attempt_statement": h(&c.attempt_statement) }),
        ),
        StatementSubject::Reconfigure(ConfigChange::Set(next)) => (
            "reconfigure",
            json!({ "change": "set", "new_config_hash": h(next) }),
        ),
        StatementSubject::Reconfigure(ConfigChange::Remove) => {
            ("reconfigure", json!({ "change": "remove" }))
        }
        StatementSubject::Upgrade(u) => (
            "upgrade",
            json!({ "request_id": u.request_id, "wasm_hash": h(&u.wasm_hash) }),
        ),
    };
    let encoding = s.encode(env).expect("encodable statement");
    let mut bytes = std::vec![0u8; encoding.len() as usize];
    encoding.copy_into_slice(&mut bytes);
    StatementMeta {
        network_id: h(&s.network_id),
        account: crate::world::strkey(&s.account),
        controller: crate::world::strkey(&s.controller),
        epoch: s.config.epoch,
        config_hash: h(&s.config.config_hash),
        delay_ledgers: s.timing.delay_ledgers,
        expiry_ledgers: s.timing.expiry_ledgers,
        valid_until_ledger: s.timing.valid_until_ledger,
        action: action.to_string(),
        subject,
        encoding: hex(&bytes),
    }
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/zk")
}

fn circuits_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vendor/perch/circuits")
}

fn proving() -> bool {
    std::env::var("NIDO_ZK_PROVE").is_ok_and(|v| v == "1")
}

/// Trees larger than this are synthesized boundary trees (see
/// [`synthesize_prefix`]); real suites never insert this many leaves.
const SYNTHETIC: u64 = 1 << 16;

/// The Merkle path for `index` in `tree_id`, rebuilt from the pool's own
/// stored leaves the way a wallet without an indexer would. In a synthesized
/// boundary tree every slot before the real leaves is empty, so the last
/// slot's siblings are the empty subtrees.
fn witness(w: &World, tree_id: u32, index: u64) -> Vec<Bytes32> {
    let pool = w.pool_client();
    let info = pool.tree(&tree_id);
    let depth = perch_zk_pool::TREE_DEPTH;
    if info.size > SYNTHETIC {
        assert_eq!(
            index,
            (1u64 << depth) - 1,
            "only the last slot of a synthesized tree is provable"
        );
        return perch_zk_primitives::ZERO_HASHES[..depth as usize].to_vec();
    }
    let mut leaves = Vec::new();
    let mut start = 0u64;
    while start < info.size {
        let page = pool.leaves(&tree_id, &start, &perch_zk_pool::MAX_PAGE);
        for leaf in page.iter() {
            leaves.push(leaf.to_array());
        }
        start += u64::from(page.len());
    }
    Tree::new(&perch_zk_prover::host(), depth, &leaves).path(index)
}

/// Fill tree 0 of the world's pool with `2^32 - 1` empty slots, by writing
/// the pool's frontier directly: the next insertion takes the last slot,
/// seals the tree, and rolls the pool over to tree 1. This is the only way
/// to reach the depth-32 boundary without billions of inserts; everything
/// after it runs through the real pool wasm.
pub fn synthesize_prefix(w: &World) {
    use perch_zk_pool::{PoolKey, TreeState};
    let env = &w.env;
    let depth = perch_zk_pool::TREE_DEPTH as usize;
    let zeros = &perch_zk_primitives::ZERO_HASHES;
    let mut frontier = soroban_sdk::Vec::new(env);
    for z in &zeros[..depth] {
        frontier.push_back(BytesN::from_array(env, z));
    }
    let state = TreeState {
        size: (1u64 << depth) - 1,
        root: BytesN::from_array(env, &zeros[depth]),
        frontier,
    };
    env.as_contract(&w.pool, || {
        env.storage().persistent().set(&PoolKey::Tree(0), &state);
    });
}

/// Real evidence that `credential`, enrolled by `account` in the world's pool,
/// proves `statement` against its tree's current root. `name` is the fixture
/// directory (`fixtures/zk/<name>/`).
///
/// # Panics
/// Panics if the leaf was never inserted, if proving fails, or if the
/// committed fixture was proved for a different statement, root, or
/// nullifier (rerun `just gen-zk-fixtures`).
#[must_use]
pub fn evidence(
    w: &World,
    name: &str,
    description: &str,
    account: &Address,
    credential: &ZkCredential,
    statement: &RecoveryStatement,
) -> ZkEvidence {
    let env = &w.env;
    let digest = w.digest(statement).to_array();
    let pool = w.pool_client();
    let at = pool
        .enrollment(account, &BytesN::from_array(env, &credential.enrollment_id))
        .expect("the credential's leaf was inserted");
    let host = perch_zk_prover::host();
    let inputs = Inputs::new(
        &host,
        credential.secret,
        contract_id(account),
        credential.enrollment_id,
        digest,
        at.index,
        witness(w, at.tree_id, at.index),
    );
    assert_eq!(
        inputs.root,
        pool.tree(&at.tree_id).root.to_array(),
        "the witness rebuilt from the pool's leaves reaches the tree's current root"
    );
    let meta = FixtureMeta {
        description: description.to_string(),
        circuit: CIRCUIT.to_string(),
        statement: statement_meta(env, statement),
        account_id: hex(&inputs.account_id),
        enrollment_id: hex(&inputs.enrollment_id),
        secret: hex(&inputs.secret),
        digest: hex(&digest),
        tree_id: at.tree_id,
        leaf_index: at.index,
        siblings: inputs.siblings.iter().map(|s| hex(s)).collect(),
        root: hex(&inputs.root),
        nullifier: hex(&inputs.nullifier),
        statement_hash: hex(&inputs.statement_hash),
    };

    let dir = fixtures_dir().join(name);
    let proof = if proving() {
        let tc = Toolchain::from_env().expect("Perch's pinned nargo/bb (just gen-zk-fixtures)");
        let work = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/zk-work")
            .join(name);
        let proved = perch_zk_prover::prove(&tc, &circuits_dir(), CIRCUIT, &inputs, &work)
            .unwrap_or_else(|e| panic!("proving {name}: {e}"));
        assert_eq!(
            proved.public_inputs,
            inputs.public_inputs(&host),
            "bb committed to the public inputs computed natively"
        );
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("proof"), &proved.proof).unwrap();
        std::fs::write(
            dir.join("fixture.json"),
            serde_json::to_string_pretty(&meta).unwrap() + "\n",
        )
        .unwrap();
        proved.proof
    } else {
        let committed: FixtureMeta = serde_json::from_slice(
            &std::fs::read(dir.join("fixture.json"))
                .unwrap_or_else(|_| panic!("missing fixture {name}: run `just gen-zk-fixtures`")),
        )
        .unwrap();
        assert_eq!(
            committed, meta,
            "fixture {name} was proved for a different statement, root, or nullifier; \
             rerun `just gen-zk-fixtures`"
        );
        std::fs::read(dir.join("proof")).unwrap()
    };

    ZkEvidence {
        tree_id: at.tree_id,
        root: BytesN::from_array(env, &inputs.root),
        nullifier: BytesN::from_array(env, &inputs.nullifier),
        proof: Bytes::from_slice(env, &proof),
    }
}
