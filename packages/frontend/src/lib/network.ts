import { Asset, Networks } from "@stellar/stellar-sdk";

/** Single source of truth for the network this build targets (currently testnet). */
export const NETWORK_NAME = "testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";

/** Stellar Expert human-explorer base (used to link each row to its tx). */
export const EXPLORER_BASE = `https://stellar.expert/explorer/${NETWORK_NAME}`;

/** Native-XLM Stellar Asset Contract id for this network. */
export const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);

/** OZ Relayer (Channels) endpoint. Empty string = relayer disabled; the wallet
 *  falls back to ephemeral-G self-submission. Set PUBLIC_RELAYER_URL at build
 *  time once the Fly app is live (e.g. https://nido-relayer.fly.dev). */
export const RELAYER_URL: string = import.meta.env.PUBLIC_RELAYER_URL ?? "";

/** Funded G-address used as the *simulation-only* tx source in relayer mode
 *  (the relayer's fund account — guaranteed on-chain). Never signs, never pays.
 *  Required because recording-mode simulateTransaction needs an existing
 *  source account, and in relayer mode we no longer friendbot-fund one. */
export const RELAYER_SIM_SOURCE: string = import.meta.env.PUBLIC_RELAYER_SIM_SOURCE ?? "";
