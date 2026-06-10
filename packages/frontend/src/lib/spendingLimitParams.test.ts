import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { xdr, nativeToScVal, scValToNative, Networks } from "@stellar/stellar-sdk";
import { Client as SmartAccountClient } from "smart-account";
import { Client as SpendingLimitPolicyClient } from "spending-limit-policy";
import {
  PERIOD_LEDGERS,
  PERIOD_LABEL,
  stroopsFromXlm,
  spendingLimitParamsScVal,
} from "./spendingLimitParams";

/** Encode the way the delegate page does: user XLM string + period. */
function encode(xlm: string, period: keyof typeof PERIOD_LEDGERS): xdr.ScVal {
  return spendingLimitParamsScVal(stroopsFromXlm(xlm), PERIOD_LEDGERS[period]);
}

/** Any well-formed C-address — the clients below never touch the network;
 *  they exist only to hand us their embedded contract `Spec`s. */
const DUMMY_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const CLIENT_OPTS = {
  contractId: DUMMY_CONTRACT,
  networkPassphrase: Networks.TESTNET,
  rpcUrl: "https://soroban-testnet.stellar.org",
};

/**
 * Load the SDK's WEBPACK BROWSER BUNDLE (`dist/stellar-sdk.min.js`) as a
 * SECOND, independent copy of the SDK — its classes are distinct from the
 * `lib/` copy this test file imports. This is exactly the dual-copy situation
 * vite creates in browser builds (`.` resolves via the `browser` condition to
 * the bundle, `./contract` — what the generated bindings import — to `lib/`),
 * reproduced under Node so vitest can pin the hazard. See the module doc of
 * `spendingLimitParams.ts` for the full story (#72).
 */
function loadBrowserBundleSdk(): typeof import("@stellar/stellar-sdk") {
  const require_ = createRequire(import.meta.url);
  const libIndex = require_.resolve("@stellar/stellar-sdk"); // …/lib/index.js under Node
  const minPath = libIndex.replace(/lib[/\\]index\.js$/, "dist/stellar-sdk.min.js");
  // The UMD wrapper needs a `self` global (jsdom provides one in this config).
  return require_(minPath) as typeof import("@stellar/stellar-sdk");
}

describe("spendingLimitParamsScVal", () => {
  it("encodes {xlm:'5', period:'day'} as an scvMap matching OZ SpendingLimitAccountParams", () => {
    const v = encode("5", "day");
    expect(v.switch()).toBe(xdr.ScValType.scvMap());
    const entries = v.map()!;
    expect(entries.length).toBe(2);

    // #[contracttype] named structs encode as symbol keys in LEXICOGRAPHIC
    // order — period_ledgers < spending_limit. Order is load-bearing: the
    // host rejects unsorted maps.
    expect(entries[0].key().sym().toString()).toBe("period_ledgers");
    expect(entries[1].key().sym().toString()).toBe("spending_limit");

    expect(entries[0].val().switch()).toBe(xdr.ScValType.scvU32());
    expect(entries[0].val().u32()).toBe(17280);

    expect(entries[1].val().switch()).toBe(xdr.ScValType.scvI128());
    expect(scValToNative(entries[1].val())).toBe(50_000_000n);
  });

  it("round-trips through XDR with key order pinned", () => {
    const v = encode("5", "day");
    const decoded = xdr.ScVal.fromXDR(v.toXDR());
    const entries = decoded.map()!;
    expect(entries.map((e) => e.key().sym().toString())).toEqual([
      "period_ledgers",
      "spending_limit",
    ]);
    expect(entries[0].val().u32()).toBe(17280);
    expect(scValToNative(entries[1].val())).toBe(50_000_000n);
  });

  it("maps week and 30d periods to the right ledger counts", () => {
    const week = encode("1", "week");
    expect(week.map()![0].val().u32()).toBe(120960);
    const thirty = encode("1", "30d");
    expect(thirty.map()![0].val().u32()).toBe(518400);
    expect(PERIOD_LEDGERS.day).toBe(17280);
    expect(PERIOD_LEDGERS.week).toBe(120960);
    expect(PERIOD_LEDGERS["30d"]).toBe(518400);
  });

  it("has a human label for every period", () => {
    expect(PERIOD_LABEL.day).toBe("per day");
    expect(PERIOD_LABEL.week).toBe("per week");
    expect(PERIOD_LABEL["30d"]).toBe("per 30 days");
  });
});

