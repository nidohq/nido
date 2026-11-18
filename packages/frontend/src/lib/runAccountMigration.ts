import { migrateAccountList, type AccountMigrationResult } from "./accountMigration";
import { NETWORK_NAME } from "./network";
import { accountDeployed } from "./newAccount/verifyNewAccount";
import { apexHostForHost, probeAccountOwnership } from "./nidoSharedStorage";

let running: Promise<AccountMigrationResult> | null = null;

/**
 * Run the sign-in list's one-time migration (accountMigration.ts) on the apex,
 * once per page load. Elsewhere there is no sign-in list to migrate.
 */
export function runAccountMigration(): Promise<AccountMigrationResult> {
  if (apexHostForHost(window.location.host) !== window.location.host) {
    return Promise.resolve({ ran: false, kept: [], dropped: [], undecided: [] });
  }
  running ??= migrateAccountList({
    network: NETWORK_NAME,
    store: localStorage,
    hasPasskey: (contractId) => probeAccountOwnership(contractId),
    deployedHere: accountDeployed,
  });
  return running;
}
