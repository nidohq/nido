import {
  StrKey,
  xdr,
  hash,
  Address,
  rpc,
} from "@stellar/stellar-sdk";
import type { NetworkConfig } from "./types.js";

/**
 * Compute a deterministic contract salt from a credential ID.
 * Returns SHA-256 hash of the credential ID bytes as a Buffer.
 */
export function getContractSalt(credentialId: Uint8Array): Buffer {
  return hash(Buffer.from(credentialId));
}

/**
 * Compute the deterministic smart account address that the factory will deploy to.
 *
 * @param factoryContractId - The factory contract address
 * @param salt - The contract salt (SHA-256 of credential ID)
 * @param networkPassphrase - Stellar network passphrase
 */
export function computeAccountAddress(
  factoryContractId: string,
  salt: Buffer,
  networkPassphrase: string
): string {
  return StrKey.encodeContract(
    hash(
      xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
          networkId: hash(Buffer.from(networkPassphrase, "utf-8")),
          contractIdPreimage:
            xdr.ContractIdPreimage.contractIdPreimageFromAddress(
              new xdr.ContractIdPreimageFromAddress({
                address: Address.fromString(factoryContractId).toScAddress(),
                salt,
              })
            ),
        })
      ).toXDR()
    )
  );
}

/**
 * Check if a smart account has already been deployed at the expected address.
 *
 * @param config - Network configuration
 * @param salt - The contract salt
 * @returns The contract address if it exists, or null
 */
export async function lookupExistingAccount(
  config: NetworkConfig,
  salt: Buffer
): Promise<string | null> {
  const server = new rpc.Server(config.rpcUrl);
  const address = computeAccountAddress(
    config.factoryContractId,
    salt,
    config.networkPassphrase
  );

  try {
    await server.getContractData(
      address,
      xdr.ScVal.scvLedgerKeyContractInstance()
    );
    return address;
  } catch {
    return null;
  }
}

// NOTE: a `deploySmartAccount` helper was removed here. It
// invoked a non-existent factory function (`deploy`; the factory exposes only
// `create_account`/`get_c_address`), derived the salt from the credential id
// after the passkey existed (contradicting the address-first model), polled
// `getTransaction` without a bound, and returned the locally predicted address
// without reading the deployed account (the unverified-adoption hazard the
// account-creation flow guards against). The wallet creates accounts through
// `create_account` with the on-chain checks in `packages/frontend`; a
// supported SDK deploy helper should be built around those, not reintroduced
// as a predicted-address shortcut.
