import { rpc } from '@stellar/stellar-sdk';
import {
  scopedSessionKeyModule, forgetSessionKeyMaterial,
} from '@g2c/passkey-sdk';
import { fetchVerifierAddress } from './policyChainFetch.js';
import { signAndSubmit } from './primaryPasskeySigner.js';

const RPC_URL = 'https://soroban-testnet.stellar.org';

export async function delegateSessionKey(args: {
  account: string;
  target: string;
  sessionPubkey: Uint8Array;
  /** Number of ledgers from current ledger; null = no expiry. */
  validUntilOffset: number | null;
  label?: string;
}): Promise<void> {
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  const validUntil =
    args.validUntilOffset == null
      ? undefined
      : latest.sequence + args.validUntilOffset;

  const built = await scopedSessionKeyModule.buildInstall({
    account: args.account,
    block: {
      kind: 'scoped-session-key',
      targetContract: args.target,
      sessionPubkey: args.sessionPubkey,
      credentialId: '',
      validUntil,
      label: args.label,
    },
    factoryAddress: '',
    rpcUrl: RPC_URL,
    verifierAddress: () => fetchVerifierAddress(args.account),
  });

  const verifierAddr = await fetchVerifierAddress(args.account);
  await signAndSubmit({
    account: args.account,
    operation: built.operations[0],
    verifierAddress: verifierAddr,
  });
}

export async function revokeSessionKey(
  account: string,
  ruleId: number,
  target: string,
): Promise<void> {
  const built = await scopedSessionKeyModule.buildRevoke({
    account,
    ruleId,
    rpcUrl: RPC_URL,
  });
  const verifierAddr = await fetchVerifierAddress(account);
  await signAndSubmit({
    account,
    operation: built.operations[0],
    verifierAddress: verifierAddr,
  });
  forgetSessionKeyMaterial(account, target);
}
