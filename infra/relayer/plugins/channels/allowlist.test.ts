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
  const disallowedXdr = buildInvokeHostFunctionXdr('transfer');

  it('ALLOWED_FUNCTIONS contains exactly the documented recovery/genesis functions', () => {
    expect([...ALLOWED_FUNCTIONS].sort()).toEqual(
      [
        'create_account',
        'create_account_v2',
        'insert_for',
        'initiate_recovery',
        'cancel_recovery',
        'burn_nullifier',
        'add_context_rule',
      ].sort(),
    );
  });

  describe('invokedFunctionName', () => {
    it('returns the invoked function name for an initiate_recovery invoke', () => {
      expect(invokedFunctionName(allowedXdr)).toBe('initiate_recovery');
    });

    it('returns the invoked function name for a transfer invoke', () => {
      expect(invokedFunctionName(disallowedXdr)).toBe('transfer');
    });

    it('returns null for garbage input', () => {
      expect(invokedFunctionName('not-valid-base64-xdr')).toBeNull();
    });
  });

  describe('isAllowed', () => {
    it('is true for initiate_recovery', () => {
      expect(isAllowed(allowedXdr)).toBe(true);
    });

    it('is false for transfer', () => {
      expect(isAllowed(disallowedXdr)).toBe(false);
    });
  });

  describe('assertAllowedOrReject', () => {
    it('does not throw for initiate_recovery', () => {
      expect(() => assertAllowedOrReject(allowedXdr)).not.toThrow();
    });

    it('throws for transfer', () => {
      expect(() => assertAllowedOrReject(disallowedXdr)).toThrow(/not in the recovery\/genesis allowlist/);
    });
  });
});
