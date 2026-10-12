import { describe, it, expect } from 'vitest';
import { StrKey, xdr, Address, scValToNative } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { buildAuthHash, buildAuthHashAt, computeAuthDigest } from './auth.js';
import {
  buildFriendInvocation,
  friendSignaturePayload,
  randomNonce,
} from './friendSigning.js';

const TESTNET = 'Test SDF Network ; September 2015';

// Distinct, valid contract strkeys for the recovering account and a friend.
const RECOVERING_ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0xab));
const FRIEND = StrKey.encodeContract(new Uint8Array(32).fill(0xcd));

const PARENT_DIGEST_HEX = Buffer.from(new Uint8Array(32).fill(0x42)).toString('hex');

/** Build a synthetic parent root auth entry over a `__check_auth` invocation
 *  on the recovering account — the shape the rotation tx ships. */
function syntheticParentEntry(
  nonce: string,
  expiration: number,
): xdr.SorobanAuthorizationEntry {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(RECOVERING_ACCOUNT).toScAddress(),
        functionName: 'add_signer',
        args: [],
      }),
    ),
    subInvocations: [],
  });
  const creds = new xdr.SorobanAddressCredentials({
    address: Address.fromString(RECOVERING_ACCOUNT).toScAddress(),
    nonce: xdr.Int64.fromString(nonce),
    signatureExpirationLedger: expiration,
    signature: xdr.ScVal.scvVoid(),
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(creds),
    rootInvocation: invocation,
  });
}

describe('buildFriendInvocation (BLOCKER 1: nested invocation target)', () => {
  it('targets the RECOVERING account as contract_address, not the friend', () => {
    const inv = buildFriendInvocation(RECOVERING_ACCOUNT, PARENT_DIGEST_HEX);
    const args = inv.function().contractFn();
    const addr = Address.fromScAddress(args.contractAddress()).toString();
    expect(addr).toBe(RECOVERING_ACCOUNT);
    expect(addr).not.toBe(FRIEND);
  });

  it('encodes function_name="__check_auth" and the parent digest as the sole arg', () => {
    const inv = buildFriendInvocation(RECOVERING_ACCOUNT, PARENT_DIGEST_HEX);
    const fn = inv.function().contractFn();
    expect(fn.functionName().toString()).toBe('__check_auth');
    const callArgs = fn.args();
    expect(callArgs.length).toBe(1);
    const argBytes = new Uint8Array(callArgs[0].bytes());
    expect(Buffer.from(argBytes).toString('hex')).toBe(PARENT_DIGEST_HEX);
  });

  it('produces byte-identical invocation XDR for a fixed account + digest', () => {
    const a = buildFriendInvocation(RECOVERING_ACCOUNT, PARENT_DIGEST_HEX);
    const b = buildFriendInvocation(RECOVERING_ACCOUNT, PARENT_DIGEST_HEX);
    expect(a.toXDR().toString('base64')).toBe(b.toXDR().toString('base64'));
  });
});

describe('friendSignaturePayload (BLOCKER 1+2: deterministic friend digest)', () => {
  it('is byte-identical for a FIXED nonce + FIXED absolute expiration', () => {
    const nonce = '7777777777';
    const exp = 5_000_000;
    const a = friendSignaturePayload({
      recoveringAccount: RECOVERING_ACCOUNT,
      parentAuthDigestHex: PARENT_DIGEST_HEX,
      networkPassphrase: TESTNET,
      nonce,
      signatureExpirationLedger: exp,
    });
    const b = friendSignaturePayload({
      recoveringAccount: RECOVERING_ACCOUNT,
      parentAuthDigestHex: PARENT_DIGEST_HEX,
      networkPassphrase: TESTNET,
      nonce,
      signatureExpirationLedger: exp,
    });
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
  });

  it('changes when the nested invocation targets a DIFFERENT account', () => {
    const common = {
      parentAuthDigestHex: PARENT_DIGEST_HEX,
      networkPassphrase: TESTNET,
      nonce: '1',
      signatureExpirationLedger: 99,
    };
    const onRecovering = friendSignaturePayload({ ...common, recoveringAccount: RECOVERING_ACCOUNT });
    const onFriend = friendSignaturePayload({ ...common, recoveringAccount: FRIEND });
    // If the buggy code targeted the friend, the digest would silently differ
    // from the on-chain expectation. Guard that the address actually binds.
    expect(Buffer.from(onRecovering).toString('hex')).not.toBe(
      Buffer.from(onFriend).toString('hex'),
    );
  });
});

