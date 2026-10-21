/**
 * Entry point for the Nido funder relayer plugin. Funds newly-deployed
 * smart accounts with a spendable balance of TOPUP_STROOPS from the `fund`
 * treasury relayer.
 *
 * The caller may only choose *which* address gets funded, never *how much*:
 * the amount is fixed server-side (FUNDER_TOPUP_STROOPS), not read from the
 * request.
 *
 * Sequence-number workaround: OZ Relayer's own sequence-assignment path
 * (`get_next_sequence`) corrupts large Stellar sequence numbers - a confirmed
 * https://github.com/OpenZeppelin/openzeppelin-relayer/pull/789 upstream bug. 
 * Fixed in * openzeppelin-relayer v1.6.0, but that version broke this image's plugin
 * build, so we're * staying on v1.5.0 and routing around the bug instead.
 *
 * The workaround: fetch `fund`'s sequence number ourselves directly from
 * Soroban RPC (never touching the relayer's buggy counter), build+simulate+
 * assemble the transaction ourselves (same as the old Friendbot-funded
 * flow's drainTestnetFunding()), ask the relayer to sign the fully-assembled
 * envelope (a plain "sign this blob with your Turnkey key" call -- confirmed
 * via the relayer's own source that this never touches sequence-assignment
 * code at all), and submit the signed envelope directly to Soroban RPC
 * ourselves. The relayer's own transaction-submission API is never used.
 */
import type { PluginContext } from "@openzeppelin/relayer-sdk";
import {
  Asset,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";

const FUND_RELAYER_ID = "fund";
const TOPUP_STROOPS = Number(process.env.FUNDER_TOPUP_STROOPS ?? "50000000");
const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";

const NETWORK_CONFIG: Record<string, { passphrase: string; rpcUrl: string }> = {
  testnet: { passphrase: Networks.TESTNET, rpcUrl: "https://soroban-testnet.stellar.org" },
  mainnet: { passphrase: Networks.PUBLIC, rpcUrl: "https://mainnet.sorobanrpc.com" },
};

type Params = {
  destination: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const networkConfig = NETWORK_CONFIG[STELLAR_NETWORK];
  if (!networkConfig) {
    throw new Error(`No network config for: ${STELLAR_NETWORK}`);
  }

  const relayer = api.useRelayer(FUND_RELAYER_ID);

  // `from` is fund's own address, fetched live rather than hardcoded so a
  // future Turnkey key rotation for `fund` doesn't silently break this.
  const relayerInfo = await relayer.getRelayer();
  const fundAddress = (relayerInfo as { address: string }).address;

  const sacId = Asset.native().contractId(networkConfig.passphrase);

  const server = new rpc.Server(networkConfig.rpcUrl);
  const sourceAccount = await server.getAccount(fundAddress);

  const txn = new TransactionBuilder(sourceAccount, {
    fee: "1000000",
    networkPassphrase: networkConfig.passphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: sacId,
        function: "transfer",
        args: [
          nativeToScVal(fundAddress, { type: "address" }),
          nativeToScVal(destination, { type: "address" }),
          nativeToScVal(TOPUP_STROOPS, { type: "i128" }),
        ],
      })
    )
    .setTimeout(60)
    .build();

  const SIM_ATTEMPTS = 6;
  let sim = await server.simulateTransaction(txn);
  for (let simAttempt = 1; simAttempt < SIM_ATTEMPTS; simAttempt++) {
    if (!rpc.Api.isSimulationError(sim) && !rpc.Api.isSimulationRestore(sim)) break;
    await sleep(1500);
    sim = await server.simulateTransaction(txn);
  }
  if (rpc.Api.isSimulationError(sim) || rpc.Api.isSimulationRestore(sim)) {
    throw new Error(`Funding simulation failed: ${"error" in sim ? sim.error : "restore needed"}`);
  }

  const assembled = rpc.assembleTransaction(txn, sim).build();

  // Relayer only signs (Turnkey-backed, no sequence-assignment code
  // touched) -- we submit the result ourselves.
  const signResult = await relayer.signTransaction({ unsigned_xdr: assembled.toXDR() });
  const signedXdr = (signResult as { signedXdr: string }).signedXdr;

  const signedEnvelope = TransactionBuilder.fromXDR(signedXdr, networkConfig.passphrase);

  const send = await server.sendTransaction(signedEnvelope);
  if (send.status === "ERROR") {
    throw new Error(`Funding transaction failed: ${send.errorResult?.toString() ?? "submission error"}`);
  }

  return { hash: send.hash, status: send.status };
}
