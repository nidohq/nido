/**
 * mlDsaParanoid.ts — hybrid 2-of-2 "paranoid mode": a Default rule holding
 * BOTH the passkey and the ML-DSA backstop key. Policy-less multi-signer
 * rules are strict AND in OZ, so every transaction under this rule needs
 * both signatures — spending stays unforgeable even if P-256 falls.
 *
 * Default rules are OR between each other, so the hybrid rule alone protects
 * nothing while a passkey-only Default rule still exists. Hence two stages:
 *
 *   - ARM: install the hybrid rule (account keeps working via rule 0).
 *   - ENFORCE: remove the passkey-only Default rules; from then on
 *     `signAndSubmit` detects the rule's ML-DSA co-signer and dual-signs
 *     automatically (see primaryPasskeySigner).
 *
 * STAND DOWN reverses it: restore a passkey-only Default rule first (so the
 * account never depends on a rule about to be removed), then drop the
 * hybrid rule. Enforce refuses to remove rules that carry policies — those
 * would be silently dropped with the rule.
 */

import { Buffer } from "buffer";
import { Client as SmartAccountClient } from "@nidohq/smart-account";
import {
  extractXdrOperations,
  loadCredential,
  hex2buf,
  buf2hex,
  type ChainRule,
} from "@nidohq/passkey-sdk";
import { fetchAllChainRules } from "./policyChainFetch.js";
import { signAndSubmit } from "./primaryPasskeySigner.js";
import { loadBackstopKey } from "./mlDsaBackstop.js";
import { resolveMlDsaVerifier } from "./mlDsaEnroll.js";
import { buildRemoveRuleOperation } from "./mlDsaSign.js";
import { RPC_URL, NETWORK_PASSPHRASE } from "./network.js";

export const PARANOID_RULE_NAME = "paranoid";
/** Name for the passkey-only rule STAND DOWN restores. */
export const SOLO_RULE_NAME = "solo";

/** The hybrid rule: Default type, no policies, exactly two External signers,
 *  exactly one of them on the ML-DSA verifier. */
export function isHybridRule(rule: ChainRule, mlDsaVerifier: string): boolean {
  if (rule.contextType.kind !== "default" || rule.policies.length > 0) return false;
  const externals = rule.signers.filter((s) => s.kind === "external");
  if (externals.length !== 2 || externals.length !== rule.signers.length) return false;
  return externals.filter((s) => s.kind === "external" && s.verifier === mlDsaVerifier).length === 1;
}

/** Passkey-only Default rules (no ML-DSA signer, no policies) — what ENFORCE
 *  removes. Rules with policies are reported separately, never auto-removed. */
export function soloPasskeyDefaultRules(
  rules: ChainRule[],
  mlDsaVerifier: string,
): { removable: ChainRule[]; blocked: ChainRule[] } {
  const solo = rules.filter(
    (r) =>
      r.contextType.kind === "default" &&
      r.signers.length > 0 &&
      r.signers.every((s) => s.kind === "external" && s.verifier !== mlDsaVerifier),
  );
  return {
    removable: solo.filter((r) => r.policies.length === 0),
    blocked: solo.filter((r) => r.policies.length > 0),
  };
}

export interface ParanoidStatus {
  state: "off" | "armed" | "enforced";
  hybridRuleId: number | null;
  /** Passkey-only Default rules ENFORCE would remove. */
  removable: Array<{ ruleId: number; name: string }>;
  /** Passkey-only Default rules blocked by attached policies. */
  blocked: Array<{ ruleId: number; name: string }>;
}

export async function getParanoidStatus(account: string): Promise<ParanoidStatus> {
  const [mlDsaVerifier, rules] = await Promise.all([
    resolveMlDsaVerifier(),
    fetchAllChainRules(account),
  ]);
  const hybrid = rules.find((r) => isHybridRule(r, mlDsaVerifier)) ?? null;
  const { removable, blocked } = soloPasskeyDefaultRules(rules, mlDsaVerifier);
  const strip = (r: ChainRule) => ({ ruleId: r.ruleId, name: r.name });
  if (!hybrid) {
    return { state: "off", hybridRuleId: null, removable: removable.map(strip), blocked: blocked.map(strip) };
  }
  return {
    state: removable.length + blocked.length > 0 ? "armed" : "enforced",
    hybridRuleId: hybrid.ruleId,
    removable: removable.map(strip),
    blocked: blocked.map(strip),
  };
}

