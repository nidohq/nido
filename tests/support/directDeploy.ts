import type { Page } from '@playwright/test';
import { Contract, Keypair, Networks, rpc, scValToNative, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
// The module, not the SDK barrel: the barrel doesn't load in Node (see
// session-key.testnet.spec.ts), and this keeps `TESTNET` the one source of
// the factory address.
import { TESTNET } from '../../packages/passkey-sdk/src/perch/deployment';
import { credentialFor, seedCredential } from './auth/seed';
import { SEED_HEX } from './fixtures';
import { FRIENDBOT_URL, RPC_URL } from './testnet';

/** Fund a fresh testnet G-address through Friendbot. */
async function friendbot(address: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}: ${await res.text()}`);
}

/**
 * A fresh Nido whose admin passkey is the test authenticator's `label`
 * identity, created without the hosted relayer: a Friendbot-funded keypair
 * pays for the release factory's `create_account(salt, key)` (permissionless,
 * so nothing else signs), and the passkey is seeded into the account's own
 * origin as onboarding would leave it. Everything after this runs through the
 * wallet unchanged: the deployed contracts, real passkey assertions under the
 * account's own `__check_auth`, and real in-page proofs.
 *
 * Use it when the relayer that sponsors onboarding is unavailable
 * (`NIDO_E2E_DIRECT_DEPLOY=1`); `createAndDeployAs` drives the onboarding UI
 * through the relayer instead. Build the wallet without `PUBLIC_RELAYER_URL`
 * so its signing paths pay with their own Friendbot-funded submitter too.
 */
export async function deployAccountDirect(
  page: Page,
  port: number,
  label: string,
): Promise<{ cAddress: string; host: string }> {
  const { publicKeyHex } = await credentialFor(SEED_HEX, label);
  const server = new rpc.Server(RPC_URL);
  const payer = Keypair.random();
  await friendbot(payer.publicKey());

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const tx = new TransactionBuilder(await server.getAccount(payer.publicKey()), {
    fee: '1000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(TESTNET.factory).call(
        'create_account',
        xdr.ScVal.scvBytes(Buffer.from(salt)),
        xdr.ScVal.scvBytes(Buffer.from(publicKeyHex, 'hex')),
      ),
    )
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(payer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`create_account rejected: ${sent.errorResult?.toXDR('base64')}`);
  const done = await server.pollTransaction(sent.hash, { attempts: 60 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`create_account ${done.status}: ${sent.hash}`);
  }
  const cAddress = scValToNative(done.returnValue!) as string;

  const host = `${cAddress.toLowerCase()}.localhost:${port}`;
  await page.goto(`http://${host}/account/`, { waitUntil: 'domcontentloaded' });
  await seedCredential(page, cAddress, SEED_HEX, label);
  await page.evaluate((account) => {
    const list: string[] = JSON.parse(localStorage.getItem('nido:accounts') || '[]');
    if (!list.includes(account)) localStorage.setItem('nido:accounts', JSON.stringify([...list, account]));
  }, cAddress);
  return { cAddress, host };
}
