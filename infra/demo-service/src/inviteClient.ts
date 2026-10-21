/** The slice of a `/pending-print/next` response this service actually
 *  reads — decoupled from infra/invite's own `CodeRecord` type since these
 *  are two separate deployables, not a shared workspace package. */
export interface PendingPrintRecord {
  code: string;
  address?: string;
  usedAt?: number;
}

/** What the ReceiptPoller needs, pulled out as an interface so tests can
 *  fake it without having to structurally match InviteClient's private
 *  fields. */
export interface InvitePrintQueue {
  nextPendingPrint(): Promise<PendingPrintRecord | undefined>;
  ackPendingPrint(code: string): Promise<void>;
}

/** Talks to infra/invite over its public HTTP API — never anything reaching
 *  the other way. See demo-plan.md for why: this laptop has no inbound route
 *  from the internet, so it has to be the one calling out. */
export class InviteClient implements InvitePrintQueue {
  constructor(
    private baseUrl: string,
    private apiKey: string | undefined,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    return headers;
  }

  async createCode(): Promise<{ code: string; expiresAt: number }> {
    const res = await fetch(`${this.baseUrl}/codes`, { method: "POST", headers: this.headers() });
    if (!res.ok) throw new Error(`createCode failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /** `undefined` means the print queue is empty right now (infra/invite
   *  answers 204, not an error). */
  async nextPendingPrint(): Promise<PendingPrintRecord | undefined> {
    const res = await fetch(`${this.baseUrl}/pending-print/next`, { headers: this.headers() });
    if (res.status === 204) return undefined;
    if (!res.ok) throw new Error(`nextPendingPrint failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async ackPendingPrint(code: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/pending-print/${encodeURIComponent(code)}/ack`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`ackPendingPrint failed: ${res.status} ${await res.text()}`);
  }
}