function smartAccount(account: string): SmartAccountClient {
  return new SmartAccountClient({
    contractId: account,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
}

async function buildDefaultRuleOperation(
  account: string,
  name: string,
  signers: Array<{ verifier: string; keyData: Uint8Array }>,
): Promise<unknown> {
  const tx = await smartAccount(account).add_context_rule({
    context_type: { tag: "Default", values: undefined },
    name,
    valid_until: undefined,
    signers: signers.map((s) => ({
      tag: "External" as const,
      values: [s.verifier, Buffer.from(s.keyData)] as readonly [string, Buffer],
    })),
    policies: new Map(),
  });
  return extractXdrOperations(tx, name)[0];
}

type OnProgress = Parameters<typeof signAndSubmit>[0]["onProgress"];

/** ARM: install the hybrid rule. The current passkey signs (rule 0 still
 *  active, so no dual-sign yet). Requires the local backstop key. */
export async function armParanoid(args: {
  account: string;
  webauthnVerifier: string;
  onProgress?: OnProgress;
}): Promise<void> {
  const key = loadBackstopKey(localStorage);
  if (!key) throw new Error("No backstop key on this device.");
  const cred = loadCredential(args.account);
  if (!cred) throw new Error("No passkey registered for this account.");
  const mlDsaVerifier = await resolveMlDsaVerifier();
  const operation = await buildDefaultRuleOperation(args.account, PARANOID_RULE_NAME, [
    { verifier: args.webauthnVerifier, keyData: hex2buf(cred.publicKey) },
    { verifier: mlDsaVerifier, keyData: key.commitment },
  ]);
  await signAndSubmit({ account: args.account, operation, onProgress: args.onProgress });
}

/**
 * ENFORCE: remove every removable passkey-only Default rule, sequentially.
 * After the first removal lands, `signAndSubmit` resolves the passkey into
 * the hybrid rule and dual-signs the remaining transactions automatically.
 */
export async function enforceParanoid(args: {
  account: string;
  onProgress?: OnProgress;
}): Promise<void> {
  const status = await getParanoidStatus(args.account);
  if (status.state === "off") throw new Error("Arm paranoid mode first.");
  for (const rule of status.removable) {
    const operation = await buildRemoveRuleOperation(args.account, rule.ruleId);
    await signAndSubmit({ account: args.account, operation, onProgress: args.onProgress });
  }
}

/**
 * STAND DOWN: restore a passkey-only Default rule if none exists (dual-signed
 * under the hybrid rule), then remove the hybrid rule.
 */
export async function standDownParanoid(args: {
  account: string;
  webauthnVerifier: string;
  onProgress?: OnProgress;
}): Promise<void> {
  const status = await getParanoidStatus(args.account);
  if (status.hybridRuleId === null) return;
  if (status.removable.length + status.blocked.length === 0) {
    const cred = loadCredential(args.account);
    if (!cred) throw new Error("No passkey registered for this account.");
    const operation = await buildDefaultRuleOperation(args.account, SOLO_RULE_NAME, [
      { verifier: args.webauthnVerifier, keyData: hex2buf(cred.publicKey) },
    ]);
    await signAndSubmit({ account: args.account, operation, onProgress: args.onProgress });
  }
  const operation = await buildRemoveRuleOperation(args.account, status.hybridRuleId);
  await signAndSubmit({ account: args.account, operation, onProgress: args.onProgress });
}

/** Local-key sanity for the UI: the hybrid rule's ML-DSA signer must be THIS
 *  device's backstop key or dual-signing will fail. */
export function hybridMatchesLocalKey(rule: ChainRule): boolean {
  const key = loadBackstopKey(localStorage);
  if (!key) return false;
  const hex = buf2hex(key.commitment);
  return rule.signers.some(
    (s) => s.kind === "external" && buf2hex(s.publicKey) === hex,
  );
}
