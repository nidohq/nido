/**
 * Entry point for the Nido funder relayer plugin. Funds newly-deployed
 * smart account's with a spendable balance of TOPUP_STROOPS
 * from the `fund` treasury relayer.
 *
 * The caller may only choose *which* address gets funded, never *how much*:
 * the amount is fixed server-side (FUNDER_TOPUP_STROOPS), not read from the
 * request.
 */
import type { PluginContext } from "@openzeppelin/relayer-sdk";

const FUND_RELAYER_ID = "fund";
const TOPUP_STROOPS = Number(process.env.FUNDER_TOPUP_STROOPS ?? "50000000");
// Same STELLAR_NETWORK the relayer itself is configured with (fly.toml) —
// plugins inherit the relayer's full environment, so this stays in sync
// automatically rather than needing its own separate mainnet/testnet flag.
const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";

// XLM's SAC id
const NATIVE_SAC_ID: Record<string, string> = {
  testnet: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  mainnet: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
};

type Params = {
  destination: string;
};

/**
 * Wrapped plugin handler exported for OpenZeppelin Relayer.
 */
export async function handler({ api, params }: PluginContext<Params>): Promise<unknown> {
  // Kill switch for turning this off after Meridian without touching Caddy
  // or config.json (neither takes live effect post-bootstrap anyway — see
  // "Changing Relayers/Signers After Initial Bootstrap" in README.md, which
  // applies equally to plugins). Flip FUNDER_ENABLED=false and redeploy.
  if (process.env.FUNDER_ENABLED === "false") {
    throw new Error("funder plugin is disabled (FUNDER_ENABLED=false)");
  }

  const { destination } = params;

  // Validate shape only — a real C-address, nothing else. Reject anything
  // that isn't exactly this; never trust an amount field even if present.
  if (typeof destination !== "string" || !/^C[A-Z2-7]{55}$/.test(destination)) {
    throw new Error("Invalid destination: must be a Stellar contract address");
  }

  const relayer = api.useRelayer(FUND_RELAYER_ID);

  const sacId = NATIVE_SAC_ID[STELLAR_NETWORK];
  if (!sacId) {
    throw new Error(`No native SAC id configured for network: ${STELLAR_NETWORK}`);
  }

  // `from` is fund's own address, fetched live rather than hardcoded so a
  // future Turnkey key rotation for `fund` doesn't silently break this.
  // TODO: confirm the exact field name/shape on ApiResponseRelayerResponseData
  // against a live call -- assumed `.address` to mirror RelayerRepoModel's
  // own field name, not yet verified against this SDK type specifically.
  const relayerInfo = await relayer.getRelayer();
  const fundAddress = (relayerInfo as { address: string }).address;

  const result = await relayer.sendTransaction({
    network: STELLAR_NETWORK,
    operations: [
      {
        type: "invoke_contract",
        contract_address: sacId,
        function_name: "transfer",
        args: [
          { address: fundAddress },
          { address: destination },
          { i128: { hi: "0", lo: String(TOPUP_STROOPS) } },
        ],
        // fund is both the transaction's source account and the `from` in
        // transfer, so the tx's own signature authorizes it -- no separate
        // signed SorobanAuthorizationEntry needed.
        auth: { type: "source_account" },
      },
    ],
  });

  // Return immediately; the caller polls for confirmation the same way the
  // existing deploy flow already does (relayerClient.waitForConfirmation).
  return { id: result.id, relayer_id: result.relayer_id, status: result.status };
}
