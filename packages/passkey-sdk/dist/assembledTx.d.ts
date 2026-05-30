/**
 * Helpers for working with `AssembledTransaction` returned by generated
 * contract bindings.
 */
import { xdr } from '@stellar/stellar-sdk';
import type { AssembledTransaction } from '@stellar/stellar-sdk/contract';
/**
 * Extract XDR Soroban operations from an `AssembledTransaction`.
 *
 * `tx.built` is a high-level `Transaction` whose `operations` field holds
 * JS Operation POJOs (`{type, func, auth, source?}`), not `xdr.Operation`
 * instances. Callers that hand these to `TransactionBuilder.addOperation`
 * see them survive until `build()` time, which then runs
 * `new Transaction(envelope)` — that constructor maps each op through
 * `Operation.fromXDRObject`, which calls `op.sourceAccount()` and crashes
 * with `e.sourceAccount is not a function` because POJOs have no such
 * accessor.
 *
 * Re-encode each POJO via the matching `Operation.<type>(opts)` static.
 * For policy-builder flows the type is always `invokeHostFunction`, and
 * the POJO shape (`{func, auth, source?}`) feeds straight into
 * `Operation.invokeHostFunction`.
 */
export declare function extractXdrOperations(tx: AssembledTransaction<unknown>, context?: string): xdr.Operation[];
//# sourceMappingURL=assembledTx.d.ts.map