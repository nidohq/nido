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
 *   add-context-rule  → security/delegate/index.astro approveBtn handler
 *   remove-context-rule → passkey-sdk policyBlocks/scopedSessionKey.ts buildRevoke
 *                         (via SmartAccountClient.remove_context_rule)
 */

import { Address, Operation, Networks, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { Client as SmartAccountClient } from "@nidohq/smart-account";
import {
  buildApplyDocTx,
  extractXdrOperations,
  hex2buf,
  parsePolicyDocJson,
} from "@nidohq/passkey-sdk";
import type { OperationDescriptor } from "./signRequest";
import { buildSendOperation } from "../transfer/buildSend.js";
import { fetchRegistryAddress } from "../policyChainFetch.js";
import { spendingLimitParamsScVal } from "../spendingLimitParams.js";
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
      // Mirror: security/delegate/index.astro approveBtn handler (~lines 296-314).
      // Constructs the SmartAccountClient and calls add_context_rule with the
      // same shape: context_type CallContract, External signer, optional policies.
      const client = new SmartAccountClient({
        contractId: account,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl: RPC_URL,
      });

      // Spending limit: non-null `limit` → policies map with one entry.
      // No limit (null/undefined) → empty map (byte-identical to pre-limit behavior).
      let policies = new Map<string, ReturnType<typeof spendingLimitParamsScVal>>();
      if (d.limit != null) {
        const policyAddr = await fetchRegistryAddress("spending-limit-policy");
        policies = new Map([
          [policyAddr, spendingLimitParamsScVal(BigInt(d.limit.stroops), d.limit.periodLedgers)],
        ]);
      }

      const assembled = await client.add_context_rule({
        context_type: { tag: "CallContract", values: [d.target] as readonly [string] },
        name: d.label ?? "session-key",
        valid_until: d.validUntil ?? undefined,
        signers: [
          {
            tag: "External" as const,
            values: [d.verifierAddress, hex2buf(d.signerPublicKeyHex) as Buffer] as readonly [
              string,
              Buffer,
            ],
          },
        ],
        policies,
      });

      return extractXdrOperations(assembled, "add-context-rule")[0]!;
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
