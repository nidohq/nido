import type { MyNidoRow } from "./myNidoModel.js";

/**
 * Fill in on-chain registry names for active rows that lack a locally-cached
 * name, and persist each hit so later renders are instant. The My Nido menu
 * otherwise shows a name only when this browser previously claimed it or
 * visited its name subdomain — so a contract whose name lives only in the
 * registry rendered nameless ("Your Nido" + raw address).
 *
 * Independent of the DOM and the SDK: `lookup` is a contract-id → name resolver
 * (typically the registry reverse lookup) and `persist` writes the cache.
 * Best-effort — a row whose lookup rejects, returns null, or returns a
 * malformed name is left unchanged.
 *
 * @returns a map of the names newly resolved this pass (contractId → name),
 *   so the caller can patch just those rows in place.
 */

// What the registry contract's validate_name can actually issue (same rule as
// the SDK's G2C_NAME_RE and the claim form's pattern attribute). The resolved
// name becomes a subdomain href and a localStorage entry, so a name from a
// repointed registry or a lying RPC must not carry dots, slashes, or anything
// else that could escape the apex domain.
const VALID_NAME_RE = /^[a-z][a-z0-9]{0,14}$/;

export async function resolveMissingNames(
  rows: MyNidoRow[],
  lookup: (contractId: string) => Promise<string | null>,
  persist: (contractId: string, name: string) => void,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  // Pending rows can't have a registered name yet (not deployed); rows that
  // already carry a name need no network round-trip.
  const candidates = rows.filter((r) => r.status === "active" && !r.name);

  await Promise.all(
    candidates.map(async (row) => {
      try {
        const name = await lookup(row.contractId);
        if (name && VALID_NAME_RE.test(name)) {
          persist(row.contractId, name);
          resolved.set(row.contractId, name);
        }
      } catch {
        /* best-effort: a single registry failure must not blank other rows */
      }
    }),
  );

  return resolved;
}
