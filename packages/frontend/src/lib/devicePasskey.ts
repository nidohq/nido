/** What every signer says when this device has no record of the account's
 *  passkey (`loadCredential` is empty). A synced passkey is usually the fix,
 *  so it names that before recovery. */
export const NO_DEVICE_PASSKEY =
  'No passkey for this Nido on this device. New device? Use your synced passkey from Security. Lost it? Recover from there.';
