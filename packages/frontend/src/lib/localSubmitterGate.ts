/**
 * Local-submitter mode: the wallet never calls a relayer. A G keypair kept in
 * this origin's localStorage, funded by testnet friendbot, is the source and
 * fee payer of every transaction (simulate, sign, submit straight to RPC), and
 * a new account is funded by friendbot instead of the relayer's treasury.
 *
 * It exists for one PR preview that runs a separate testnet deployment the
 * shared relayer does not serve. It is on only when the build sets
 * PUBLIC_NIDO_LOCAL_SUBMITTER=1 (only that preview's workflow does) AND the
 * build targets testnet: friendbot has no mainnet equivalent, and a mainnet
 * build with the flag set stays in relayer mode.
 */
export function localSubmitterEnabled(flag: string | undefined, network: "testnet" | "mainnet"): boolean {
  return flag === "1" && network === "testnet";
}
