export type StellarNetwork = "testnet" | "mainnet";

export interface RelayerKey {
  name: string;
  address: string;
  network: StellarNetwork;
}

/** The relayer's Turnkey-backed signers (infra/relayer/config/config.json's
 *  `private_key_id` fields), hardcoded here since this is a read-only demo page, not
 *  something that needs to track the relayer's config at runtime.
 *
 *  Mainnet Turnkey wallet accounts don't exist yet (docs/MAINNET_READINESS.md's A1/A3
 *  are unchecked) — every `mainnet` entry below is the literal string
 *  "<PLACEHOLDER>" rather than a fake-but-valid address, specifically so it's
 *  impossible to mistake for real and trivial to grep for
 *  (`grep -rn '<PLACEHOLDER>'`). fetchXlmBalance will fail for these (caught,
 *  shown as "error fetching balance") until each is replaced with the real
 *  address Turnkey hands back for that wallet account. Add a `manager` row
 *  here too once infra/relayer/plugins/manager's signer exists for real. */
export const RELAYER_KEYS: RelayerKey[] = [
  { name: "Fund", address: "GCYVFKNTVZA5AY3KJWPW4NU4247UDDFFOCT4C3WCOKUDQQABIZRZ46I3", network: "testnet" },
  { name: "Channels Fee Payer", address: "GDF5IIBWEZIEBA43XAZSOM5A3X6KKZ7CCYX5K7SCO4M4DJGOPEPK7UOL", network: "testnet" },
  { name: "Channel 001", address: "GAPGVNKNFHOCER46FQ4WHMWXWA2DLUYY3HYXTBSIPIMPMRCE7Y6URAGA", network: "testnet" },
  { name: "Channel 002", address: "GBYC4XMYN7WNBWZ363M3MD6BWUGIX633EIOTOOASSZ3IZUGS44HBA7JZ", network: "testnet" },

  { name: "Fund", address: "<PLACEHOLDER>", network: "mainnet" },
  { name: "Channels Fee Payer", address: "<PLACEHOLDER>", network: "mainnet" },
  { name: "Channel 001", address: "<PLACEHOLDER>", network: "mainnet" },
  { name: "Channel 002", address: "<PLACEHOLDER>", network: "mainnet" },
];
