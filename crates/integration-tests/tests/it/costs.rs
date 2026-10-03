//! Resource costs of the full recovery transactions on Nido's stack: the §2
//! rows of Perch's `docs/recovery/budgets.md`, measured on the wasm builds
//! with real proofs and enforcing authorization, and gated at that file's
//! proposed budget of 75% of each per-transaction network limit.
//!
//! Each row is one top-level invocation, read with `cost_estimate()` right
//! after it runs. Worst cases follow the budgets table where the test host
//! can reach them: the enrollment seals a depth-32 tree, the evidence rows
//! are the promoting submissions under `Protected`/`Combined`, and the
//! completion rotates the ZK credential (a pool insertion) and revokes the
//! replaced passkey. Fees, transaction size, and latency need a network;
//! they are measured on testnet once Perch's release deployment exists.
//!
//! `cargo test -p nido-integration-tests --test it costs -- --nocapture`
//! prints one JSON object per row.

use nido_integration_tests::world::{
    world, Account, Enrolled, Mode, Passkey, Profile, World, DELAY,
};
use nido_integration_tests::zk::{self, ZkCredential};
use nido_integration_tests::UPGRADE_TARGET_WASM;
use perch_recovery::EvidenceDomain::{Cancel, Initiate};
use perch_recovery_interface::account::ACCOUNT_UPGRADE_DELAY_LEDGERS;
use perch_recovery_interface::statement::ConfigChange;
use perch_recovery_interface::{RecoveryAction, StatementSubject, UpgradeSubject};

/// Protocol 29 per-transaction limits (`stellar network settings`,
/// 2026-10-03, identical on testnet and mainnet; Perch
/// `docs/zk/measurements.md`).
const TX_MAX_INSTRUCTIONS: i64 = 400_000_000;
const TX_MEMORY_LIMIT: i64 = 41_943_040;
const TX_MAX_WRITE_BYTES: u32 = 132_096;
const TX_MAX_WRITE_ENTRIES: u32 = 200;

/// The proposed budget: 75% of each limit.
fn within_budget(limit: i64, used: i64) -> bool {
    used * 4 <= limit * 3
}

#[derive(Default)]
struct Report {
    rows: std::vec::Vec<String>,
    over: std::vec::Vec<String>,
}

impl Report {
    /// Record the invocation that just ran.
    fn row(&mut self, w: &World, case: &str) {
        let r = w.env.cost_estimate().resources();
        let line = std::format!(
            "{{\"case\":\"{case}\",\"instructions\":{},\"instructions_pct\":{}.{},\"mem_bytes\":{},\"read_entries\":{},\"write_entries\":{},\"write_bytes\":{},\"events_bytes\":{}}}",
            r.instructions,
            r.instructions * 100 / TX_MAX_INSTRUCTIONS,
            r.instructions * 1000 / TX_MAX_INSTRUCTIONS % 10,
            r.mem_bytes,
            r.memory_read_entries + r.disk_read_entries,
            r.write_entries,
            r.write_bytes,
            r.contract_events_size_bytes,
        );
        std::println!("{line}");
        let ok = within_budget(TX_MAX_INSTRUCTIONS, r.instructions)
            && within_budget(TX_MEMORY_LIMIT, r.mem_bytes)
            && within_budget(TX_MAX_WRITE_BYTES.into(), r.write_bytes.into())
            && within_budget(TX_MAX_WRITE_ENTRIES.into(), r.write_entries.into());
        if !ok {
            self.over.push(line.clone());
        }
        self.rows.push(line);
    }

    fn assert_within_budget(&self) {
        assert!(
            self.over.is_empty(),
            "rows over 75% of a network limit:\n{}",
            self.over.join("\n")
        );
    }
}

fn quorum(w: &World, e: &Enrolled, attempt: u64, domain: perch_recovery::EvidenceDomain) {
    w.try_guardian(&e.account, &e.guardians[0], attempt, domain)
        .unwrap();
    w.try_guardian(&e.account, &e.guardians[1], attempt, domain)
        .unwrap();
}

