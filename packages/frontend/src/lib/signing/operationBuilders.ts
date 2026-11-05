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
 *   apply-policy-doc  → the admin document's write (buildApplyDocTx)
 *   apply-scope       → an app's scoped document (apply_scope); both
 *                       delegate pages route here
 *   remove-scope      → removing an app (remove_scope)
 *   gc-scope          → cleaning up an app scope a recovery wiped (gc_scope)
 *
 * DOC-ONLY: the add-context-rule / remove-context-rule descriptors THROW —
 * the account has no general rule mutators (add_context_rule is hard-gated
 * to the zk-recovery completion window), so a stale stashed request must
 * fail with guidance here rather than as Error(Contract, #19) on-chain.
 */

import { Address, Operation, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { buildApplyDocTx, docCapProblem, parsePolicyDocJson, perch } from "@nidohq/passkey-sdk";
import type { OperationDescriptor } from "./signRequest";
import { buildSendOperation } from "../transfer/buildSend.js";
import { fetchRegistryAddress } from "../policyChainFetch.js";
import { RPC_URL, NETWORK_PASSPHRASE } from "../network.js";
import { isClaimableName } from "../claimFlow.js";
import { recoveryEditProblem } from "../policy/docDraft.js";
import { fetchAppliedDocument, fetchDocLimits } from "../policy/docPolicyFetch.js";
import { accountScopes, loadScopeChecks } from "../policy/appGrantLoad.js";
import { namedDoc } from "../policy/verifierNames.js";

/**
 * `buildOperation`, with the reads that may refuse the operation returned as
 * `checks` instead of awaited: the caller runs them beside its own
 * simulation and awaits them before the passkey prompt. Only an
 * `apply-policy-doc` has such reads; its operation comes from the request
 * alone.
 */
export async function buildOperationChecked(
  d: Exclude<OperationDescriptor, { type: "raw-xdr" }>,
  account: string,
): Promise<{ operation: xdr.Operation; checks: Promise<void> }> {
  if (d.type === "apply-policy-doc") return applyPolicyDocOperation(d, account);
  return { operation: await buildOperation(d, account), checks: Promise.resolve() };
}

async function applyPolicyDocOperation(
  d: Extract<OperationDescriptor, { type: "apply-policy-doc" }>,
  account: string,
): Promise<{ operation: xdr.Operation; checks: Promise<void> }> {
  // Mirror: components/PolicyBuilder.ts submit. The doc is parsed fresh
  // from the canonical JSON in the descriptor (never trusted as a live
  // object) and applied through the account's `apply_doc` surface —
  // the ONLY policy write path (doc-only ruling; the per-rule
  // add_context_rule lowering for docs is gone).
  // The request MUST name the revision it was composed from. Refuse
  // offline (before any parse or network read) a request that omits it,
  // rather than rebinding it to the revision read at signing time — that
  // rebinding would let an older stashed document overwrite intervening
  // rule changes while still passing the stale-revision check.
  if (typeof d.expectedRevision !== "string" || d.expectedRevision.length === 0) {
    throw new Error(
      "apply-policy-doc request is missing expected_revision; rebuild it from the current configuration",
    );
  }
  const doc = namedDoc(parsePolicyDocJson(d.docJson));
  // The apply lands only at the revision the request was composed from.
  // Built without simulating: the signer simulates it before the prompt.
  const tx = await buildApplyDocTx(doc, {
    account,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    expectedRevision: BigInt(d.expectedRevision),
    simulate: false,
  });
  const checks = (async () => {
    const [applied, limits] = await Promise.all([fetchAppliedDocument(account), fetchDocLimits(account)]);
    // A request never reconfigures recovery: that is the recovery page's,
    // with whatever approval the account's profile needs.
    const recoveryProblem = recoveryEditProblem(
      applied.json === undefined ? null : parsePolicyDocJson(applied.json),
      doc,
    );
    if (recoveryProblem !== undefined) throw new Error(recoveryProblem);
    // The account's own limits: an over-limit request is refused, with the
    // reason, rather than left to the compiler.
    const tooLarge = docCapProblem(doc, limits);
    if (tooLarge !== undefined) throw new Error(tooLarge);
  })();
  // Awaited by the caller; a refusal that lands before then is not unhandled.
  checks.catch(() => {});
  return { operation: tx.operations[0]!, checks };
}

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
      if (!isClaimableName(d.name)) throw new Error(`"${d.name}" can't be claimed as a name.`);
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
      const { operation, checks } = await applyPolicyDocOperation(d, account);
      await checks;
      return operation;
    }

    case "apply-scope": {
      // An app's scoped document. `apply_scope` names no revision, so the
      // scope record is read again here, right before signing: if anything
      // applied over it since the request was built, refuse rather than
      // overwrite that change.
      if (d.prevDocHash !== null && typeof d.prevDocHash !== "string") {
        throw new Error("apply-scope request is missing the scope it was built from; start again from the app");
      }
      const doc = namedDoc(parsePolicyDocJson(d.docJson));
      const [record, checks, limits] = await Promise.all([
        accountScopes(account).scope(d.scope),
        loadScopeChecks(account),
        fetchDocLimits(account),
      ]);
      if ((record?.docHash ?? null) !== d.prevDocHash) {
        throw new Error("This app's permissions changed after this page read them. Start again from the app.");
      }
      const tx = perch.buildApplyScopeTx(d.scope, doc, {
        account,
        networkPassphrase: NETWORK_PASSPHRASE,
        limits,
        scoped: { account, excluded: checks.excluded, adminKeys: checks.adminKeys, origin: d.origin },
      });
      return tx.operations[0]!;
    }

    case "remove-scope":
      return perch.buildRemoveScopeTx(d.scope, { account, networkPassphrase: NETWORK_PASSPHRASE }).operations[0]!;

    case "gc-scope":
      return perch.buildGcScopeTx(d.scope, { account, networkPassphrase: NETWORK_PASSPHRASE }).operations[0]!;

    case "remove-context-rule": {
      // DOC-ONLY: the account no longer exports remove_context_rule
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
