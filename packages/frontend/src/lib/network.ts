import { Asset, Networks } from "@stellar/stellar-sdk";

/** Single source of truth for the network this build targets (currently testnet). */
export const NETWORK_NAME = "testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Soroban RPC endpoint. Defaults to testnet clearnet; override with
 *  PUBLIC_RPC_URL at build time. On the onion deployment this points at the
 *  same-onion-service backhaul vhost (https://rpc.<addr>.onion) so the browser
 *  never makes a cross-origin RPC call over a Tor exit — those hit Cloudflare
 *  in front of soroban-testnet and get a cached `Access-Control-Allow-Origin:
 *  null`, breaking CORS. Caddy backhauls to soroban-testnet server-side. */
export const RPC_URL: string =
  import.meta.env.PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";

/** Stellar Expert human-explorer base (used to link each row to its tx). */
export const EXPLORER_BASE = `https://stellar.expert/explorer/${NETWORK_NAME}`;

/** Native-XLM Stellar Asset Contract id for this network. */
export const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);

/** OZ Relayer (Channels) endpoint. Empty string = relayer disabled; the wallet
 *  falls back to ephemeral-G self-submission. Set PUBLIC_RELAYER_URL at build
 *  time once the Fly app is live (e.g. https://nido.fly.dev).
 *  Trailing slashes are stripped so `${RELAYER_URL}/relay` never yields
 *  "//relay" (which Caddy's path matcher won't route). */
export const RELAYER_URL: string = (import.meta.env.PUBLIC_RELAYER_URL ?? "").replace(/\/+$/, "");

/** Funded G-address used as the *simulation-only* tx source in relayer mode
 *  (the relayer's fund account — guaranteed on-chain). Never signs, never pays.
 *  Required because recording-mode simulateTransaction needs an existing
 *  source account, and in relayer mode we no longer friendbot-fund one. */
export const RELAYER_SIM_SOURCE: string = import.meta.env.PUBLIC_RELAYER_SIM_SOURCE ?? "";

/** Signature validity in relayer mode: ~10 minutes (120 ledgers ≈ 600s). The
 *  sdk default (10000 ledgers ≈ 14h) is fine when the signed entry never leaves
 *  the browser, but in relayer mode we hand it to an external service — whoever
 *  holds the body can submit at any moment until expiry. The relayer only needs
 *  it valid for well under a minute (channel tx lifetime is 60s; the plugin's
 *  minimum buffer is 2 ledgers), so keep the window tight.
 *
 *  SECURITY-CRITICAL: MUST be passed IDENTICALLY to buildAuthHash AND the
 *  signature injector(s) (injectPasskeySignature / injectSignedAuthPayload) or
 *  the auth digest won't verify. Shared here so every relayer-submitting signing
 *  path (primaryPasskeySigner, walletSign) uses the same bound. */
export const RELAYER_EXPIRATION_OFFSET = 120;
