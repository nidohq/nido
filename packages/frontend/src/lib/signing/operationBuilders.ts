/**
 * Builds an `xdr.Operation` from an `OperationDescriptor` (all kinds except
 * `raw-xdr`, which callers decode directly from the descriptor's `.xdr`
 * field).
 *
 * This module relocates the existing per-page op-build logic behind one switch
 * so the unified signing surface can construct the operation without
 * duplicating each page's binding usage. No new on-chain behavior is added —
 * every branch mirrors its source call site:
 *
 *   register          → account/index.astro runNameClaim (invokeContractFunction)
 *   transfer          → lib/transfer/buildSend.ts buildSendOperation
 *   apply-policy-doc  → the ONE policy write (buildApplyDocTx); both
 *                       delegate pages and the policy builder route here
 *
 * DOC-ONLY: the add-context-rule / remove-context-rule descriptors THROW —
 * the account has no general rule mutators (add_context_rule is hard-gated
 * to the zk-recovery completion window), so a stale stashed request must
 * fail with guidance here rather than as Error(Contract, #19) on-chain.
 */

import { Address, Operation, Networks, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { buildApplyDocTx, parsePolicyDocJson } from "@nidohq/passkey-sdk";
import type { OperationDescriptor } from "./signRequest";
import { buildSendOperation } from "../transfer/buildSend.js";
import { fetchRegistryAddress } from "../policyChainFetch.js";
import { RPC_URL } from "../network.js";

const NETWORK_PASSPHRASE = Networks.TESTNET;

/**
 * Turn an `OperationDescriptor` (any kind except `raw-xdr`) into a concrete
 * `xdr.Operation` ready for the lifecycle engine to simulate, auth-inject, and
 * sign.
 *
 * @param d   The operation descriptor (must not be `{ type: "raw-xdr" }`).
 * @param account  The smart-account contract id (C-address) that will execute
 *                 the operation.
 */
export async function buildOperation(
  d: Exclude<OperationDescriptor, { type: "raw-xdr" }>,
  account: string,
): Promise<xdr.Operation> {
  switch (d.type) {
    case "register": {
      // Mirror: account/index.astro runNameClaim (~lines 1262-1278).
      // The name-registry `register(account, name)` call: the account invokes
      // the registry's `register` function directly (NOT through its own
      // `execute` wrapper — the registry is a plain contract, not a SAC).
      const nameRegistryId = await fetchRegistryAddress("name-registry");
      return Operation.invokeContractFunction({
        contract: nameRegistryId,
        function: "register",
        args: [
          Address.fromString(account).toScVal(),
          nativeToScVal(d.name, { type: "string" }),
        ],
      });
    }

    case "transfer": {
      // Mirror: transfer/index.astro onReview + lib/transfer/buildSend.ts.
      // The smart account's execute(token, "transfer", [from, to, amount])
      // wrapper — identical to buildSendOperation.
      return buildSendOperation({
        smartAccount: account,
        tokenContractId: d.token,
        destination: d.to,
        amount: BigInt(d.amountRaw),
      });
    }

    case "add-context-rule": {
      // DOC-ONLY: the account has no general add_context_rule (it is
      // hard-gated to the zk-recovery completion window — DocOnlyWritePath,
      // Error(Contract, #19) on-chain). Session grants are policy-document
      // updates: /security/delegate/ composes them via
      // buildSessionGrantOperation → apply-policy-doc. Reaching this branch
      // means a STALE stashed SignRequest from before the doc-only rewrite.
      throw new Error(
        "doc-only: session grants are policy-document updates (apply_doc), not add_context_rule — restart the delegation from the dApp",
      );
    }

    case "apply-policy-doc": {
      // Mirror: components/PolicyBuilder.ts submit. The doc is parsed fresh
      // from the canonical JSON in the descriptor (never trusted as a live
      // object) and applied through the account's `apply_doc` surface —
      // the ONLY policy write path (doc-only ruling; the per-rule
      // add_context_rule lowering for docs is gone).
      const doc = parsePolicyDocJson(d.docJson);
      const tx = await buildApplyDocTx(doc, {
        account,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      return tx.operations[0]!;
    }

    case "remove-context-rule": {
      // DOC-ONLY (spike): the account no longer exports remove_context_rule
      // — apply_doc is the sole policy write path. Revoking a rule means
      // composing the account's current policy document WITHOUT it and
      // applying that (readPolicy → edit doc → buildApplyDocTx), a flow this
      // UI has not been rebuilt on yet.
      throw new Error(
        `doc-only: rule ${d.ruleId} cannot be removed per-rule; apply an updated policy document instead (buildApplyDocTx)`,
      );
    }
  }
}
