import type { MultisigRecoveryBlock } from '@g2c/passkey-sdk';
import { multisigRecoveryModule, saveFriendNickname } from '@g2c/passkey-sdk';
import { fetchRegistryAddress, fetchVerifierAddress } from './policyChainFetch.js';
import { signAndSubmit } from './primaryPasskeySigner.js';

const RPC_URL = 'https://soroban-testnet.stellar.org';

export async function installRecovery(
  account: string,
  block: MultisigRecoveryBlock,
): Promise<void> {
  const built = await multisigRecoveryModule.buildInstall({
    account,
    block,
    factoryAddress: '', // unused in architecture C
    rpcUrl: RPC_URL,
    policyAddress: (name) =>
      fetchRegistryAddress(name === 'multisig' ? 'multisig-policy' : name),
    verifierAddress: () => fetchVerifierAddress(account),
  });

  const verifierAddr = await fetchVerifierAddress(account);
  await signAndSubmit({
    account,
    operation: built.operations[0],
    verifierAddress: verifierAddr,
  });

  // Persist overlay metadata only after successful submission.
  for (const f of block.friends) {
    if (f.nickname) saveFriendNickname(account, f.address, f.nickname);
  }
}
