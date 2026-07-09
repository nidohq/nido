import { describe, expect, it } from 'vitest';
import { Contract, StrKey } from '@stellar/stellar-sdk';
import { ALLOWED_FUNCTIONS, assertAllowedOrReject, invokedFunctionName, isAllowed } from './allowlist';

/** Arbitrary but valid 32-byte contract id, StrKey-encoded, for building test XDRs. */
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

/** Build a real base64 InvokeHostFunction XDR for `functionName` on `CONTRACT_ID`. */
function buildInvokeHostFunctionXdr(functionName: string): string {
  const operation = new Contract(CONTRACT_ID).call(functionName);
  const hostFunction = operation.body().invokeHostFunctionOp().hostFunction();
  return hostFunction.toXDR('base64');
}

describe('allowlist', () => {
  const allowedXdr = buildInvokeHostFunctionXdr('initiate_recovery');
  // A function the nido app never relays — the relayer must still reject it.
  const disallowedXdr = buildInvokeHostFunctionXdr('upgrade');

  it('ALLOWED_FUNCTIONS is exactly the set of nido app-relayed functions', () => {
    expect([...ALLOWED_FUNCTIONS].sort()).toEqual(
      [
        'create_account',
        'create_account_v2',
        'insert_for',
        'initiate_recovery',
        'cancel_recovery',
        'burn_nullifier',
        'enroll_zk_recovery',
        'add_context_rule',
        'remove_context_rule',
        'add_signer',
        'remove_signer',
        'execute',
        'register',
      ].sort(),
    );
  });

  it('permits the normal wallet actions the app fee-sponsors (regression guard)', () => {
    // These broke production when the allowlist was scoped to recovery-only:
    // name registration, transfers (via the account `execute` wrapper), session-key
    // revoke, and adding ZK recovery to an existing account.
    for (const fn of ['register', 'execute', 'remove_context_rule', 'enroll_zk_recovery']) {
      expect(isAllowed(buildInvokeHostFunctionXdr(fn))).toBe(true);
    }
  });

  describe('invokedFunctionName', () => {
    it('returns the invoked function name for an initiate_recovery invoke', () => {
      expect(invokedFunctionName(allowedXdr)).toBe('initiate_recovery');
    });

    it('returns the invoked function name for a disallowed invoke', () => {
      expect(invokedFunctionName(disallowedXdr)).toBe('upgrade');
    });

    it('returns null for garbage input', () => {
      expect(invokedFunctionName('not-valid-base64-xdr')).toBeNull();
    });
  });

  describe('isAllowed', () => {
    it('is true for initiate_recovery', () => {
      expect(isAllowed(allowedXdr)).toBe(true);
    });

    it('is false for a function the app never relays', () => {
      expect(isAllowed(disallowedXdr)).toBe(false);
    });
  });

  describe('assertAllowedOrReject', () => {
    it('does not throw for initiate_recovery', () => {
      expect(() => assertAllowedOrReject(allowedXdr)).not.toThrow();
    });

    it('throws for a function the app never relays', () => {
      expect(() => assertAllowedOrReject(disallowedXdr)).toThrow(/not in the nido relayer allowlist/);
    });
  });
});
