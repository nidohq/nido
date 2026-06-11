import type { ChainRule } from '@g2c/passkey-sdk';
import { fetchAllChainRules } from './policyChainFetch.js';

export function defaultRuleSinglePasskeyBlockReason(
  rule: Pick<ChainRule, 'signers' | 'policies'> | null | undefined,
): string | null {
  if (!rule || rule.signers.length <= 1 || rule.policies.length > 0) return null;
  return (
    `This account has ${rule.signers.length} passkeys on its default rule but no ` +
    'threshold policy. Single-passkey signing cannot authorize it because the ' +
    'account requires every default-rule passkey in one ceremony. Use recovery ' +
    'repair to install a 1-of-N threshold policy, then try again.'
  );
}

export async function assertDefaultRuleSinglePasskeySignable(account: string): Promise<void> {
  let defaultRule: ChainRule | undefined;
  try {
    defaultRule = (await fetchAllChainRules(account)).find((rule) => rule.ruleId === 0);
  } catch {
    return;
  }
  const reason = defaultRuleSinglePasskeyBlockReason(defaultRule);
  if (reason) throw new Error(reason);
}
