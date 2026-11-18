import { setStorageNetwork } from "@nidohq/passkey-sdk/storage";

/** The network this build targets, from `PUBLIC_STELLAR_NETWORK` at build
 *  time: `mainnet` or `testnet` (any case, surrounding whitespace ignored).
 *  There is no default: unset or any other value throws, which fails the
 *  build. `network.ts` re-exports it with the rest of the chain config.
 *
 *  Importing this module also points the wallet's storage namespace
 *  (`nido:<network>:*`, passkey-sdk `nidoKey`) at this network. It imports
 *  only the SDK's storage module, so a page as small as the storage bridge
 *  can load it without the SDK's main chunk. NidoLayout imports it from the
 *  first script in `<head>` (StorageNetwork.astro), so every script on a
 *  layout page runs after it; a page without the layout (the storage bridge)
 *  imports it itself. `nidoKey` throws on a page that does neither. */
const rawNetwork: string | undefined = import.meta.env.PUBLIC_STELLAR_NETWORK;
const network = (rawNetwork ?? "").trim().toLowerCase();
if (network !== "mainnet" && network !== "testnet") {
  throw new Error(
    `PUBLIC_STELLAR_NETWORK must be "mainnet" or "testnet", got ${rawNetwork === undefined ? "nothing" : JSON.stringify(rawNetwork)}`,
  );
}
export const NETWORK_NAME: "testnet" | "mainnet" = network;

setStorageNetwork(NETWORK_NAME);
