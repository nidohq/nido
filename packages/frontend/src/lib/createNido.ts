import { Keypair, Networks } from "@stellar/stellar-sdk";
import { Client } from "factory";
import { savePendingAccount, accountUrl, fetchRegistryAddress } from "@g2c/passkey-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";

/**
 * Reserve a new Nido: fund a fresh keypair via friendbot, derive its C-address
 * from the factory, persist it as pending, and return the URL of the
 * "Lock it to you" passkey step. The caller navigates to the returned URL.
 * Throws on funding / factory / registry failure.
 */
export async function createNido(host: string): Promise<string> {
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();
  const secret = keypair.secret();

  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) throw new Error(`Funding failed: ${res.status}`);

  const client = new Client({
    contractId: await fetchRegistryAddress("factory"),
    networkPassphrase: Networks.TESTNET,
    rpcUrl: RPC_URL,
    publicKey,
  });

  const tx = await client.get_c_address({ funder: publicKey });
  const cAddress = tx.result;

  savePendingAccount(cAddress, secret);

  return accountUrl(host, cAddress, `/new-account/?key=${secret}`);
}
