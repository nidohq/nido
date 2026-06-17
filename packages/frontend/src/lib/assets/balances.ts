import { Address, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { RPC_URL } from "../network.js";
import { simulateRead } from "../simulateRead.js";

/**
 * Largest decimals value the UI accepts from a token contract or asset list.
 * decimals() is an on-chain u32, so a hostile token can return 4 billion —
 * which 10n ** BigInt(decimals) turns into a RangeError that would take the
 * whole assets card down. Real tokens top out around 18; 38 keeps the bigint
 * math trivially safe.
 */
export const MAX_DECIMALS = 38;

/** Validate an untrusted decimals value; null when implausible. */
export function sanitizeDecimals(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_DECIMALS
    ? value
    : null;
}

/**
 * Ledger key of a SAC's Balance entry for a CONTRACT holder. SACs store
 * C-address balances as persistent contract data keyed by
 * vec[symbol("Balance"), holder] (G-address holders use classic trustlines,
 * which never applies to the smart account). Building keys directly lets one
 * getLedgerEntries call probe the whole curated list, instead of one
 * simulation round trip per asset. Exported for tests.
 */
export function sacBalanceLedgerKey(tokenContract: string, holder: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(tokenContract).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Balance"),
        Address.fromString(holder).toScVal(),
      ]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

/** Amount from a SAC Balance entry's value ({amount, authorized, clawback} map). */
function balanceEntryAmount(val: xdr.LedgerEntryData): bigint | null {
  let native: unknown;
  try {
    native = scValToNative(val.contractData().val());
  } catch {
    return null;
  }
  if (typeof native === "bigint") return native;
  const amount = (native as { amount?: unknown } | null)?.amount;
  return typeof amount === "bigint" ? amount : null;
}

/**
 * Current SAC balances for `holder` across `tokenContracts`, batched into
 * getLedgerEntries calls (RPC caps a call at 200 keys). Tokens with no
 * Balance entry — never held, or archived — read as 0n.
 */
export async function fetchSacBalances(
  tokenContracts: string[],
  holder: string,
  rpcUrl = RPC_URL,
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>(tokenContracts.map((t) => [t, 0n]));
  if (tokenContracts.length === 0) return out;

  const server = new rpc.Server(rpcUrl);
  const keys = tokenContracts.map((t) => sacBalanceLedgerKey(t, holder));
  const keyToToken = new Map(keys.map((k, i) => [k.toXDR("base64"), tokenContracts[i]]));

  for (let i = 0; i < keys.length; i += 200) {
    const res = await server.getLedgerEntries(...keys.slice(i, i + 200));
    for (const entry of res.entries) {
      const token = keyToToken.get(entry.key.toXDR("base64"));
      if (!token) continue;
      const amount = balanceEntryAmount(entry.val);
      if (amount !== null) out.set(token, amount);
    }
  }
  return out;
}

export interface TokenProbe {
  balance: bigint;
  decimals: number;
  symbol?: string;
}

type TokenMeta = { decimals: number; symbol?: string };

/**
 * SEP-41 fallback for tokens that aren't SACs: their storage layout is
 * contract-defined, so there is no deterministic Balance ledger key —
 * simulate balance() instead, plus decimals()/symbol() for display. A zero
 * balance returns early without the metadata reads (callers hide those
 * tokens anyway). Metadata is immutable, so it's cached in localStorage to
 * keep repeat page loads at one simulation per held token. Returns null when
 * the contract isn't a token, the read fails, or it reports implausible
 * decimals — callers drop the candidate either way.
 */
export async function probeSep41Token(
  tokenContract: string,
  holder: string,
  rpcUrl = RPC_URL,
): Promise<TokenProbe | null> {
  const server = new rpc.Server(rpcUrl);
  const balance = await simulateRead(server, tokenContract, "balance", [
    Address.fromString(holder).toScVal(),
  ]);
  if (typeof balance !== "bigint") return null;
  if (balance <= 0n) return { balance, decimals: 0 };

  const metaKey = `nido:assets:meta:${tokenContract}`;
  let meta: TokenMeta | null = null;
  try {
    const cached = JSON.parse(localStorage.getItem(metaKey) ?? "null") as TokenMeta | null;
    if (cached && sanitizeDecimals(cached.decimals) !== null) {
      meta = { decimals: cached.decimals, symbol: typeof cached.symbol === "string" ? cached.symbol : undefined };
    }
  } catch {
    /* corrupt cache — refetch below */
  }
  if (!meta) {
    const [decimals, symbol] = await Promise.all([
      simulateRead(server, tokenContract, "decimals", []),
      simulateRead(server, tokenContract, "symbol", []),
    ]);
    const sane = sanitizeDecimals(decimals);
    if (sane === null) return null;
    meta = { decimals: sane, symbol: typeof symbol === "string" ? symbol : undefined };
    try {
      localStorage.setItem(metaKey, JSON.stringify(meta));
    } catch {
      /* best-effort cache */
    }
  }
  return { balance, decimals: meta.decimals, symbol: meta.symbol };
}
