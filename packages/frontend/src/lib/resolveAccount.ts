// Shared hostname → account-address resolution for standalone modules that
// can't see the account page's resolved state (AssetsCard, RecentActivityCard,
// the /account/activity page).
//
// contractIdFromHostname does no strkey validation — on a name subdomain
// (joe.nido.fyi) it returns "JOE", which is not an address. Guard with
// isContractId and send names through the on-chain registry, mirroring the
// resolution the account and transfer pages do inline (they keep their own
// blocks because they also own signing-mode redirect semantics).
import {
  contractIdFromHostname,
  isContractId,
  nameFromHostname,
  resolveNameCached,
  fetchRegistryAddress,
} from "@g2c/passkey-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "./network.js";

type ResolveName = (name: string) => Promise<string | null>;

const resolveViaRegistry: ResolveName = async (name) =>
  resolveNameCached(
    RPC_URL,
    await fetchRegistryAddress("name-registry"),
    name,
    NETWORK_PASSPHRASE,
  );

/**
 * Resolve the account address for `hostname`. Contract-ID subdomains return
 * the ID directly (no network); name subdomains resolve via the registry
 * (sessionStorage-cached in resolveNameCached, 5-minute TTL). Null when
 * neither applies: bare host, reserved dApp subdomain, unregistered name,
 * or registry unreachable.
 */
export async function resolveAccountFromHostname(
  hostname: string,
  resolveName: ResolveName = resolveViaRegistry,
): Promise<string | null> {
  const sub = contractIdFromHostname(hostname);
  if (sub && isContractId(sub)) return sub;
  const name = nameFromHostname(hostname);
  if (!name) return null;
  try {
    return await resolveName(name);
  } catch {
    return null;
  }
}

let memo: Promise<string | null> | null = null;

/** Resolution of window.location.hostname, memoized for the page load so
 *  concurrent card modules share one registry round-trip (same `??=` idiom
 *  as the transfer page's registryId()). */
export function resolveAccountAddress(): Promise<string | null> {
  return (memo ??= resolveAccountFromHostname(window.location.hostname));
}
