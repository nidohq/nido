/**
 * Setup-link account/salt consistency guard.
 *
 * SECURITY: a Nido account's address is derived
 * deterministically from the factory + the setup salt (`get_c_address(salt)`),
 * independent of the passkey. The /new-account/ page, however, funds, activates
 * and displays the account named by the page HOSTNAME (`contractIdFromHostname`).
 * If a setup link pairs one account's hostname with a different account's salt,
 * the factory deploys the salt-derived account (controlled by the user's fresh
 * passkey) while the page funds and shows the hostname account — which an
 * attacker can own. The user's deposits then flow to the attacker even though
 * setup reports success.
 *
 * Require an exact match between the salt-derived address and the validated
 * hostname account id BEFORE creating a passkey, persisting credentials, or
 * funding. This helper is the pure decision; the page supplies the derived
 * address from an on-chain `get_c_address(salt)` call.
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
