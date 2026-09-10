import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildApplyDocTx, buildPolicyDoc } from './index.js';

const ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0x54));
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const MAINNET = 'Public Global Stellar Network ; September 2015';

const OWNER = {
  id: 'owner',
  kind: 'passkey',
  verifier: VERIFIER,
  publicKey: new Uint8Array(65).fill(7),
} as const;

describe('buildApplyDocTx: pre-network refusals', () => {
  it('refuses to build for a network the doc is not bound to', async () => {
    const doc = buildPolicyDoc({
      network: MAINNET,
      signers: [OWNER],
      permissions: [{ name: 'pay', on: { contract: TARGET }, by: ['owner'] }],
    });
    await expect(
      buildApplyDocTx(doc, { account: ACCOUNT, rpcUrl: 'http://localhost:1' }),
    ).rejects.toThrow(/bound to network/);
  });

  it('refuses capped docs — the deployed compiler predates cap lowering', async () => {
    const doc = buildPolicyDoc({
      signers: [OWNER],
      permissions: [
        {
          name: 'capped-pay',
          on: { contract: TARGET },
          by: ['owner'],
          functions: ['transfer'],
          cap: { limit: '1000000', 'period-ledgers': 17280 },
        },
      ],
    });
    await expect(
      buildApplyDocTx(doc, { account: ACCOUNT, rpcUrl: 'http://localhost:1' }),
    ).rejects.toThrow(/does not support caps yet/);
  });
});
