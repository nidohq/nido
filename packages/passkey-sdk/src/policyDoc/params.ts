/**
 * Install-param ScVals for the two policies a lowered doc rule can attach.
 *
 * Both are built through the generated bindings' embedded `Spec` rather than
 * hand-assembled `xdr.ScVal.scvMap(...)`, for two reasons:
 *
 * - DUAL-SDK HAZARD (#72): in browser bundles the bare `@stellar/stellar-sdk`
 *   specifier and `@stellar/stellar-sdk/contract` can resolve to two
 *   different stellar-base copies; an ScVal from the wrong copy fails the
 *   bindings' `instanceof xdr.ScVal` check inside `funcArgsToScVals` at
 *   signing time. Building via each policy binding's own `spec.nativeToScVal`
 *   keeps the value in the same copy that later converts the
 *   `add_context_rule` args. (Same fix as the frontend's
 *   `spendingLimitParams.ts`.)
 * - `#[contracttype]` structs encode as `scvMap` with symbol keys in sorted
 *   order; deriving the encoding from the contract spec means field order and
 *   types can never drift from the deployed contract.
 *
 * The client constructors below never touch the network — they exist purely
 * to hand us the `Spec` object; contract id / rpcUrl are placeholder values.
 */

import type { Spec } from '@stellar/stellar-sdk/contract';
import type { xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { Client as PerchInterpreterClient } from '@stellar-registry/perch-interpreter';
import type { RpnProgram } from '@stellar-registry/perch-interpreter';
import { Client as SpendingLimitPolicyClient } from '@nidohq/spending-limit-policy';

const PLACEHOLDER_OPTIONS = {
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
};

let interpreterSpec: Spec | undefined;
let spendingLimitSpec: Spec | undefined;

function installParamsType(spec: Spec, contract: string): xdr.ScSpecTypeDef {
  const input = spec
    .getFunc('install')
    .inputs()
    .find((i) => i.name().toString() === 'install_params');
  if (!input) {
    throw new Error(`policyDoc: ${contract} spec has no install(install_params, …) input`);
  }
  return input.type();
}

/**
 * ScVal for the perch interpreter's `InstallParams { program, doc_hash }` —
 * the value to put under the interpreter's address in `add_context_rule`'s
 * `policies` map.
 *
 * @param docHashHex The 32-byte doc_hash as lowercase hex (from `docHash()`
 *                   / `LoweredDoc.docHash`) — the identity of the WHOLE
 *                   document this rule was lowered from.
 * @param spec Override only in tests.
 */
export function interpreterInstallParamsScVal(
  program: RpnProgram,
  docHashHex: string,
  spec?: Spec,
): xdr.ScVal {
  const docHash = Buffer.from(docHashHex, 'hex');
  if (docHash.length !== 32 || docHash.toString('hex') !== docHashHex.toLowerCase()) {
    throw new Error(`policyDoc: doc_hash must be 32 bytes of hex, got "${docHashHex}"`);
  }
  const s = spec ?? (interpreterSpec ??= new PerchInterpreterClient(PLACEHOLDER_OPTIONS).spec);
  return s.nativeToScVal({ doc_hash: docHash, program }, installParamsType(s, 'perch-interpreter'));
}

/**
 * ScVal for OZ `SpendingLimitAccountParams { spending_limit, period_ledgers }`
 * — the value to put under the spending-limit policy's address. The metered
 * token is not in the params: it is pinned by the rule's
 * `CallContract(token)` scope.
 *
 * @param spec Override only in tests.
 */
export function spendingLimitInstallParamsScVal(
  limitStroops: bigint,
  periodLedgers: number,
  spec?: Spec,
): xdr.ScVal {
  const s = spec ?? (spendingLimitSpec ??= new SpendingLimitPolicyClient(PLACEHOLDER_OPTIONS).spec);
  return s.nativeToScVal(
    { period_ledgers: periodLedgers, spending_limit: limitStroops },
    installParamsType(s, 'spending-limit-policy'),
  );
}
