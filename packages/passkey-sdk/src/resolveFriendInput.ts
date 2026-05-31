import { StrKey } from '@stellar/stellar-sdk';

export type ResolvedFriend =
  | { kind: 'name'; address: string; input: string }
  | { kind: 'contract'; address: string; input: string }
  | { kind: 'account'; address: string; input: string };

export interface ResolveFriendOptions {
  /** Inject the name-registry lookup so tests can mock it. */
  resolveName: (name: string) => Promise<string | null>;
}

const G2C_NAME_RE = /^[a-z][a-z0-9]{0,14}$/;

export async function resolveFriendInput(
  input: string,
  opts: ResolveFriendOptions,
): Promise<ResolvedFriend | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (StrKey.isValidContract(trimmed)) {
    return { kind: 'contract', address: trimmed, input: trimmed };
  }
  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    return { kind: 'account', address: trimmed, input: trimmed };
  }
  if (G2C_NAME_RE.test(trimmed)) {
    const resolved = await opts.resolveName(trimmed);
    if (!resolved) return null;
    return { kind: 'name', address: resolved, input: trimmed };
  }
  return null;
}