/// A `Protected` `Combined` account from enrollment through a proven
/// reconfiguration, a cancelled attempt, a completed recovery, and a proven
/// upgrade.
#[test]
#[allow(clippy::too_many_lines)] // one account's transactions, in order
fn protected_combined_transactions_fit_the_budget() {
    let w = world();
    let mut report = Report::default();

    // Enrollment through apply_doc, inserting the leaf that seals tree 0.
    zk::synthesize_prefix(&w);
    let mut e = w.enrolled("costs", Profile::Protected, Mode::Combined);
    report.row(&w, "enroll_zk_apply_doc_sealing_a_tree");
    let refs: std::vec::Vec<&Account> = e.guardians.iter().collect();

    // Protected reconfiguration: recorded quorum and proof, consumed by an
    // apply_doc that enrolls a new credential (a pool insertion).
    let cred2 = ZkCredential::new("costs/reconfigured");
    let mut next = w.recovery(
        Profile::Protected,
        Mode::Combined,
        &refs,
        2,
        Some(cred2.enrollment(&w.env)),
    );
    next.max_cancels = e.recovery.max_cancels;
    let next_doc = w.doc(&e.account, Some(next.clone()));
    let change = StatementSubject::Reconfigure(ConfigChange::Set(w.config_hash(&next_doc)));
    let until = w.ledger() + 50;
    w.try_approve_change(&e.account, &e.guardians[0], &change, until)
        .unwrap();
    report.row(&w, "approve_change");
    w.try_approve_change(&e.account, &e.guardians[1], &change, until)
        .unwrap();
    let proof = zk::evidence(
        &w,
        "costs-reconfigure",
        "costs: Protected Combined reconfiguration, ZK half",
        &e.account.address,
        e.zk.as_ref().unwrap(),
        &w.ctl()
            .change_statement(&e.account.address, &change, &until),
    );
    w.ctl()
        .submit_zk_change(&e.account.address, &change, &until, &proof);
    report.row(&w, "submit_zk_change");
    w.apply(&e.account, &next_doc, until).unwrap();
    report.row(&w, "protected_reconfiguration_apply_doc");
    e.recovery = next;
    e.zk = Some(cred2.clone());

    // An attempt authorized by a promoting guardian approval, then cancelled
    // with both factors (the proof last).
    let first_owner = Passkey::labelled("costs/new-owner-1");
    let rotated1 = ZkCredential::new("costs/rotated-1");
    let replacements = w.replacements(&first_owner, Some(rotated1.enrollment(&w.env)));
    let a = w.begin_lost_key(&e.account, &replacements).unwrap();
    report.row(&w, "begin_lost_key");
    let proof = zk::evidence(
        &w,
        "costs-initiate-a",
        "costs: initiation of the attempt that is cancelled",
        &e.account.address,
        &cred2,
        &w.statement(&e.account, a, Initiate),
    );
    w.ctl().submit_zk(&e.account.address, &a, &Initiate, &proof);
    w.try_guardian(&e.account, &e.guardians[0], a, Initiate)
        .unwrap();
    w.try_guardian(&e.account, &e.guardians[1], a, Initiate)
        .unwrap();
    report.row(&w, "submit_guardian_promoting_protected");
    quorum(&w, &e, a, Cancel);
    let proof = zk::evidence(
        &w,
        "costs-cancel-a",
        "costs: the cancelling proof, submitted last",
        &e.account.address,
        &cred2,
        &w.statement(&e.account, a, Cancel),
    );
    w.ctl().submit_zk(&e.account.address, &a, &Cancel, &proof);
    report.row(&w, "cancellation_combined_last_factor");

    // An attempt authorized by a promoting proof and completed with a ZK
    // rotation.
    let second_owner = Passkey::labelled("costs/new-owner-2");
    let rotated2 = ZkCredential::new("costs/rotated-2");
    let replacements = w.replacements(&second_owner, Some(rotated2.enrollment(&w.env)));
    let source = w.account(&e.account).applied_doc().unwrap();
    let b = w.begin_lost_key(&e.account, &replacements).unwrap();
    quorum(&w, &e, b, Initiate);
    let proof = zk::evidence(
        &w,
        "costs-initiate-b",
        "costs: the promoting proof of the attempt that completes",
        &e.account.address,
        &cred2,
        &w.statement(&e.account, b, Initiate),
    );
    w.ctl().submit_zk(&e.account.address, &b, &Initiate, &proof);
    report.row(&w, "submit_zk_promoting_combined");
    w.advance(DELAY);
    let target = w.target_bytes(&e.account, RecoveryAction::LostKey, &source, &replacements);
    w.complete(&e.account, &target).unwrap();
    report.row(&w, "completion_apply_doc_with_zk_rotation");

    // Ordinary authorization through the account's __check_auth (reserved
    // names, freeze mirror, then OZ), directly and through execute.
    let mut owner = e.account.clone();
    owner.keys[0].1 = second_owner;
    assert!(w.activity(&owner, "owner"));
    report.row(&w, "ordinary_activity_direct");
    w.execute(&owner, "owner").unwrap();
    report.row(&w, "ordinary_activity_execute");

    // Protected upgrade, last: the target is a fixed Wasm (its hash is in the
    // proof's statement), so the account runs nothing after it. The owner is
    // the recovered passkey and the ZK half is the rotated credential.
    let code = w.env.deployer().upload_contract_wasm(UPGRADE_TARGET_WASM);
    let upgrade = StatementSubject::Upgrade(UpgradeSubject {
        request_id: w.account(&owner).next_upgrade_request_id(),
        wasm_hash: code.clone(),
    });
    let until = w.ledger() + 50;
    quorum_change(&w, &e, &upgrade, until);
    let proof = zk::evidence(
        &w,
        "costs-upgrade",
        "costs: Protected Combined upgrade approval, ZK half",
        &owner.address,
        &rotated2,
        &w.ctl().change_statement(&owner.address, &upgrade, &until),
    );
    w.ctl()
        .submit_zk_change(&owner.address, &upgrade, &until, &proof);
    let request = w.schedule_upgrade(&owner, &code, until).unwrap();
    report.row(&w, "protected_schedule_upgrade");
    w.advance(ACCOUNT_UPGRADE_DELAY_LEDGERS);
    assert_eq!(w.execute_upgrade(&owner, request), Ok(true));
    report.row(&w, "execute_upgrade");

    report.assert_within_budget();
}

