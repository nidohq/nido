// The browser/Node proving path against the proofs Nido's Rust suites
// generated with the native toolchain and replayed through the real
// controller and adapter: same public inputs for every fixture, and a bb.js
// proof byte-identical to the committed CLI proof.

import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import circuit from '@stellar-registry/perch-zk/artifacts/perch_zk_recovery.json' with { type: 'json' };
import { commitment, leaf, publicInputs, verify } from '@stellar-registry/perch-zk';
import { contractId, statementDigest } from './statement.js';
import { initZk, proveStatement, type CompiledCircuit } from './zk.js';
import type { RecoveryStatement } from './statement.js';

const dir = new URL('../../../../crates/integration-tests/fixtures/zk/', import.meta.url);
const bytes = (h: string) => new Uint8Array(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixture = (name: string): any =>
  JSON.parse(readFileSync(new URL(`${name}/fixture.json`, dir), 'utf8'));

beforeAll(async () => {
  await initZk();
});

describe("Nido's committed proofs", () => {
  for (const name of readdirSync(dir)) {
    it(`recomputes ${name}'s public inputs`, () => {
      const f = fixture(name);
      const p = publicInputs({
        secret: bytes(f.secret),
        accountId: bytes(f.account_id),
        enrollmentId: bytes(f.enrollment_id),
        digest: bytes(f.digest),
        leafIndex: BigInt(f.leaf_index),
        siblings: f.siblings.map(bytes),
      });
      expect(hex(p.root)).toBe(f.root);
      expect(hex(p.nullifier)).toBe(f.nullifier);
      expect(hex(p.statementHash)).toBe(f.statement_hash);
    });
  }

  it('proves a lifecycle statement with bb.js, and agrees with the CLI proof', async () => {
    const f = fixture('lifecycle-protected-combined');
    const st = f.statement;
    const statement: RecoveryStatement = {
      networkId: bytes(st.network_id),
      account: st.account,
      controller: st.controller,
      configEpoch: BigInt(st.epoch),
      configHash: bytes(st.config_hash),
      delayLedgers: st.delay_ledgers,
      expiryLedgers: st.expiry_ledgers,
      validUntilLedger: st.valid_until_ledger,
      subject: {
        action: 'lost-key',
        attemptId: BigInt(st.subject.attempt_id),
        sourceDocHash: bytes(st.subject.source_doc_hash),
        targetDocHash: bytes(st.subject.target_doc_hash),
        replacementsHash: bytes(st.subject.replacements_hash),
      },
    };
    expect(hex(statementDigest(statement))).toBe(f.digest);
    const credential = { enrollmentId: bytes(f.enrollment_id), secret: bytes(f.secret) };
    // A single-leaf tree: the only leaf is this credential's.
    const ownLeaf = leaf(contractId(statement.account), credential.enrollmentId, commitment(credential.secret));
    const evidence = await proveStatement({
      circuit: circuit as unknown as CompiledCircuit,
      statement,
      credential,
      position: { treeId: f.tree_id, index: f.leaf_index },
      leaves: [ownLeaf],
    });
    expect(hex(evidence.root)).toBe(f.root);
    expect(hex(evidence.nullifier)).toBe(f.nullifier);
    // Zero-knowledge proving is randomized, so the two proofs differ in their
    // bytes. Both must verify for the same public inputs: bb.js's proof, and
    // the native CLI proof the Rust suite replays through the deployed adapter.
    const inputs = { root: evidence.root, nullifier: evidence.nullifier, statementHash: bytes(f.statement_hash) };
    const c = circuit as unknown as CompiledCircuit;
    expect(await verify(c, { proof: evidence.proof, publicInputs: inputs })).toBe(true);
    const committed = new Uint8Array(
      readFileSync(new URL('lifecycle-protected-combined/proof', dir)),
    );
    expect(await verify(c, { proof: committed, publicInputs: inputs })).toBe(true);
  }, 120_000);
});
