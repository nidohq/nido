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
 *  are unchecked) — the four `mainnet` entries are freshly-generated, never-funded
 *  placeholder keypairs, not real relayer addresses. Swap them for the real ones once
 *  mainnet signers are provisioned. */
export const RELAYER_KEYS: RelayerKey[] = [
  { name: "Fund", address: "GCYVFKNTVZA5AY3KJWPW4NU4247UDDFFOCT4C3WCOKUDQQABIZRZ46I3", network: "testnet" },
  { name: "Channels Fee Payer", address: "GDF5IIBWEZIEBA43XAZSOM5A3X6KKZ7CCYX5K7SCO4M4DJGOPEPK7UOL", network: "testnet" },
  { name: "Channel 001", address: "GAPGVNKNFHOCER46FQ4WHMWXWA2DLUYY3HYXTBSIPIMPMRCE7Y6URAGA", network: "testnet" },
  { name: "Channel 002", address: "GBYC4XMYN7WNBWZ363M3MD6BWUGIX633EIOTOOASSZ3IZUGS44HBA7JZ", network: "testnet" },

  { name: "Fund", address: "GAXGOAWR4LGZB5DQUBCROPBIIUOTONPDN2SRGRRUQOVCDUDGS72CY3BW", network: "mainnet" },
  { name: "Channels Fee Payer", address: "GDXSTU37RXALGABAZXDVYZM2UTVGU3WO4NEMLZ3EVKSO7P33VOOHUPCY", network: "mainnet" },
  { name: "Channel 001", address: "GBVLIG7UIRARMVSWQQGYWIRWORALPXC3RONKPPW5B77WESDY5C5YOTZR", network: "mainnet" },
  { name: "Channel 002", address: "GBCAGM44FXDBTZE5BFR7DRNKVYFOB4TC5JRNK2BDQNDS67UNYPWP6IJP", network: "mainnet" },
];
