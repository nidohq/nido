//! Differential corpus for the SDK's PolicyDoc validation
//! (`packages/passkey-sdk/src/policyDoc/validate.ts`, run by `lowerDoc`).
//!
//! The on-chain compiler refuses any document `perch_ir::validate` refuses,
//! so the SDK must refuse exactly the same documents or it builds install
//! plans the chain rejects. This generates a deterministic corpus of random,
//! schema-valid documents — biased towards every `ValidationError` variant —
//! and records `perch_ir::validate`'s verdict for each (the sorted variant
//! names). `validate.test.ts` replays the corpus through the TS port and
//! requires the identical verdict.
//!
//! The test fails if the committed corpus differs from a fresh generation
//! (a generator change, or a perch-ir verdict change). Regenerate with
//! `NIDO_WRITE_VALIDATE_CORPUS=1 cargo test -p nido-integration-tests --test it validate_differential`.

use serde_json::{json, Value};

const CORPUS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/passkey-sdk/src/policyDoc/testdata/validate-differential.json"
);
const DOCS: usize = 600;

const C1: &str = "CBKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIBGS";
const C2: &str = "CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V";
const C3: &str = "CARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEVQO";
const G1: &str = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";
const G2: &str = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA";
/// C1 with a corrupted checksum.
const BAD_CRC: &str = "CBKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIBGT";

/// xorshift64*: deterministic and dependency-free.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
    fn pick<T: Clone>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len())].clone()
    }
    /// Mostly-valid pick: `good` 92% of the time, else one of `bad`.
    fn mostly<T: Clone>(&mut self, good: &[T], bad: &[T]) -> T {
        if self.chance(92) {
            self.pick(good)
        } else {
            self.pick(bad)
        }
    }
}

fn contract_addr(r: &mut Rng) -> String {
    r.mostly(&[C1, C2, C3], &[BAD_CRC, G1, "C", "cbkf"])
        .to_string()
}

fn any_addr(r: &mut Rng) -> String {
    r.mostly(&[C1, C2, G1, G2], &[BAD_CRC, "G", ""]).to_string()
}

fn sha_hex(r: &mut Rng) -> String {
    r.mostly(
        &["00".repeat(32), "0a".repeat(32), "1f".repeat(32)],
        &["AA".repeat(32), "ab".to_string(), "ff".repeat(32)],
    )
}

fn signer(r: &mut Rng, ids: &[&str]) -> Value {
    let id = r.pick(ids);
    if r.chance(50) {
        json!({ "id": id, "address": any_addr(r) })
    } else {
        let key = r.mostly(
            &[
                "aa".repeat(32),
                "bb".repeat(65),
                "AA".repeat(32),
                "0102".to_string(),
            ],
            &[
                String::new(),
                "abc".to_string(),
                "zz".to_string(),
                "ab".repeat(257),
            ],
        );
        json!({ "id": id, "verifier": contract_addr(r), "key": key })
    }
}

fn signer_list(r: &mut Rng, ids: &[&str]) -> Vec<String> {
    let n = r.mostly(&[1usize, 2, 3], &[0usize]);
    (0..n).map(|_| r.pick(ids).to_string()).collect()
}

fn rule(r: &mut Rng, ids: &[&str]) -> Value {
    let name = r.mostly(&["admin", "pay", "swap", "session"], &[""]);
    let scope = if r.chance(70) {
        json!({ "type": "contract", "address": contract_addr(r) })
    } else {
        json!({ "type": "self-admin" })
    };
    let principals = match r.below(10) {
        0..=4 => json!({ "type": "all", "signers": signer_list(r, ids) }),
        5..=8 => {
            let signers = signer_list(r, ids);
            let m = r.mostly(
                &[1u32, signers.len() as u32],
                &[0, signers.len() as u32 + 1],
            );
            json!({ "type": "threshold", "signers": signers, "m": m })
        }
        _ => json!({
            "type": "self-authenticating",
            "policy": contract_addr(r),
            "install-param-hex": r.mostly(&["", "00ff"], &["0", "xy"]),
            "ack": r.mostly(&[perch_ir::ACK_SENTINEL], &["yes"]),
        }),
    };
    let mut obj = json!({ "name": name, "scope": scope, "principals": principals });
    let o = obj.as_object_mut().unwrap();
    if r.chance(40) {
        let n = r.mostly(&[1usize, 2], &[0usize]);
        let fns: Vec<&str> = (0..n)
            .map(|_| {
                r.mostly(
                    &["transfer", "approve", "swap_exact"],
                    &["", "bad-name", "abcdefghijklmnopqrstuvwxyz0123456"],
                )
            })
            .collect();
        o.insert("functions".into(), json!(fns));
    }
    if r.chance(40) {
        let n = r.mostly(&[1usize, 2], &[0usize]);
        let args: Vec<Value> = (0..n)
            .map(|_| {
                let pred = match r.below(5) {
                    0 => json!({ "type": "is-self" }),
                    1 => json!({ "type": "address-eq", "address": any_addr(r) }),
                    2 => {
                        let n = r.mostly(&[1usize, 2], &[0usize]);
                        let vs: Vec<&str> = (0..n).map(|_| r.pick(&["x", "y", "z"])).collect();
                        json!({ "type": "string-in", "values": vs })
                    }
                    3 => json!({ "type": "string-prefix", "prefix": "ab" }),
                    _ => json!({ "type": "u32-eq", "value": 7 }),
                };
                json!({ "index": r.below(3), "pred": pred })
            })
            .collect();
        o.insert("args".into(), json!(args));
    }
    if r.chance(30) {
        o.insert(
            "not-after-ledger".into(),
            json!(r.mostly(&[1u32, 100], &[0])),
        );
    }
    if r.chance(35) {
        let limit = r.mostly(
            &["10", "+5", "170141183460469231731687303715884105727"],
            &[
                "0",
                "-5",
                "-0",
                "",
                "1e3",
                "abc",
                "170141183460469231731687303715884105728",
            ],
        );
        let mut cap = json!({ "limit": limit, "period-ledgers": r.mostly(&[100u32], &[0]) });
        if r.chance(40) {
            let token = match (&o["scope"]["address"], r.chance(70)) {
                (Value::String(scope), true) => scope.clone(),
                _ => contract_addr(r),
            };
            cap["token"] = json!(token);
        }
        o.insert("cap".into(), cap);
    }
    obj
}