fn quorum_change(w: &World, e: &Enrolled, subject: &StatementSubject, until: u32) {
    for g in &e.guardians[..2] {
        w.try_approve_change(&e.account, g, subject, until).unwrap();
    }
}

/// Compromise recovery's baseline publication and attempt opening, which
/// both compile a document on chain.
#[test]
fn compromise_transactions_fit_the_budget() {
    let w = world();
    let mut report = Report::default();
    let account = w.mint(
        "costs-compromise",
        Passkey::labelled("costs-compromise/owner"),
        std::vec![("device", Passkey::labelled("costs-compromise/device"))],
    );
    let guardians: std::vec::Vec<Account> = (0..3)
        .map(|i| {
            w.guardian(
                &std::format!("costs-compromise/g{i}"),
                Passkey::labelled(&std::format!("costs-compromise/g{i}")),
            )
        })
        .collect();
    let refs: std::vec::Vec<&Account> = guardians.iter().collect();
    let baseline = w.doc(&account, None);
    let mut recovery = w.recovery(Profile::Protected, Mode::Guardian, &refs, 2, None);
    recovery.baseline = Some(w.doc_hash(&baseline));
    w.apply(&account, &w.doc(&account, Some(recovery)), 0)
        .unwrap();

    w.ctl()
        .publish_baseline(&account.address, &baseline.bytes(&w));
    report.row(&w, "publish_baseline");
    let replacements = w.replacements(&Passkey::labelled("costs-compromise/new"), None);
    let _ = w.ctl().begin_compromise(&account.address, &replacements);
    report.row(&w, "begin_compromise");
    report.assert_within_budget();
}
