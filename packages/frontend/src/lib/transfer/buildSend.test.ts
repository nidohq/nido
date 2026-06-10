import { describe, it, expect } from "vitest";
import { Address, StrKey, scValToNative } from "@stellar/stellar-sdk";
import { buildSendOperation } from "./buildSend";
import { buildSendXlmOperation } from "../sendXlm";

const SMART = StrKey.encodeContract(Buffer.alloc(32, 0xaa));
const DEST_G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0xcd));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 0xee));

describe("buildSendOperation", () => {
  it("builds account.execute(token, transfer, [from, to, i128]) for an arbitrary token", () => {
    const amount = 4_200n;
    const op = buildSendOperation({
      smartAccount: SMART,
      tokenContractId: TOKEN,
      destination: DEST_G,
      amount,
    });

    const ic = op.body().invokeHostFunctionOp().hostFunction().invokeContract();

    // Outer call targets the smart account's `execute` entrypoint.
    expect(Address.fromScAddress(ic.contractAddress()).toString()).toBe(SMART);
    expect(ic.functionName().toString()).toBe("execute");

    const args = ic.args();
    expect(scValToNative(args[0])).toBe(TOKEN); // target = the chosen token
    expect(scValToNative(args[1])).toBe("transfer"); // target_fn
    const inner = scValToNative(args[2]) as [string, string, bigint];
    expect(inner[0]).toBe(SMART); // from = the account
    expect(inner[1]).toBe(DEST_G); // to = destination
    expect(inner[2]).toBe(amount); // amount = i128
  });

  it("matches buildSendXlmOperation byte-for-byte when the token is the XLM SAC", () => {
    const xlmOp = buildSendXlmOperation({
      smartAccount: SMART,
      destination: DEST_G,
      stroops: 12_345_670n,
    });
    const xlmSac = scValToNative(
      xlmOp.body().invokeHostFunctionOp().hostFunction().invokeContract().args()[0],
    ) as string;

    const generic = buildSendOperation({
      smartAccount: SMART,
      tokenContractId: xlmSac,
      destination: DEST_G,
      amount: 12_345_670n,
    });

    expect(generic.toXDR("base64")).toBe(xlmOp.toXDR("base64"));
  });
});
