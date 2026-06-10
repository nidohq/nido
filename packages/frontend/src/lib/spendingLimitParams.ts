/**
 * Spending-limit install params for the spending-limit-policy contract.
 *
 * Encodes OpenZeppelin's `SpendingLimitAccountParams { spending_limit: i128
 * stroops, period_ledgers: u32 }` as an `xdr.ScVal` for the `policies` map in
 * `add_context_rule`. The bindings pass an `xdr.ScVal` through untouched, so
 * we hand the host EXACTLY the map the `#[contracttype]` struct expects.
 *
 * DUAL-SDK HAZARD (#72) — why this builds through the bindings' `Spec`
 * instead of `xdr.ScVal.scvMap(...)` from `@stellar/stellar-sdk`:
 *
 * In BROWSER builds, vite resolves the bare `@stellar/stellar-sdk` specifier
 * via the package's `browser` condition to the webpack bundle
 * (`dist/stellar-sdk.min.js`, with its own @stellar/stellar-base baked in),
 * but `@stellar/stellar-sdk/contract` — the subpath the GENERATED BINDINGS
 * import `Spec` from — has no `browser` condition and resolves to the CJS
 * `lib/` build with a SECOND stellar-base. An ScVal constructed from the
 * bare-specifier `xdr` then fails `val instanceof xdr.ScVal` inside the
 * bindings' `Spec.funcArgsToScVals` (it checks against ITS copy), falls
 * through to stellar-base's nativeToScVal and throws
 * "cannot interpret <minified-class> value as ScVal" before signing.
 * Node resolves both subpaths to `lib/` (one copy), so unit/integration
 * tests never see this — only browser bundles do.
 *
 * Building via `spec.nativeToScVal` + the spec's own `install_params` typedef
 * constructs the value inside the SAME stellar-base copy that later converts
 * the `add_context_rule` args (every `…/contract` import in one vite bundle
 * collapses to one module instance), and as a bonus derives the field
 * order/types from the contract spec instead of hand-encoding them.
 * Same hazard family as the XDR round-trips in
 * `examples/status-message-dapp/src/lib/nidoSign.ts` and
 * `packages/passkey-sdk/src/auth.ts` — if you hand xdr objects across the
 * page↔bindings boundary, cross that boundary in the bindings' domain.
 */
import { Client as SpendingLimitPolicyClient } from "spending-limit-policy";
import type { Spec } from "@stellar/stellar-sdk/contract";
import type { xdr } from "@stellar/stellar-sdk";
import { xlmToStroops } from "./money";

export type LimitPeriod = "day" | "week" | "30d";

/** Rolling-window length per period choice, in ledgers (~5s each). */
export const PERIOD_LEDGERS: Record<LimitPeriod, number> = {
  day: 17280,
  week: 120960,
  "30d": 518400,
};

export const PERIOD_LABEL: Record<LimitPeriod, string> = {
  day: "per day",
  week: "per week",
  "30d": "per 30 days",
};

/** Highest limit we accept (keeps the i128 amount sane and typo-resistant). */
export const MAX_LIMIT_XLM = 9_999_999n;

/**
 * Parse a user-entered decimal XLM string into stroops for a spending limit.
 *
 * Pure BigInt arithmetic (via {@link xlmToStroops} — no floats), ≤ 7 decimal
 * places, must be strictly positive and at most {@link MAX_LIMIT_XLM} XLM.
 * Throws with a user-presentable message on any violation.
 */
export function stroopsFromXlm(xlm: string): bigint {
  let stroops: bigint;
  try {
    stroops = xlmToStroops(xlm);
  } catch {
    throw new Error(
      `Invalid limit amount "${xlm}" — use a plain decimal with at most 7 decimal places.`,
    );
  }
  if (stroops <= 0n) {
    throw new Error("Limit must be greater than zero.");
  }
  if (stroops > MAX_LIMIT_XLM * 10_000_000n) {
    throw new Error(`Limit must be at most ${MAX_LIMIT_XLM.toLocaleString("en-US")} XLM.`);
  }
  return stroops;
}

/**
 * The spending-limit-policy bindings' embedded contract `Spec`, memoized.
 * The client is never used for RPC — it exists purely to hand us the `Spec`
 * the generated package constructs in ITS stellar-sdk copy's domain (see the
 * module doc). Contract id / network / rpcUrl are required by the
 * constructor's types but irrelevant here: nothing touches the network.
 */
let memoizedSpec: Spec | undefined;
function policySpec(): Spec {
  memoizedSpec ??= new SpendingLimitPolicyClient({
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
  }).spec;
  return memoizedSpec;
}

/**
 * ScVal for OZ `SpendingLimitAccountParams` — `#[contracttype]` named structs
 * encode as `scvMap` with symbol keys in lexicographic order
 * (`period_ledgers` < `spending_limit`). Key order is load-bearing: the
 * Soroban host rejects unsorted maps when decoding into the struct — here it
 * comes straight from the contract spec's field order.
 *
 * Built via the policy bindings' `Spec` so the returned ScVal lives in the
 * same stellar-base copy that the smart-account bindings' `funcArgsToScVals`
 * instanceof-checks against in browser bundles (see module doc, #72).
 *
 * @param spec Override only in tests — defaults to the spending-limit-policy
 *             bindings' embedded spec, which shares its SDK copy with every
 *             other generated binding in the bundle.
 */
export function spendingLimitParamsScVal(
  stroops: bigint,
  periodLedgers: number,
  spec: Spec = policySpec(),
): xdr.ScVal {
  const installParams = spec
    .getFunc("install")
    .inputs()
    .find((input) => input.name().toString() === "install_params");
  if (!installParams) {
    throw new Error("spending-limit-policy spec has no install(install_params, …) input");
  }
  return spec.nativeToScVal(
    { period_ledgers: periodLedgers, spending_limit: stroops },
    installParams.type(),
  );
}
