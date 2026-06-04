import {
  Account,
  Address,
  Asset,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";

/**
 * Read a Soroban account's native-XLM balance via a read-only simulate of the
 * XLM SAC `balance` call. Returns a 7-dp decimal string (e.g. "12.5000000").
 * Returns "0" when the contract has no balance entry or simulation fails.
 * Extracted verbatim from account/index.astro so the wallet page and the
 * My Nido menu share one implementation.
 */
export async function fetchXlmBalance(
  contractAddress: string,
  rpcUrl: string = DEFAULT_RPC_URL,
): Promise<string> {
  const server = new rpc.Server(rpcUrl);
  const xlmSacId = Asset.native().contractId(Networks.TESTNET);
  const xlmContract = new Contract(xlmSacId);

  const dummySource = new Account(
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "0",
  );

  const tx = new TransactionBuilder(dummySource, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      xlmContract.call("balance", Address.fromString(contractAddress).toScVal()),
    )
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return "0";

  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
  if (!successSim.result) return "0";

  const rawBalance = scValToNative(successSim.result.retval) as bigint;
  const xlm = Number(rawBalance) / 10_000_000;
  return xlm.toFixed(7);
}
