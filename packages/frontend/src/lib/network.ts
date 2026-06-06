import { Asset, Networks } from "@stellar/stellar-sdk";

/** Single source of truth for the network this build targets (currently testnet). */
export const NETWORK_NAME = "testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";

/** Stellar Expert JSON API + human explorer base, network-scoped. */
export const EXPERT_API_BASE = `https://api.stellar.expert/explorer/${NETWORK_NAME}`;
export const EXPLORER_BASE = `https://stellar.expert/explorer/${NETWORK_NAME}`;

/** Native-XLM Stellar Asset Contract id for this network. */
export const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);