describe("spendingLimitParamsScVal cross-copy domain (#72 browser hazard)", () => {
  it("produces bytes identical to the previous hand-built scvMap", () => {
    const v = encode("5", "day");
    const manual = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("period_ledgers"),
        val: xdr.ScVal.scvU32(17280),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("spending_limit"),
        val: nativeToScVal(50_000_000n, { type: "i128" }),
      }),
    ]);
    expect(v.toXDR("base64")).toBe(manual.toXDR("base64"));
  });

  it("constructs the value in the SAME stellar-base copy as the Spec doing the encoding", () => {
    // Negative control first: prove this process really holds two distinct
    // SDK copies, i.e. an ScVal from the browser bundle is FOREIGN to the
    // lib/ copy the bindings (and this test file, under Node) use.
    const browserSdk = loadBrowserBundleSdk();
    const foreign = browserSdk.xdr.ScVal.scvU32(1);
    expect(foreign instanceof xdr.ScVal).toBe(false);

    // A Spec living in the browser-bundle copy (built from the same entries
    // the spending-limit-policy bindings embed).
    const libSpec = new SpendingLimitPolicyClient(CLIENT_OPTS).spec;
    const browserSpec = new browserSdk.contract.Spec(
      libSpec.entries.map((e) => e.toXDR("base64")),
    );

    // The helper must build in whatever copy the GIVEN Spec belongs to —
    // that is the whole fix: the value passes the `val instanceof xdr.ScVal`
    // check inside that Spec's `funcArgsToScVals`, instead of falling
    // through to stellar-base's nativeToScVal ("cannot interpret … value
    // as ScVal") as the bare-`@stellar/stellar-sdk` xdr did in browser builds.
    const viaBrowserSpec = spendingLimitParamsScVal(5_000_000n, 17280, browserSpec);
    expect(viaBrowserSpec instanceof browserSdk.xdr.ScVal).toBe(true);
    expect(viaBrowserSpec instanceof xdr.ScVal).toBe(false);
    expect(viaBrowserSpec.toXDR("base64")).toBe(encode("0.5", "day").toXDR("base64"));
  });

  it("is accepted by the smart-account Spec's add_context_rule conversion; a foreign-copy ScVal is not", () => {
    const saSpec = new SmartAccountClient(CLIENT_OPTS).spec;
    const args = (params: xdr.ScVal) => ({
      context_type: { tag: "CallContract", values: [DUMMY_CONTRACT] },
      name: "session-key",
      valid_until: undefined,
      signers: [],
      policies: new Map([[DUMMY_CONTRACT, params]]),
    });

    // The fixed helper's output sails through untouched.
    expect(() => saSpec.funcArgsToScVals("add_context_rule", args(encode("5", "day")))).not.toThrow();

    // The production failure, pinned: the same value built in the OTHER SDK
    // copy is rejected exactly the way the delegate page failed in browsers.
    const browserSdk = loadBrowserBundleSdk();
    const libSpec = new SpendingLimitPolicyClient(CLIENT_OPTS).spec;
    const browserSpec = new browserSdk.contract.Spec(
      libSpec.entries.map((e) => e.toXDR("base64")),
    );
    const foreignParams = spendingLimitParamsScVal(5_000_000n, 17280, browserSpec);
    expect(() => saSpec.funcArgsToScVals("add_context_rule", args(foreignParams))).toThrow(
      /cannot interpret .* value as ScVal/,
    );
  });
});

describe("stroopsFromXlm", () => {
  it("converts whole and fractional XLM without floats", () => {
    expect(stroopsFromXlm("5")).toBe(50_000_000n);
    expect(stroopsFromXlm("1.2345678")).toBe(12_345_678n);
    expect(stroopsFromXlm("0.0000001")).toBe(1n);
    expect(stroopsFromXlm("9999999")).toBe(99_999_990_000_000n);
  });

  it("rejects zero and negative amounts", () => {
    for (const bad of ["0", "0.0", "0.0000000", "-1", "-0.5"]) {
      expect(() => stroopsFromXlm(bad)).toThrow();
    }
  });

  it("rejects amounts above 9,999,999 XLM", () => {
    expect(() => stroopsFromXlm("10000000")).toThrow();
    expect(() => stroopsFromXlm("9999999.0000001")).toThrow();
  });

  it("rejects malformed decimals and >7 decimal places", () => {
    for (const bad of ["", "abc", "1.2.3", ".5", "1.", "1e3", "1.12345678", "0x10"]) {
      expect(() => stroopsFromXlm(bad)).toThrow();
    }
  });
});
