import { xdr, scValToNative, Address, StrKey } from "@stellar/stellar-sdk";
import type { DecodedEvent, DecodedTx } from "./types.js";

interface ExpertRecord { hash: string; ts: number; body: string; meta: string; }

function decodeEvent(ev: xdr.ContractEvent): DecodedEvent {
  const cid = ev.contractId(); // Buffer (32 bytes) | null
  const contractId = cid ? StrKey.encodeContract(cid as unknown as Buffer) : null;
  const v0 = ev.body().v0();
  const topics = v0.topics().map((t) => {
    try { return scValToNative(t); } catch { return null; }
  });
  let data: unknown;
  try { data = scValToNative(v0.data()); } catch { data = null; }
  return { contractId, topics, data };
}

/** Collect every Soroban contract event from a TransactionMeta (V3 or V4). */
function metaEvents(metaB64: string): DecodedEvent[] {
  const meta = xdr.TransactionMeta.fromXDR(metaB64, "base64");
  const sw = meta.switch();
  const events: xdr.ContractEvent[] = [];
  if (sw === 3) {
    const sm = meta.v3().sorobanMeta();
    if (sm) events.push(...sm.events());
  } else if (sw === 4) {
    const v4 = meta.v4();
    for (const op of v4.operations()) events.push(...op.events());
    for (const te of v4.events()) events.push(te.event());
  }
  return events.map(decodeEvent);
}

/** Best-effort top-level invokeContract fn name + target from the envelope. */
function envelopeInvocation(bodyB64: string): { invokedFn?: string; invokedContract?: string } {
  try {
    const env = xdr.TransactionEnvelope.fromXDR(bodyB64, "base64");
    const name = env.switch().name;
    const tx =
      name === "envelopeTypeTx" ? env.v1().tx()
      : name === "envelopeTypeTxV0" ? env.v0().tx()
      : name === "envelopeTypeTxFeeBump" ? env.feeBump().tx().innerTx().v1().tx()
      : null;
    if (!tx) return {};
    for (const op of tx.operations()) {
      const b = op.body();
      if (b.switch().name !== "invokeHostFunction") continue;
      const hf = b.invokeHostFunctionOp().hostFunction();
      if (hf.switch().name !== "hostFunctionTypeInvokeContract") continue;
      const ic = hf.invokeContract();
      return {
        invokedFn: ic.functionName().toString(),
        invokedContract: Address.fromScAddress(ic.contractAddress()).toString(),
      };
    }
  } catch { /* fall through */ }
  return {};
}

/** Decode one Stellar Expert `/tx` record into a normalized DecodedTx. Never throws. */
export function decodeExpertRecord(rec: ExpertRecord): DecodedTx {
  let events: DecodedEvent[] = [];
  try { events = metaEvents(rec.meta); } catch { events = []; }
  return { txHash: rec.hash, ts: rec.ts, events, ...envelopeInvocation(rec.body) };
}
