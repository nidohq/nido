import { Address, TransactionBuilder, scValToNative, xdr } from "@stellar/stellar-sdk";

/**
 * A human-readable summary of a single operation. Recognizes token transfers
 * (both the smart-account `execute(token, "transfer", …)` wrapper this wallet
 * builds and a bare `transfer(from, to, amount)`), falling back to a generic
 * contract invoke and finally to a classic operation type.
 */
export type OpSummary =
  | { kind: "transfer"; token: string; from: string; to: string; amount: bigint }
  | { kind: "name-register"; contract: string; account: string; name: string }
  | { kind: "session-grant"; contract: string; name: string; target: string; validUntil: number | null }
  | { kind: "session-revoke"; contract: string; ruleId: number }
  | { kind: "invoke"; contract: string; fn: string; argsCount: number }
  | { kind: "other"; type: string };

export interface TxSummary {
  /** The transaction's declared fee (stroops, as a string). */
  fee: string;
  ops: OpSummary[];
}

/**
 * Decode a contract invocation into a human-readable summary.
 *
 * SECURITY: a summary that names a specific effect ("transfer", "name-register",
 * "session-grant"/"session-revoke") is only trustworthy for the contract whose
 * behaviour we actually know. Each such branch is gated on provenance:
 *   - the `execute`-transfer wrapper and the context-rule calls → the SELECTED
 *     account (`account`), whose own entry points these are;
 *   - `register` → the CONFIGURED name registry (`nameRegistry`).
 * A same-named method on any other contract is decoded as a generic `invoke`
 * (rendered as an unverified "Calls <fn> on <contract>" line), so a foreign
 * contract cannot borrow a benign-looking preview for an authorization that
 * does something else. Decoding by function name alone is never sufficient.
 */
export function describeInvokeContract(
  ic: xdr.InvokeContractArgs,
  account?: string,
  nameRegistry?: string,
): OpSummary {
  const contract = Address.fromScAddress(ic.contractAddress()).toString();
  const fn = ic.functionName().toString();
  const args = ic.args();

  // scValToNative can throw on exotic / malformed ScVals. A transfer we can't
  // fully decode must degrade to the generic invoke summary, never take down
  // the whole transaction decode — the /sign/ page feeds this untrusted dApp
  // XDR, and one weird op shouldn't blank out the detail for the rest.
  try {
    // Smart-account transfer wrapper: `account.execute(token, "transfer",
    // [account, to, amount])`. SECURITY: decode this as a (trusted-chrome)
    // transfer ONLY when the invoked contract is the SELECTED account and the
    // inner `from` is that same account. Otherwise any contract could expose an
    // `execute(token, "transfer", …)` entry point and be rendered as a verified
    // XLM transfer while its actual on-chain behaviour — and the authorization
    // the user signs — is something else entirely. Without a known account to
    // bind to (account === undefined) we cannot make that guarantee, so we fall
    // through to the generic invoke summary.
    if (
      fn === "execute" &&
      args.length === 3 &&
      account !== undefined &&
      contract === account &&
      scValToNative(args[1]) === "transfer"
    ) {
      const inner = scValToNative(args[2]) as unknown;
      if (Array.isArray(inner) && inner.length === 3 && (inner[0] as string) === account) {
        return {
          kind: "transfer",
          token: scValToNative(args[0]) as string,
          from: inner[0] as string,
          to: inner[1] as string,
          amount: BigInt(inner[2] as bigint),
        };
      }
    }

    // bare token transfer(from, to, amount)
    if (fn === "transfer" && args.length === 3) {
      const [from, to, amount] = args.map((a) => scValToNative(a));
      return {
        kind: "transfer",
        token: contract,
        from: from as string,
        to: to as string,
        amount: BigInt(amount as bigint),
      };
    }

    // name-registry register(account: Address, name: String) — the call the
    // wallet's own name-claim flow builds. Surfaced so the signing surface can
    // show "register the name <name>" rather than a generic "register (2 args)".
    // ONLY for the configured name registry: a `register` on any other contract
    // is decoded generically below, so a foreign contract cannot be reviewed as
    // a name registration (the authorization actually signed could be anything).
    if (fn === "register" && args.length === 2 && nameRegistry !== undefined && contract === nameRegistry) {
      const registrant = scValToNative(args[0]);
      const name = scValToNative(args[1]);
      if (typeof registrant === "string" && typeof name === "string") {
        return { kind: "name-register", contract, account: registrant, name };
      }
    }

    // smart-account remove_context_rule(context_rule_id: u32) — a policy write
    // on the account ITSELF. Only recognized when the invoked contract is the
    // selected account; the same-named method on a foreign contract decodes
    // generically.
    if (fn === "remove_context_rule" && args.length === 1 && account !== undefined && contract === account) {
      const ruleId = scValToNative(args[0]) as number;
      if (typeof ruleId === "number") return { kind: "session-revoke", contract, ruleId };
    }

    // smart-account add_context_rule({ context_type, name, valid_until, signers, policies })
    // — a policy write on the account ITSELF; same provenance gate as above.
    if (fn === "add_context_rule" && args.length === 1 && account !== undefined && contract === account) {
      const rule = scValToNative(args[0]) as {
        context_type?: { tag?: string; values?: unknown[] };
        name?: string;
        valid_until?: number | null;
      };
      const target =
        Array.isArray(rule.context_type?.values) && typeof rule.context_type!.values![0] === "string"
          ? (rule.context_type!.values![0] as string)
          : "";
      return {
        kind: "session-grant",
        contract,
        name: typeof rule.name === "string" ? rule.name : "session-key",
        target,
        validUntil: typeof rule.valid_until === "number" ? rule.valid_until : null,
      };
    }
  } catch {
    /* fall through to the generic invoke summary */
  }

  return { kind: "invoke", contract, fn, argsCount: args.length };
}

