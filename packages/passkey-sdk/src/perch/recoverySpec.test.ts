// `recoverySpec` and `withRecovery` refuse locally what the document
// compiler would refuse: a quorum larger than the guardian set, no
// replaceable signer, or a replaceable id the document does not declare.

import { describe, expect, it } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc } from '../policyDoc/index.js';
import { TESTNET } from './deployment.js';
import { recoverySpec, withRecovery } from './doc.js';
import type { RecoveryChoice } from './doc.js';

const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const GUARDIANS = [1, 2].map((n) => StrKey.encodeContract(new Uint8Array(32).fill(n)));

const doc = buildPolicyDoc({
  signers: [{ id: 'admin', kind: 'passkey', verifier: VERIFIER, publicKey: new Uint8Array(65).fill(7) }],
  permissions: [{ name: 'admin', on: 'self-admin', by: ['admin'] }],
});

const choice = (over: Partial<RecoveryChoice> = {}): RecoveryChoice => ({
  profile: 'loss',
  mode: 'guardian-only',
  guardians: GUARDIANS,
  quorum: 2,
  replaceable: ['admin'],
  ...over,
});

describe('recovery document pre-checks', () => {
  it('accepts a quorum equal to the guardian count and a declared replaceable signer', () => {
    const next = withRecovery(doc, recoverySpec(TESTNET, choice()));
    expect(next.recovery?.replaceable).toEqual(['admin']);
  });

  it('refuses a quorum larger than the guardian set', () => {
    expect(() => recoverySpec(TESTNET, choice({ quorum: 3 }))).toThrow(/quorum 3 exceeds/);
  });

  it('refuses a recovery that may replace no signer', () => {
    expect(() => recoverySpec(TESTNET, choice({ replaceable: [] }))).toThrow(/replaceable/);
  });

  it('refuses a replaceable signer the document does not declare', () => {
    const spec = recoverySpec(TESTNET, choice({ replaceable: ['owner'] }));
    expect(() => withRecovery(doc, spec)).toThrow(/undeclared signer\(s\): owner/);
  });
});
