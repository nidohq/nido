// Simulate a Nido account's __check_auth locally and return a Kleene verdict.
//
// Mirrors OZ `do_check_auth` (context-rule match → signer authentication over
// the auth digest → policy enforcement) with the policy layer being perch: a
// rule's function allowlist, argument predicates, expiry, and signer floor are
// evaluated here (perch isn't on-chain yet, so the simulator IS the interpreter).
// On-chain is boolean (allow / trap); `abstain` is a testkit-side convenience
// meaning "no rule even applies to this call".

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { computeAuthDigest } from './auth.js';
import { verifySignature } from './verifiers.js';
import type { LocalAccount } from './account.js';
import type { ArgPred, Rule } from './perch/policy.js';

export type SimArg =
  | { type: 'address'; value: string }
  | { type: 'u32'; value: number }
  | { type: 'string'; value: string }
  | { type: 'symbol'; value: string }
  | { type: 'i128'; value: bigint | string }
  | { type: 'bytes'; value: Uint8Array };

export interface SimContext {
  /** Target contract for a CallContract rule; omit for a self-admin call. */
  contract?: string;
  fn: string;
  args?: SimArg[];
  /** Current ledger sequence (for expiry). Default 0. */
  ledger?: number;
}

export type Verdict = 'allow' | 'deny' | 'abstain';

export interface SimResult {
  verdict: Verdict;
  /** hex of the digest each signer signed. */
  authDigest: string;
  matchedRule?: string;
  reasons: string[];
  signerChecks: { id: string; verifier: string; ok: boolean }[];
}

function stableContext(ctx: SimContext): string {
  const args = (ctx.args ?? []).map((a) =>
    a.type === 'bytes'
      ? { type: a.type, value: bytesToHex(a.value) }
      : a.type === 'i128'
        ? { type: a.type, value: String(a.value) }
        : a,
  );
  return JSON.stringify({ contract: ctx.contract ?? null, fn: ctx.fn, args, ledger: ctx.ledger ?? 0 });
}

function scopeMatches(rule: Rule, account: LocalAccount, ctx: SimContext): boolean {
  if (rule.scope.type === 'self-admin') return ctx.contract === undefined || ctx.contract === account.address;
  return ctx.contract === rule.scope.address;
}

function argSatisfies(pred: ArgPred, arg: SimArg | undefined, account: LocalAccount): boolean {
  if (!arg) return false;
  switch (pred.type) {
    case 'is-self':
      return arg.type === 'address' && arg.value === account.address;
    case 'address-eq':
      return arg.type === 'address' && arg.value === pred.address;
    case 'u32-eq':
      return arg.type === 'u32' && arg.value === pred.value;
    case 'string-in':
      return (arg.type === 'string' || arg.type === 'symbol') && pred.values.includes(arg.value);
    case 'string-prefix':
      return (arg.type === 'string' || arg.type === 'symbol') && arg.value.startsWith(pred.prefix);
  }
}

export function simulateCheckAuth(account: LocalAccount, ctx: SimContext, signedBy: string[]): SimResult {
  const ledger = ctx.ledger ?? 0;
  const reasons: string[] = [];

  // 1. Find the rule whose scope this call falls under.
  const idx = account.policy.rules.findIndex((r) => scopeMatches(r, account, ctx));
  if (idx < 0) {
    return { verdict: 'abstain', authDigest: '', reasons: ['no rule applies to this call'], signerChecks: [] };
  }
  const rule = account.policy.rules[idx]!;

  // 2. Digest bound to this rule; authenticate the signers that signed it.
  const payload = sha256(new TextEncoder().encode(stableContext(ctx)));
  const digest = computeAuthDigest(payload, [idx]);
  const signerChecks = signedBy.map((id) => {
    const s = account.signers.find((x) => x.id === id);
    if (!s) return { id, verifier: '(unknown)', ok: false };
    return { id, verifier: s.verifier, ok: verifySignature(s.algorithm, digest, s.publicKey, s.signAuth(digest)) };
  });
  const authenticated = new Set(signerChecks.filter((c) => c.ok).map((c) => c.id));

  const base: Omit<SimResult, 'verdict'> = {
    authDigest: bytesToHex(digest),
    matchedRule: rule.name,
    reasons,
    signerChecks,
  };
  const deny = (why: string): SimResult => {
    reasons.push(why);
    return { verdict: 'deny', ...base };
  };

  // 3. Expiry (perch "dead at or after"; OZ valid_until is inclusive one below).
  const notAfter = rule['not-after-ledger'];
  if (notAfter !== undefined && ledger >= notAfter) return deny(`rule expired (ledger ${ledger} ≥ ${notAfter})`);

  // 4. Function allowlist.
  if (rule.functions && !rule.functions.includes(ctx.fn)) {
    return deny(`function ${ctx.fn}() not in [${rule.functions.join(', ')}]`);
  }

  // 5. Argument predicates.
  for (const c of rule.args ?? []) {
    if (!argSatisfies(c.pred, ctx.args?.[c.index], account)) {
      return deny(`arg[${c.index}] fails ${c.pred.type}`);
    }
  }

  // 6. Signer sufficiency: perch injects MinSigners(n) = every referenced signer
  //    (N-of-N), the on-chain floor when a policy is attached.
  if (rule.principals.type === 'all') {
    const missing = rule.principals.signers.filter((id) => !authenticated.has(id));
    if (missing.length) return deny(`missing signature from [${missing.join(', ')}]`);
  }

  // 7. Cumulative cap is a stateful sibling policy — not evaluable from a single
  //    call. Surface it rather than silently ignore.
  if (rule.cap) {
    reasons.push(`cap ≤ ${rule.cap.limit} / ${rule.cap['period-ledgers']} ledgers applies (stateful; not checked per-call)`);
  }

  reasons.push('authorized');
  return { verdict: 'allow', ...base };
}