/** Summarize a Soroban host function (the payload of an InvokeHostFunction op).
 *  `account` binds the `execute`-transfer-wrapper and context-rule decodes to
 *  the selected account; `nameRegistry` binds the `register` decode to the
 *  configured name registry (see `describeInvokeContract`). */
export function describeHostFunction(
  fn: xdr.HostFunction,
  account?: string,
  nameRegistry?: string,
): OpSummary {
  if (fn.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    return { kind: "other", type: fn.switch().name };
  }
  return describeInvokeContract(fn.invokeContract(), account, nameRegistry);
}

/** Summarize a single classic/Soroban operation. `account` and `nameRegistry`
 *  gate the semantic decodes (see `describeInvokeContract`). */
export function describeOperation(
  op: xdr.Operation,
  account?: string,
  nameRegistry?: string,
): OpSummary {
  const body = op.body();
  if (body.switch() !== xdr.OperationType.invokeHostFunction()) {
    return { kind: "other", type: body.switch().name };
  }
  return describeHostFunction(body.invokeHostFunctionOp().hostFunction(), account, nameRegistry);
}

/**
 * Parse a base64 transaction XDR and summarize each of its operations. Used by
 * the external-dApp signing page (`/sign/`) to render human-readable details
 * instead of the raw XDR blob.
 *
 * `account` is the selected smart account this ceremony is bound to; it gates
 * the `execute`-transfer-wrapper and context-rule decodes so a foreign
 * contract's `execute(token,"transfer",…)` or `*_context_rule` call is never
 * rendered as a verified account action. `nameRegistry` is the configured name
 * registry id; it gates the `register` decode the same way. Omit either and the
 * corresponding semantic decode is withheld (the op reads as a generic call).
 */
export function describeTransaction(
  txXdr: string,
  networkPassphrase: string,
  account?: string,
  nameRegistry?: string,
): TxSummary {
  const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
  const inner = "innerTransaction" in tx ? tx.innerTransaction : tx;
  const ops: OpSummary[] = inner.operations.map((op) =>
    op.type === "invokeHostFunction"
      ? describeHostFunction(op.func, account, nameRegistry)
      : { kind: "other", type: op.type },
  );
  return { fee: tx.fee, ops };
}
