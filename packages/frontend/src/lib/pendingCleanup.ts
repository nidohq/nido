// Unfinished setups that can never finish. A setup whose secret expired
// (passkey-sdk PENDING_TTL_MS) keeps its address only so an account created
// before it expired can still be finished from its row. Once the secret is
// gone, nothing can create an account at an address that holds none, so such
// a row is a dead end: it is dropped. One whose address can't be read now is
// kept for the next check.

export interface PendingCleanupDeps {
  /** Unfinished setups; `setupKey` is absent once the secret expired. */
  unfinished(): { contractId: string; setupKey?: string }[];
  /** Whether any contract is deployed at `contractId`. */
  deployed(contractId: string): Promise<boolean>;
  remove(contractId: string): void;
}

/** Drop every secret-less setup whose address holds no contract. Resolves
 *  whether any was dropped. */
export async function dropUnfinishableSetups(deps: PendingCleanupDeps): Promise<boolean> {
  const expired = deps.unfinished().filter((p) => !p.setupKey);
  const deployed = await Promise.all(
    expired.map((p) => deps.deployed(p.contractId).catch((): boolean | null => null)),
  );
  let dropped = false;
  expired.forEach((p, i) => {
    if (deployed[i] !== false) return;
    deps.remove(p.contractId);
    dropped = true;
  });
  return dropped;
}
