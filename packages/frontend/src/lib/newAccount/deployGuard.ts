import type { perch } from '@nidohq/passkey-sdk';

/**
 * Setup-link account/setup-key consistency guard.
 *
 * SECURITY: a Nido account's address is derived deterministically from the
 * factory + the setup public key (`get_c_address(setup_pk)`), independent of
 * the passkey. The /new-account/ page, however, funds, activates and displays
 * the account named by the page HOSTNAME (`contractIdFromHostname`). If a
 * setup link pairs one account's hostname with a different account's setup
 * secret, the factory deploys the setup-key-derived account (controlled by
 * the user's fresh passkey) while the page funds and shows the hostname
 * account — which an attacker can own. The user's deposits then flow to the
 * attacker even though setup reports success.
 *
 * Require an exact match between the setup-key-derived address and the
 * validated hostname account id BEFORE creating a passkey, persisting
 * credentials, or funding. This helper is the pure decision; the page supplies
 * the derived address from an on-chain `get_c_address(setup_pk)` call.
 */

/** Returns a user-facing error string when setup must be refused, or null when
 *  the derived address matches the hostname account and setup may proceed. */
export function setupAddressMismatch(
  derivedAddress: string | null | undefined,
  hostnameContractId: string | null | undefined,
): string | null {
  if (!hostnameContractId) {
    return 'This setup link has no account. Please start again from the home page.';
  }
  if (!derivedAddress) {
    return 'Could not confirm this account address. Please start again from the home page.';
  }
  if (derivedAddress !== hostnameContractId) {
    return (
      'This setup link is inconsistent: its account address does not match its ' +
      'setup key. For your safety, setup was stopped. Please start again from ' +
      'the home page.'
    );
  }
  return null;
}

/** Why setup stopped after reading the new account back, for the user, and
 *  whether trying again can help. Only an account that has not shown up yet
 *  is worth retrying; any other mismatch means the address is not the user's
 *  and never will be. */
export function newAccountRefusal(problem: perch.NewAccountProblem): { message: string; retry: boolean } {
  switch (problem) {
    case 'missing':
      return {
        message:
          "We couldn't find your new account on the network, so setup stopped before using it. Please try again.",
        retry: true,
      };
    case 'key':
      return {
        message:
          'This address is controlled by a passkey this setup did not create, so it is not yours to use. ' +
          'Nothing was moved into it. Please start again from the home page to get a new address.',
        retry: false,
      };
    default:
      return {
        message:
          'The account at this address is not the one this setup creates, so it is not safe to use. ' +
          'Nothing was moved into it. Please start again from the home page to get a new address.',
        retry: false,
      };
  }
}
