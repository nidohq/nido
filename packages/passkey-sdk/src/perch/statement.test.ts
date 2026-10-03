// Parity of the statement encodings with two independent sources:
//  - Perch's vectors (`testdata/recovery/statement-v2.json`), written by a
//    standard-library Python implementation of statement.md;
//  - every statement Nido's integration suites built through the real
//    controller and proved (`crates/integration-tests/fixtures/zk/`).

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  credentialFingerprint,
  encodeCredential,
  encodeReplacementSet,
  encodeStatement,
  replacementSetHash,
  sortReplacements,
  statementDigest,
  type Credential,
  type RecoveryStatement,
  type StatementSubject,
} from './statement.js';

const root = new URL('../../../../', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytes = (h: string) => new Uint8Array(Buffer.from(h.replace(/^0x/, ''), 'hex'));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function subject(action: string, s: any): StatementSubject {
  switch (action) {
    case 'lost-key':
    case 'compromise':
      return {
        action,
        attemptId: BigInt(s.attempt_id),
        sourceDocHash: bytes(s.source_doc_hash),
        targetDocHash: bytes(s.target_doc_hash),
        replacementsHash: bytes(s.replacements_hash),
      };
    case 'cancel':
      return { action, attemptId: BigInt(s.attempt_id), attemptStatement: bytes(s.attempt_statement) };
    case 'reconfigure':
      return {
        action,
        change:
          s.change === 'set'
            ? { kind: 'set', newConfigHash: bytes(s.new_config_hash) }
            : { kind: 'remove' },
      };
    case 'upgrade':
      return { action, requestId: BigInt(s.request_id), wasmHash: bytes(s.wasm_hash) };
    default:
      throw new Error(`unknown action ${action}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function credential(c: any): Credential {
  return c.kind === 'delegated'
    ? { kind: 'delegated', address: c.address }
    : { kind: 'external', verifier: c.verifier, key: bytes(c.key) };
}

describe("Perch's statement vectors", () => {
  const vectors = read('vendor/perch/testdata/recovery/statement-v2.json');

  for (const v of vectors.statements) {
    it(`encodes the ${v.name} statement byte for byte`, () => {
      const s: RecoveryStatement = {
        networkId: bytes(v.network_id),
        account: v.account,
        controller: v.controller,
        configEpoch: BigInt(v.config_epoch),
        configHash: bytes(v.config_hash),
        delayLedgers: v.delay_ledgers,
        expiryLedgers: v.expiry_ledgers,
        validUntilLedger: v.valid_until_ledger,
        subject: subject(v.action, v.subject),
      };
      expect(hex(encodeStatement(s))).toBe(v.encoding);
      expect(hex(statementDigest(s))).toBe(v.digest);
    });
  }

  for (const c of vectors.credentials) {
    it(`fingerprints the ${c.kind} credential`, () => {
      expect(hex(encodeCredential(credential(c)))).toBe(c.encoding);
      expect(hex(credentialFingerprint(credential(c)))).toBe(c.fingerprint);
    });
  }

  it('hashes the replacement set', () => {
    const r = vectors.replacements;
    const set = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signers: r.signers.map((s: any) => ({ signerId: s.signer_id, credential: credential(s.credential) })),
      zkEnrollment: r.zk_enrollment && {
        id: bytes(r.zk_enrollment.id),
        commitment: bytes(r.zk_enrollment.commitment),
      },
    };
    expect(hex(encodeReplacementSet(set))).toBe(r.encoding);
    expect(hex(replacementSetHash(set))).toBe(r.hash);
  });

  it('refuses an unsorted or duplicated replacement set', () => {
    const c: Credential = { kind: 'delegated', address: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ' };
    const unsorted = { signers: [{ signerId: 'b', credential: c }, { signerId: 'a', credential: c }] };
    expect(() => encodeReplacementSet(unsorted)).toThrow(/ascending/);
    expect(sortReplacements(unsorted).signers.map((s) => s.signerId)).toEqual(['a', 'b']);
    expect(() =>
      sortReplacements({ signers: [{ signerId: 'a', credential: c }, { signerId: 'a', credential: c }] }),
    ).toThrow(/duplicate/);
  });
});

describe("statements Nido's integration suites built through the controller", () => {
  const dir = new URL('crates/integration-tests/fixtures/zk/', root);
  const names = readdirSync(dir);

  it('covers every fixture', () => {
    expect(names.length).toBeGreaterThanOrEqual(19);
  });

  for (const name of names) {
    it(`re-encodes ${name} to the digest it was proved for`, () => {
      const f = JSON.parse(readFileSync(new URL(`${name}/fixture.json`, dir), 'utf8'));
      const st = f.statement;
      const s: RecoveryStatement = {
        networkId: bytes(st.network_id),
        account: st.account,
        controller: st.controller,
        configEpoch: BigInt(st.epoch),
        configHash: bytes(st.config_hash),
        delayLedgers: st.delay_ledgers,
        expiryLedgers: st.expiry_ledgers,
        validUntilLedger: st.valid_until_ledger,
        subject: subject(st.action, st.subject),
      };
      expect('0x' + hex(encodeStatement(s))).toBe(st.encoding);
      expect('0x' + hex(statementDigest(s))).toBe(f.digest);
    });
  }
});
