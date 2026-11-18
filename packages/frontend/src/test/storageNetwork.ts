// Unit tests import library modules one at a time, never a page, so nothing
// sets the wallet's storage network for them (a page does it by importing
// lib/networkName.ts, and passkey-sdk `nidoKey` throws until something does).
// Set it here the way a page does: from PUBLIC_STELLAR_NETWORK, which
// vitest.config.ts sets to testnet.
import "../lib/networkName";
