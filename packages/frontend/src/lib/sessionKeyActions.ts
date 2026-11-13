import { rpc } from '@stellar/stellar-sdk';
import { scopedSessionKeyModule } from '@nidohq/passkey-sdk';
import { fetchVerifierAddress } from './policyChainFetch.js';
import { signAndSubmit } from './primaryPasskeySigner.js';
import { latestLedgerSequence, RPC_URL } from './network.js';

export async function delegateSessionKey(args: {
  account: string;
  target: string;
  sessionPubkey: Uint8Array;
  /** Number of ledgers from current ledger; null = no expiry. */
  validUntilOffset: number | null;
  label?: string;
}): Promise<void> {
  const latest = await latestLedgerSequence(new rpc.Server(RPC_URL));
  const validUntil =
    args.validUntilOffset == null
      ? undefined
      : latest + args.validUntilOffset;

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
