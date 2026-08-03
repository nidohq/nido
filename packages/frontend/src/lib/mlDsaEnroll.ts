/**
 * mlDsaEnroll.ts — enroll the ML-DSA backstop key as an on-chain signer.
 *
 * The enrollment is an `add_context_rule` on the user's smart account:
 * `ContextRuleType::CallContract(account)` (self-scoped), one
 * `Signer::External(mldsa_verifier, commitment)` signer, no policies. OZ
 * matches a CallContract rule by target contract only, and a self-scoped rule
 * never matches a call to any OTHER contract — so the backstop key can
 * authorize account administration (add/remove signers, cancel a forged
 * recovery) but is structurally unable to spend. The rule is installed with
 * the user's existing passkey via the same signAndSubmit flow session keys
 * use, and `add_context_rule` is already in the relayer allowlist.
 */

import { Buffer } from "buffer";
import { Client as SmartAccountClient } from "@nidohq/smart-account";
import { extractXdrOperations, type ChainRule } from "@nidohq/passkey-sdk";
import {
  fetchRegistryAddress,
  fetchAllChainRules,
  fetchVerifierAddress,
} from "./policyChainFetch.js";
import { signAndSubmit } from "./primaryPasskeySigner.js";
import { RPC_URL, NETWORK_PASSPHRASE } from "./network.js";

/** Rule name shown in policy listings and bound on-chain at enrollment. */
export const BACKSTOP_RULE_NAME = "pq-backstop";

/** Registry name of the deployed nido-ml-dsa-verifier contract. */
export const ML_DSA_VERIFIER_REGISTRY_NAME = "mldsa-verifier";

export function resolveMlDsaVerifier(): Promise<string> {
  return fetchRegistryAddress(ML_DSA_VERIFIER_REGISTRY_NAME);
}

/**
 * A rule is "self-admin shaped" when it is CallContract(account) with no
 * policies: the shape of the ML-DSA backstop (and of nothing else nido
 * installs — multisig recovery is self-scoped but carries its policy;
 * session keys target OTHER contracts). Used both to find the backstop rule
 * and to keep such rules out of the session-key policy-block loader, which
 * would otherwise claim them as revocable "session keys".
 */
export function isSelfAdminRule(rule: ChainRule, account: string): boolean {
  return (
    rule.contextType.kind === "call-contract" &&
    rule.contextType.contract === account &&
    rule.policies.length === 0
  );
}

/** Find the enrolled backstop rule for the given ML-DSA verifier, if any. */
export function findBackstopRule(
  rules: ChainRule[],
  account: string,
  mlDsaVerifier: string,
): ChainRule | null {
  return (
    rules.find(
      (r) =>
        isSelfAdminRule(r, account) &&
        r.signers.length === 1 &&
        r.signers[0].kind === "external" &&
        r.signers[0].verifier === mlDsaVerifier,
    ) ?? null
  );
}

export interface BackstopEnrollment {
  ruleId: number;
  /** The 32-byte key commitment registered on-chain (`key_data`). */
  commitment: Uint8Array;
}

/** Read the account's current backstop enrollment (null when not enrolled). */
export async function getBackstopEnrollment(
  account: string,
): Promise<BackstopEnrollment | null> {
  const [verifier, rules] = await Promise.all([
    resolveMlDsaVerifier(),
    fetchAllChainRules(account),
  ]);
  const rule = findBackstopRule(rules, account, verifier);
  if (!rule || rule.signers[0].kind !== "external") return null;
  return { ruleId: rule.ruleId, commitment: rule.signers[0].publicKey };
}

/** Build the add_context_rule operation enrolling `commitment` as backstop. */
export async function buildEnrollOperation(
  account: string,
  mlDsaVerifier: string,
  commitment: Uint8Array,
): Promise<unknown> {
  const client = new SmartAccountClient({
    contractId: account,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
  const tx = await client.add_context_rule({
    context_type: { tag: "CallContract", values: [account] as readonly [string] },
    name: BACKSTOP_RULE_NAME,
    valid_until: undefined,
    signers: [
      {
        tag: "External" as const,
        values: [mlDsaVerifier, Buffer.from(commitment)] as readonly [string, Buffer],
      },
    ],
    policies: new Map(),
  });
  return extractXdrOperations(tx, BACKSTOP_RULE_NAME)[0];
}

/**
 * Enroll the backstop key: build the rule op, have the user's passkey
 * authorize it, submit (relayer or classic), and return the tx response.
 */
export async function enrollBackstop(args: {
  account: string;
  commitment: Uint8Array;
  onProgress?: Parameters<typeof signAndSubmit>[0]["onProgress"];
}): Promise<void> {
  const mlDsaVerifier = await resolveMlDsaVerifier();
  const operation = await buildEnrollOperation(args.account, mlDsaVerifier, args.commitment);
  // The PASSKEY verifier authorizes this mutation — the ML-DSA verifier is
  // only referenced inside the new rule being installed.
  const passkeyVerifier = await fetchVerifierAddress(args.account);
  await signAndSubmit({
    account: args.account,
    operation,
    verifierAddress: passkeyVerifier,
    onProgress: args.onProgress,
  });
}