describe('parent auth-digest determinism (BLOCKER 2)', () => {
  it('originator-stored digest == friend-recomputed digest at the SAME canonical expiration', () => {
    const recoveryRuleId = 4;
    const nonce = '424242';
    const canonicalExpiration = 6_000_000;

    // Both parties read the SAME parent entry from the shared tx XDR.
    const parentEntry = syntheticParentEntry(nonce, canonicalExpiration);
    const sharedXdr = parentEntry.toXDR();

    // Originator side.
    const origEntry = xdr.SorobanAuthorizationEntry.fromXDR(sharedXdr);
    const origPayload = buildAuthHashAt(origEntry, TESTNET, canonicalExpiration);
    const origDigest = computeAuthDigest(RECOVERING_ACCOUNT, origPayload, [recoveryRuleId]);

    // Friend side — recomputes from the same entry + same canonical expiration.
    const friendEntry = xdr.SorobanAuthorizationEntry.fromXDR(sharedXdr);
    const friendPayload = buildAuthHashAt(friendEntry, TESTNET, canonicalExpiration);
    const friendDigest = computeAuthDigest(RECOVERING_ACCOUNT, friendPayload, [recoveryRuleId]);

    expect(Buffer.from(friendDigest).toString('hex')).toBe(
      Buffer.from(origDigest).toString('hex'),
    );
  });

  it('diverges if the friend used a DIFFERENT expiration (the old bug)', () => {
    const recoveryRuleId = 4;
    const entry = syntheticParentEntry('1', 100);
    const canonical = buildAuthHashAt(entry, TESTNET, 6_000_000);
    const drifted = buildAuthHashAt(entry, TESTNET, 6_000_001);
    expect(Buffer.from(computeAuthDigest(RECOVERING_ACCOUNT, canonical, [recoveryRuleId])).toString('hex')).not.toBe(
      Buffer.from(computeAuthDigest(RECOVERING_ACCOUNT, drifted, [recoveryRuleId])).toString('hex'),
    );
  });

  it('buildAuthHash(offset) and buildAuthHashAt(absolute) agree when offset resolves to the same ledger', () => {
    const entry = syntheticParentEntry('5', 1);
    const lastLedger = 1000;
    const offset = 10000;
    const viaOffset = buildAuthHash(entry, TESTNET, lastLedger, offset);
    const viaAbsolute = buildAuthHashAt(entry, TESTNET, lastLedger + offset);
    expect(Buffer.from(viaOffset).toString('hex')).toBe(
      Buffer.from(viaAbsolute).toString('hex'),
    );
  });
});

describe('randomNonce', () => {
  it('produces a positive i64 decimal string', () => {
    for (let i = 0; i < 50; i++) {
      const n = randomNonce();
      expect(n).toMatch(/^\d+$/);
      const v = BigInt(n);
      expect(v >= 0n).toBe(true);
      expect(v <= (1n << 63n) - 1n).toBe(true);
    }
  });

  it('is overwhelmingly unique across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(randomNonce());
    expect(seen.size).toBe(200);
  });
});

describe('roundtrip: full nested entry contract address (integration of BLOCKER 1)', () => {
  it('a friend nested entry built from the SDK helpers carries the recovering account', () => {
    // Mirror buildFriendAuthEntry's invocation construction.
    const inv = buildFriendInvocation(RECOVERING_ACCOUNT, PARENT_DIGEST_HEX);
    const native = scValToNative(
      xdr.ScVal.scvAddress(inv.function().contractFn().contractAddress()),
    ) as string;
    expect(native).toBe(RECOVERING_ACCOUNT);
  });
});
