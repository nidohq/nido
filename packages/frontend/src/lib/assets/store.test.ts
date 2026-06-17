import { describe, it, expect, beforeEach } from "vitest";
import { loadKnownAssets, replaceKnownAssets } from "./store.js";
import type { AssetCandidate } from "./types.js";

const ACCOUNT = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const token = (n: number): AssetCandidate => ({
  contractId: `C${String(n).padStart(55, "0")}`,
  sac: false,
  source: "events",
});

beforeEach(() => localStorage.clear());

describe("known-assets store", () => {
  it("round-trips and remaps source to 'stored'", () => {
    replaceKnownAssets(ACCOUNT, [{ ...token(1), code: "FOO" }]);
    expect(loadKnownAssets(ACCOUNT)).toEqual([{ ...token(1), code: "FOO", source: "stored" }]);
  });

  it("overwrites: entries absent from the new set are pruned", () => {
    replaceKnownAssets(ACCOUNT, [token(1), token(2)]);
    replaceKnownAssets(ACCOUNT, [token(2)]);
    expect(loadKnownAssets(ACCOUNT).map((a) => a.contractId)).toEqual([token(2).contractId]);
  });

  it("dedups by contract id within one save", () => {
    replaceKnownAssets(ACCOUNT, [token(1), { ...token(1), code: "DUP" }]);
    expect(loadKnownAssets(ACCOUNT)).toHaveLength(1);
  });

  it("is scoped per account", () => {
    replaceKnownAssets(ACCOUNT, [token(1)]);
    expect(loadKnownAssets("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")).toEqual([]);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem(`nido:assets:known:${ACCOUNT}`, "{not json");
    expect(loadKnownAssets(ACCOUNT)).toEqual([]);
  });

  it("caps the persisted set at 100 entries", () => {
    replaceKnownAssets(ACCOUNT, Array.from({ length: 150 }, (_, i) => token(i)));
    expect(loadKnownAssets(ACCOUNT)).toHaveLength(100);
  });
});