fn recovery(r: &mut Rng, ids: &[&str]) -> Value {
    let mut mode = match r.below(3) {
        0 => json!({ "type": "guardian-only" }),
        1 => json!({ "type": "zk-only" }),
        _ => json!({ "type": "combined" }),
    };
    let ty = mode["type"].as_str().unwrap().to_string();
    if ty != "zk-only" {
        let n = r.mostly(&[1usize, 2, 3], &[0usize]);
        let gs: Vec<String> = (0..n).map(|_| any_addr(r)).collect();
        let q = r.mostly(&[1u32, n as u32], &[0, n as u32 + 1]);
        mode["guardians"] = json!(gs);
        mode["quorum"] = json!(q);
    }
    if ty != "guardian-only" {
        mode["adapter"] = json!(contract_addr(r));
        mode["circuit-id"] = json!(sha_hex(r));
        mode["pool"] = json!(contract_addr(r));
        mode["enrollment-id"] = json!(sha_hex(r));
        mode["commitment"] = json!(r.mostly(
            &[
                "00".repeat(32),
                "30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000".into()
            ],
            &[
                "30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001".into(),
                "ab".into()
            ],
        ));
    }
    let n = r.mostly(&[1usize, 2], &[0usize]);
    let replaceable: Vec<&str> = (0..n).map(|_| r.pick(ids)).collect();
    let mut rec = json!({
        "profile": r.pick(&["loss", "protected"]),
        "mode": mode,
        "controller": contract_addr(r),
        "replaceable": replaceable,
        "delay-ledgers": r.mostly(&[10u32], &[0]),
        "expiry-ledgers": r.mostly(&[10u32], &[0]),
        "max-cancels": r.mostly(&[3u32], &[0]),
    });
    if r.chance(30) {
        rec["baseline"] = json!({ "doc-hash": sha_hex(r) });
    }
    rec
}

fn doc(r: &mut Rng) -> Value {
    // Declared ids drawn from a small pool so duplicates and undeclared
    // references both occur; references may name `ghost`.
    let declared = ["a", "b", "c", ""];
    let refs = ["a", "b", "c", "a", "b", "ghost"];
    let signers: Vec<Value> = (0..r.below(4)).map(|_| signer(r, &declared)).collect();
    let rules: Vec<Value> = (0..r.below(4)).map(|_| rule(r, &refs)).collect();
    let mut d = json!({ "version": 1, "signers": signers, "rules": rules });
    if r.chance(25) {
        d["recovery"] = recovery(r, &refs);
    }
    d
}

fn verdict(doc: &Value) -> Vec<String> {
    let parsed = perch_ir::from_json(&doc.to_string()).expect("generated doc parses");
    let mut kinds: Vec<String> = match perch_ir::validate(&parsed) {
        Ok(()) => vec![],
        Err(errors) => errors
            .iter()
            .map(|e| {
                let dbg = format!("{e:?}");
                dbg.split(|c: char| !c.is_alphanumeric())
                    .next()
                    .unwrap()
                    .to_string()
            })
            .collect(),
    };
    kinds.sort();
    kinds
}

#[test]
fn validate_differential_corpus_matches_perch_ir() {
    let mut r = Rng(0x6e69_646f_5f76_616c);
    let cases: Vec<Value> = (0..DOCS)
        .map(|_| {
            let d = doc(&mut r);
            let errors = verdict(&d);
            json!({ "doc": d, "errors": errors })
        })
        .collect();
    let lines: Vec<String> = cases.iter().map(Value::to_string).collect();
    let fresh = format!("[\n{}\n]\n", lines.join(",\n"));

    if std::env::var_os("NIDO_WRITE_VALIDATE_CORPUS").is_some() {
        std::fs::write(CORPUS, &fresh).expect("write corpus");
        return;
    }
    let committed = std::fs::read_to_string(CORPUS).expect("read committed corpus");
    assert!(
        committed == fresh,
        "validate-differential corpus is stale; regenerate with NIDO_WRITE_VALIDATE_CORPUS=1"
    );
}
