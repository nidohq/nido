import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildDocInstallTxs, lowerDoc, scopedSessionKeyDoc } from './index.js';

const ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0x54));
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const SESSION_G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const MAINNET = 'Public Global Stellar Network ; September 2015';

describe('buildDocInstallTxs: network binding', () => {
  const lowered = lowerDoc(
    scopedSessionKeyDoc({ sessionAddress: SESSION_G, targetContract: TARGET, network: MAINNET }),
    { account: ACCOUNT },
  );

  it('refuses to build for a network the doc is not bound to', async () => {
    await expect(
      buildDocInstallTxs(lowered, { account: ACCOUNT, rpcUrl: 'http://localhost:1' }),
    ).rejects.toThrow(/bound to network/);
  });
});
