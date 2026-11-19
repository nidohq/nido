// One-time migration of the apex's sign-in list (the accounts `/connect/`
// offers), run on the apex before the list is shown.
//
// Rule: an entry is kept, as owned here, only if this browser holds a passkey
// record for that address on that network; every other entry is dropped. No
// passkey record is ever deleted, and an unfinished setup (the pending list)
// is not an entry of this list.
//
// Where the entries come from:
//
// - `nido:<network>:accounts`, this build's own list. Its network is the one
//   the key names.
// - On a mainnet build only, `nido:testnet:accounts`: the list the mainnet
//   `/connect/` and storage bridge read and wrote by mistake (they never set
//   the storage network, which then defaulted to testnet). It holds mainnet
//   accounts the bridge wrote since the mainnet switchover alongside testnet
//   accounts from when this origin served testnet, and nothing records which
//   is which. For those entries the chain decides: an address whose contract
//   is deployed on mainnet is a mainnet address (a contract address commits
//   to the network passphrase, so a testnet address can't exist on mainnet).
//   An address with nothing deployed on mainnet is not carried over. Once the
//   migration completes, that list and the setup entries stored beside it are
//   removed; mainnet setups are recorded in `nido:mainnet:pending` as well.
//
// The passkey record of an account lives on its own origin
// (`passkey:<C>:*` at `<c>.<apex>`), so whether this browser holds one is
// asked of that origin (`probeAccountOwnership`). An origin that answers that
// its frame can't see its own storage (`separated`: WebKit) will never answer
// otherwise from this browser, so that is a decision: the entry is kept
// rather than dropped on an answer that proves nothing (a legacy entry still
// only if the chain places it on this network). An entry neither check could
// decide (no answer, RPC unreachable) is left as it is, the migration is not
// marked done, and the next page load tries again.

import { nidoKey } from "@nidohq/passkey-sdk/storage";

type Network = "testnet" | "mainnet";
type MigrationStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AccountMigrationDeps {
  /** This build's network. */
  network: Network;
  store: MigrationStore;
  /** Whether this browser holds `contractId`'s passkey record; `separated` if
   *  its origin answered that it can't tell; null if it did not answer. */
  hasPasskey(contractId: string): Promise<boolean | "separated" | null>;
  /** Whether a contract is deployed at `contractId` on this build's network;
   *  null if unknown. Asked only of entries whose network the store doesn't
   *  say. */
  deployedHere(contractId: string): Promise<boolean | null>;
}

export interface AccountMigrationResult {
  /** False when the migration had already completed: nothing was read or written. */
  ran: boolean;
  kept: string[];
  dropped: string[];
  /** Entries neither kept nor dropped yet; the next run decides them. */
  undecided: string[];
}

/** Set once the migration has decided every entry. */
const DONE_KEY = () => nidoKey("accounts:migrated:v1");
const LEGACY = "nido:testnet:";
/** Ownership probes in flight at once (each frames one account origin). */
const PROBE_CONCURRENCY = 4;

function readList(store: MigrationStore, key: string): string[] {
  try {
    const raw = JSON.parse(store.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const safely = async <T>(read: () => Promise<T | null>): Promise<T | null> => {
  try {
    return await read();
  } catch {
    return null;
  }
};

export async function migrateAccountList(deps: AccountMigrationDeps): Promise<AccountMigrationResult> {
  const { store, network } = deps;
  if (store.getItem(DONE_KEY()) !== null) return { ran: false, kept: [], dropped: [], undecided: [] };

  const accountsKey = nidoKey("accounts");
  const current = readList(store, accountsKey);
  const legacy = network === "mainnet" ? readList(store, `${LEGACY}accounts`).filter((c) => !current.includes(c)) : [];
  const candidates = [...current, ...legacy];

  const verdicts = await mapLimited(candidates, PROBE_CONCURRENCY, async (contractId) => {
    const owned = await safely(() => deps.hasPasskey(contractId));
    if (owned === false || owned === null) return owned;
    return legacy.includes(contractId) ? safely(() => deps.deployedHere(contractId)) : true;
  });

  const kept = candidates.filter((_, i) => verdicts[i] === true);
  const dropped = candidates.filter((_, i) => verdicts[i] === false);
  const undecided = candidates.filter((_, i) => verdicts[i] === null);

  // The list is read again here: the storage bridge may have added an account
  // while the probes ran. Only dropped entries leave it, so undecided entries
  // of this network's own list stay listed until decided; undecided legacy
  // entries stay in the legacy list until then.
  const listed = readList(store, accountsKey).filter((c) => !dropped.includes(c));
  const list = [...listed, ...kept.filter((c) => !listed.includes(c))];
  store.setItem(accountsKey, JSON.stringify(list));
  for (const contractId of kept.filter((c) => legacy.includes(c))) {
    const name = store.getItem(`${LEGACY}names:${contractId}`);
    const nameKey = nidoKey(`names:${contractId}`);
    if (name !== null && store.getItem(nameKey) === null) store.setItem(nameKey, name);
  }

  if (undecided.length === 0) {
    if (network === "mainnet") {
      for (const rest of ["accounts", "pending", "pending:ts"]) store.removeItem(`${LEGACY}${rest}`);
    }
    store.setItem(DONE_KEY(), new Date().toISOString());
  }
  return { ran: true, kept, dropped, undecided };
}
