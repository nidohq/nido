// At-a-glance security summary for the desktop Home dashboard.
//
// Distils the same on-chain policy data the Security page renders in full
// (passkey presence, the recovery quorum, and active delegations) down to the
// few numbers the Home "Security" card shows. Reuses the exact load path the
// Security page uses (fetchAllChainRules + loadPolicyBlocks) so the two stay in
// agreement.
import {
  loadPolicyBlocks,
  loadFriendNicknames,
  loadBlockLabels,
  loadSessionKeyMaterial,
  loadCredential,
} from "@g2c/passkey-sdk";
import { fetchAllChainRules, fetchPolicyState } from "./policyChainFetch.js";

export interface SecuritySummary {
  /** A passkey credential for this account is stored on this device. */
  hasPasskey: boolean;
  /** Quorum of the first recovery rule, or null if recovery isn't set up. */
  recovery: { threshold: number; friends: number } | null;
  /** Number of active scoped session-key delegations ("apps you've let in"). */
  delegations: number;
}

/** Walk localStorage for any session-key material this account holds. */
function collectSessionKeyMaterial(account: string) {
  const out: Record<string, NonNullable<ReturnType<typeof loadSessionKeyMaterial>>> = {};
  const prefix = `g2c.${account}.session-key.`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (key.startsWith(prefix)) {
      const target = key.slice(prefix.length);
      const m = loadSessionKeyMaterial(account, target);
      if (m) out[target] = m;
    }
  }
  return out;
}

export async function fetchSecuritySummary(account: string): Promise<SecuritySummary> {
  const hasPasskey = Boolean(loadCredential(account));

  const overlay = {
    friendNicknames: loadFriendNicknames(account),
    blockLabels: loadBlockLabels(account),
    sessionKeyMaterial: collectSessionKeyMaterial(account),
  };
  const rules = await fetchAllChainRules(account);
  const blocks = await loadPolicyBlocks({
    rules,
    fetchPolicyState: (rule) => fetchPolicyState(account, rule),
    overlay,
  });

  return { hasPasskey, ...summarizePolicyBlocks(blocks) };
}

/**
 * Pure classification of loaded policy blocks into the at-a-glance counts.
 * Extracted so it can be unit-tested without any RPC/localStorage.
 */
export function summarizePolicyBlocks(
  blocks: Array<{ kind: string; threshold?: number; friends?: unknown[] }>,
): Pick<SecuritySummary, "recovery" | "delegations"> {
  let recovery: SecuritySummary["recovery"] = null;
  let delegations = 0;
  for (const block of blocks) {
    if (block.kind === "multisig-recovery") {
      // Surface the first recovery rule's quorum (accounts have at most one in
      // practice; if more are added, the card shows the first and the Security
      // page lists them all).
      recovery ??= {
        threshold: block.threshold ?? 0,
        friends: block.friends?.length ?? 0,
      };
    } else if (block.kind === "scoped-session-key") {
      delegations += 1;
    }
  }
  return { recovery, delegations };
}
