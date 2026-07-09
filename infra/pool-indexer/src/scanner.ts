//! Cron-driven scan of the pool contract's `LeafInserted` events into
//! trust-free storage. `EventsSource` is a thin, injectable interface so
//! `runScan` is unit-testable without a live Soroban RPC endpoint; the real
//! network call lives in `SorobanEventsSource` below.
import { rpc, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { appendLeaf, type PoolEnv } from "./handler.js";

export interface LeafEvent {
  index: number;
  leaf: string;
}

/**
 * Injectable events client: `getEvents(cursor)` returns whatever
 * `LeafInserted` events are newly observable since `cursor` (an opaque,
 * source-defined pagination token; `null` means "from the start of
 * retention" / cold start). Events need not be sorted -- `runScan` sorts by
 * index and appends idempotently, so out-of-order or duplicate events from
 * the source are harmless.
 */
export interface EventsSource {
  getEvents(cursor: string | null): Promise<LeafEvent[]>;
}

/**
 * Fetches one page of events from `source` and appends each idempotently by
 * index (`appendLeaf`). A `"conflict"` (the source disagreeing with itself
 * about the leaf at an already-stored index) is logged loudly and otherwise
 * ignored -- this worker is availability-only, so the correct response to a
 * self-inconsistent source is "don't let it corrupt what's already served,"
 * not "crash the whole scan."
 */
export async function runScan(env: PoolEnv, source: EventsSource, cursor: string | null = null): Promise<LeafEvent[]> {
  const events = await source.getEvents(cursor);
  const sorted = [...events].sort((a, b) => a.index - b.index);
  for (const { index, leaf } of sorted) {
    const result = await appendLeaf(env, index, leaf);
    if (result === "conflict") {
      console.error(
        `pool-indexer: conflicting leaf re-scanned at index ${index} -- existing stored leaf left untouched (rejected the new value)`,
      );
    }
  }
  return sorted;
}

const EVENT_NAME = "leaf_inserted";
const PAGE_LIMIT = 1000;

export interface SorobanEventsSourceConfig {
  rpcUrl: string;
  contractId: string;
  /** Ledger to cold-start scanning from when `cursor` is `null` (first run,
   * or a cold start after an outage longer than `getEvents`'s ~7d retention
   * window). Should be at or before the pool contract's deployment ledger. */
  startLedger: number;
}

/**
 * Real Soroban RPC `getEvents` client for the pool contract's
 * `LeafInserted` event (`#[contractevent(topics = ["leaf_inserted"],
 * data_format = "map")]`, `#[topic] index: u32`, data `leaf: BytesN<32>` --
 * `contracts/zk-recovery/src/types.rs:159-165`). `leaf` is already the
 * on-chain-wrapped `stored` value (`P2_4(DOM_BIND, acct_hi, acct_lo,
 * inner)`, i.e. the Merkle tree leaf itself) -- fed directly to storage, NOT
 * re-wrapped.
 *
 * Uses `@stellar/stellar-sdk`'s `rpc.Server`, which already parses each
 * event's `topic`/`value` XDR into `xdr.ScVal`s, so no manual base64/XDR
 * juggling is needed here -- just `scValToNative`.
 *
 * `getEvents` retention is ~7 days: `index.ts`'s `scheduled` handler
 * persists the RPC's own pagination cursor (`getLastCursor()`, read after
 * each call) in KV across invocations, and the cron cadence
 * (`wrangler.toml`'s `[triggers].crons`) is documented there to stay well
 * under the retention window -- losing the persisted cursor for longer than
 * that would silently skip leaves inserted and pruned within a single gap.
 *
 * NOTE: the exact request/response shape here (topic-filter encoding,
 * `data_format = "map"` decoding to `{ leaf: Buffer }`) is written against
 * the documented Soroban RPC `getEvents` contract-event schema and this
 * SDK's typings, but has not been exercised against a live network in this
 * task -- validate against testnet before relying on it in production, per
 * the M3 plan's "getEvents retention is ~7d" constraint.
 */
export class SorobanEventsSource implements EventsSource {
  private readonly server: InstanceType<typeof rpc.Server>;
  private lastCursor: string | null = null;

  constructor(private readonly cfg: SorobanEventsSourceConfig) {
    this.server = new rpc.Server(cfg.rpcUrl);
  }

  /** The RPC's own pagination cursor after the most recent `getEvents`
   * call, for the caller to persist (KV `meta/rpcCursor`) across cron
   * invocations. `null` until the first call completes. */
  getLastCursor(): string | null {
    return this.lastCursor;
  }

  async getEvents(cursor: string | null): Promise<LeafEvent[]> {
    const eventNameXdr = nativeToScVal(EVENT_NAME, { type: "symbol" }).toXDR("base64");
    const filters = [
      {
        type: "contract" as const,
        contractIds: [this.cfg.contractId],
        // [event-name symbol, index (wildcard -- we want every index)].
        topics: [[eventNameXdr, "*"]],
      },
    ];

    const response = cursor
      ? await this.server.getEvents({ filters, cursor, limit: PAGE_LIMIT })
      : await this.server.getEvents({ filters, startLedger: this.cfg.startLedger, limit: PAGE_LIMIT });

    this.lastCursor = response.cursor ?? null;

    const events: LeafEvent[] = [];
    for (const ev of response.events) {
      // topic = [Symbol("leaf_inserted"), U32(index)].
      if (ev.topic.length < 2) continue;
      const index = Number(scValToNative(ev.topic[1]));
      const data = scValToNative(ev.value) as { leaf?: Uint8Array } | undefined;
      const leafBytes = data?.leaf;
      if (leafBytes == null || leafBytes.length !== 32) continue;
      events.push({ index, leaf: `0x${Buffer.from(leafBytes).toString("hex")}` });
    }
    return events;
  }
}
