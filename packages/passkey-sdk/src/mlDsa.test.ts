import { describe, it, expect } from 'vitest';
import { StrKey, xdr, scValToNative } from '@stellar/stellar-sdk';
import {
  encodeMlDsaSigData,
  ML_DSA_PK_LEN,
  ML_DSA_SIG_LEN,
} from './mlDsa.js';
import { buildAuthPayloadScVal } from './multiSigner.js';

const VERIFIER = StrKey.encodeContract(new Uint8Array(32).fill(0x4d));

function pk(): Uint8Array {
  return new Uint8Array(ML_DSA_PK_LEN).fill(0x11);
}
function sig(): Uint8Array {
  return new Uint8Array(ML_DSA_SIG_LEN).fill(0x22);
}

describe('encodeMlDsaSigData', () => {
  it('encodes an ScMap with public_key < signature symbol keys (contracttype order)', () => {
    const bytes = encodeMlDsaSigData(pk(), sig());
    const scv = xdr.ScVal.fromXDR(bytes);
    const entries = scv.map()!;
    expect(entries.map((e) => e.key().sym().toString())).toEqual(['public_key', 'signature']);
    expect(entries[0].val().bytes().length).toBe(ML_DSA_PK_LEN);
    expect(entries[1].val().bytes().length).toBe(ML_DSA_SIG_LEN);
  });

  it('round-trips through scValToNative', () => {
    const native = scValToNative(xdr.ScVal.fromXDR(encodeMlDsaSigData(pk(), sig()))) as {
      public_key: Buffer;
      signature: Buffer;
    };
    expect(new Uint8Array(native.public_key)).toEqual(pk());
    expect(new Uint8Array(native.signature)).toEqual(sig());
  });

  it('rejects wrong lengths up front (contract traps on malformed sig_data)', () => {
    expect(() => encodeMlDsaSigData(new Uint8Array(65), sig())).toThrow(/1952/);
    expect(() => encodeMlDsaSigData(pk(), new Uint8Array(64))).toThrow(/3309/);
  });
});

describe('external-bytes signer in buildAuthPayloadScVal', () => {
  it('keys the signers map with External(verifier, commitment) and passes sigData through verbatim', () => {
    const commitment = new Uint8Array(32).fill(0x33);
    const sigData = encodeMlDsaSigData(pk(), sig());
    const scv = buildAuthPayloadScVal({
      contextRuleIds: [1],
      signers: [
        { kind: 'external-bytes', verifierAddress: VERIFIER, keyData: commitment, sigData },
      ],
    });

    const outer = scv.map()!;
    expect(outer.map((e) => e.key().sym().toString())).toEqual(['context_rule_ids', 'signers']);

    const signersMap = outer[1].val().map()!;
    expect(signersMap.length).toBe(1);

    // Signer::External enum-as-vec: [Symbol("External"), Address, Bytes(commitment)]
    const signerKey = signersMap[0].key().vec()!;
    expect(signerKey[0].sym().toString()).toBe('External');
    expect(StrKey.encodeContract(signerKey[1].address().contractId())).toBe(VERIFIER);
    expect(new Uint8Array(signerKey[2].bytes())).toEqual(commitment);

    // The map value is the pre-encoded MlDsaSigData XDR, untouched.
    expect(Buffer.from(signersMap[0].val().bytes())).toEqual(sigData);
  });
});
