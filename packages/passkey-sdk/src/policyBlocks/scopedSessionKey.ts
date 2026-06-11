import { Buffer } from 'buffer';
import { Client as SmartAccountClient } from 'smart-account';
import { extractXdrOperations } from '../assembledTx.js';
import type {
  ChainRule, LocalOverlay, PolicyBlockModule, PolicyState,
  ScopedSessionKeyBlock, TxBuild,
} from './types.js';
import { registerPolicyBlockModule } from './registry.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export const scopedSessionKeyModule: PolicyBlockModule<ScopedSessionKeyBlock> = {
  kind: 'scoped-session-key',

  async buildInstall(args): Promise<TxBuild> {
    if (!args.verifierAddress) {
      throw new Error('scoped-session-key: verifierAddress fetcher required');
    }
    const verifierAddr = await args.verifierAddress();

    const client = new SmartAccountClient({
      contractId: args.account,
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: args.rpcUrl,
    });

    const tx = await client.add_context_rule({
      context_type: { tag: 'CallContract', values: [args.block.targetContract] as readonly [string] },
      name: args.block.label ?? 'session',
      valid_until: args.block.validUntil,
      signers: [{
        tag: 'External' as const,
        values: [verifierAddr, Buffer.from(args.block.sessionPubkey)] as readonly [string, Buffer],
      }],
      policies: new Map(),
    });

    return {
      operations: extractXdrOperations(tx, 'scoped-session-key'),
      description: `Delegate session key to ${args.block.targetContract}`,
    };
  },

  async buildRevoke(args): Promise<TxBuild> {
    const client = new SmartAccountClient({
      contractId: args.account,
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: args.rpcUrl,
    });
    const tx = await client.remove_context_rule({ context_rule_id: args.ruleId });
    return {
      operations: extractXdrOperations(tx, 'scoped-session-key'),
      description: 'Revoke session key',
    };
  },

  fromChain(rule: ChainRule, state: PolicyState, overlay: LocalOverlay): ScopedSessionKeyBlock | null {
    if (rule.contextType.kind !== 'call-contract') return null;
    if (rule.signers.length !== 1) return null;
    const s = rule.signers[0];
    if (s.kind !== 'external') return null;

    // A bare session key has no policies. One with a spending limit carries
    // exactly the spending-limit policy, whose fetched params arrive through
    // the PolicyState the loader provides (same wiring as the multisig
    // threshold: frontend fetch → state[policyAddr] → fromChain). A rule whose
    // single policy answers get_threshold is a multisig-style rule — not ours.
    // But a single-policy rule whose state is UNREADABLE (registry blip,
    // archived params entry, registry repoint orphaning the old policy
    // address) must still be claimed: this CallContract + one-external-signer
    // shape is a session key, and dropping it would drop the only Revoke path.
    let limit: { stroops: bigint; periodLedgers: number } | undefined;
    let limitUnreadable = false;
    if (rule.policies.length === 1) {
      const ps = state[rule.policies[0]] as
        | {
            spendingLimit?: { stroops: bigint; periodLedgers: number } | 'unreadable';
            threshold?: number;
          }
        | undefined;
      if (ps?.threshold !== undefined) return null;
      if (ps?.spendingLimit != null && ps.spendingLimit !== 'unreadable') {
        limit = ps.spendingLimit;
      } else {
        limitUnreadable = true;
      }
    } else if (rule.policies.length > 0) {
      return null;
    }

    const target = rule.contextType.contract;
    const material = overlay.sessionKeyMaterial[target];

    return {
      kind: 'scoped-session-key',
      ruleId: rule.ruleId,
      targetContract: target,
      sessionPubkey: s.publicKey,
      credentialId: material?.credentialId ?? 'unknown',
      validUntil: rule.validUntil ?? undefined,
      label: material?.label ?? overlay.blockLabels[rule.ruleId],
      ...(limit !== undefined
        ? { limitStroops: limit.stroops, limitPeriodLedgers: limit.periodLedgers }
        : {}),
      ...(limitUnreadable ? { limitUnreadable: true } : {}),
    };
  },

  summarize(block: ScopedSessionKeyBlock): string {
    const exp = block.validUntil != null ? ` (expires at ledger ${block.validUntil})` : '';
    const limit =
      block.limitStroops != null && block.limitPeriodLedgers != null
        ? ` · limit ${formatSpendingLimit(block.limitStroops, block.limitPeriodLedgers)}`
        : '';
    return `Session key for ${block.targetContract}${exp}${limit}`;
  },

  defaultDraft(): ScopedSessionKeyBlock {
    return {
      kind: 'scoped-session-key',
      targetContract: '',
      sessionPubkey: new Uint8Array(65),
      credentialId: '',
    };
  },
};

registerPolicyBlockModule(scopedSessionKeyModule);

// --- Spending-limit display helpers ----------------------------------------

const STROOPS_PER_XLM = 10_000_000n;

/** Known rolling-window lengths (in ~5s ledgers) → human period labels.
 *  Mirrors the delegate page's duration choices. */
const PERIOD_LABELS: Record<number, string> = {
  17280: 'per day',
  120960: 'per week',
  518400: 'per 30 days',
};

/** Format a spending limit as `"5 XLM per day"`. Exported so UI cards can
 *  render the limit line with exactly the same text `summarize()` uses. */
export function formatSpendingLimit(stroops: bigint, periodLedgers: number): string {
  const period = PERIOD_LABELS[periodLedgers] ?? `per ${periodLedgers} ledgers`;
  return `${stroopsToXlmString(stroops)} XLM ${period}`;
}

/** Integer-only stroops → decimal XLM string (no floats, trailing zeros
 *  trimmed): 50000000n → "5", 25000000n → "2.5". */
function stroopsToXlmString(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = abs % STROOPS_PER_XLM;
  const sign = negative ? '-' : '';
  if (frac === 0n) return `${sign}${whole}`;
  const fracStr = frac.toString().padStart(7, '0').replace(/0+$/, '');
  return `${sign}${whole}.${fracStr}`;
}
