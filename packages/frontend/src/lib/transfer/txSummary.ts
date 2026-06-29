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

function describeInvokeContract(ic: xdr.InvokeContractArgs): OpSummary {
  const contract = Address.fromScAddress(ic.contractAddress()).toString();
  const fn = ic.functionName().toString();
  const args = ic.args();

  // scValToNative can throw on exotic / malformed ScVals. A transfer we can't
  // fully decode must degrade to the generic invoke summary, never take down
  // the whole transaction decode — the /sign/ page feeds this untrusted dApp
  // XDR, and one weird op shouldn't blank out the detail for the rest.
  try {
    // smart-account execute(token, "transfer", [from, to, amount])
    if (fn === "execute" && args.length === 3 && scValToNative(args[1]) === "transfer") {
      const inner = scValToNative(args[2]) as unknown;
      if (Array.isArray(inner) && inner.length === 3) {
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
    if (fn === "register" && args.length === 2) {
      const account = scValToNative(args[0]);
      const name = scValToNative(args[1]);
      if (typeof account === "string" && typeof name === "string") {
        return { kind: "name-register", contract, account, name };
      }
    }

    // smart-account remove_context_rule(context_rule_id: u32)
    if (fn === "remove_context_rule" && args.length === 1) {
      const ruleId = scValToNative(args[0]) as number;
      if (typeof ruleId === "number") return { kind: "session-revoke", contract, ruleId };
    }

    // smart-account add_context_rule({ context_type, name, valid_until, signers, policies })
    if (fn === "add_context_rule" && args.length === 1) {
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

/** Summarize a Soroban host function (the payload of an InvokeHostFunction op). */
export function describeHostFunction(fn: xdr.HostFunction): OpSummary {
  if (fn.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    return { kind: "other", type: fn.switch().name };
  }
  return describeInvokeContract(fn.invokeContract());
}

/** Summarize a single classic/Soroban operation. */
export function describeOperation(op: xdr.Operation): OpSummary {
  const body = op.body();
  if (body.switch() !== xdr.OperationType.invokeHostFunction()) {
    return { kind: "other", type: body.switch().name };
  }
  return describeHostFunction(body.invokeHostFunctionOp().hostFunction());
}

/**
 * Parse a base64 transaction XDR and summarize each of its operations. Used by
 * the external-dApp signing page (`/sign/`) to render human-readable details
 * instead of the raw XDR blob.
 */
export function describeTransaction(txXdr: string, networkPassphrase: string): TxSummary {
  const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
  const inner = "innerTransaction" in tx ? tx.innerTransaction : tx;
  const ops: OpSummary[] = inner.operations.map((op) =>
    op.type === "invokeHostFunction"
      ? describeHostFunction(op.func)
      : { kind: "other", type: op.type },
  );
  return { fee: tx.fee, ops };
}
