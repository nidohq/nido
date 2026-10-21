/**
 * The onboarding page's reads of a new account, against this build's Perch
 * deployment and the public RPC (never the relayer that submitted the setup).
 * `perch.verifyNewAccount` (passkey-sdk `perch/newAccount.ts`) says what an
 * acceptable account is.
 */

import { perch } from "@nidohq/passkey-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "../network";
import { perchDeployment } from "../recovery/deployment.js";

const chain = { rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE };

/** Whether any contract is deployed at `account`. */
export async function accountDeployed(account: string): Promise<boolean> {
  return (await perch.readAccountCode({ ...chain, account })) !== null;
}

/** Resolve only if `account` is exactly the account `create_account` makes
 *  for `adminKey` on this build's deployment; otherwise reject, with
 *  `perch.NewAccountRefused` for an account that is not it. A build without
 *  a deployment has nothing to check against, so it refuses. */
export async function verifyNewNidoAccount(
  account: string,
  adminKey: Uint8Array,
  options?: perch.VerifyNewAccountOptions,
): Promise<void> {
  const deployment = perchDeployment();
  if (!deployment) throw new Error("This build has no Perch deployment, so it cannot check a new account.");
  await perch.verifyNewAccount(chain, { account, adminKey, deployment }, options);
}
