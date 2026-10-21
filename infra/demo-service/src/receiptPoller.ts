import type { InvitePrintQueue } from "./inviteClient.js";
import type { Printer } from "./printer.js";
import { buildQrCode } from "./qrCode.js";

/** Drains the whole `/pending-print` queue on each tick rather than one
 *  record at a time, so a burst of confirmations doesn't lag behind the
 *  poll interval. */
export async function pollReceiptsOnce(client: InvitePrintQueue, printer: Printer): Promise<void> {
  for (;;) {
    const record = await client.nextPendingPrint();
    if (!record) return;

    // fix this url
    const walletUrl = `http://${record.address}.localhost:4321/account/`;
    const qrCode = await buildQrCode(walletUrl);
    await printer.print({
      title: "",
      lines: [`Your Nido account is ready:\n${record.address ?? "(unknown)"}`],
      qrDataUrl: qrCode,
    });

    // Only after the printer confirms the job completed — see
    // infra/invite's README for why `next` and `ack` are separate calls.
    await client.ackPendingPrint(record.code);
  }
}

export function startReceiptPolling(client: InvitePrintQueue, printer: Printer, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    pollReceiptsOnce(client, printer).catch((err) => console.error("receipt poll error:", err));
  }, intervalMs);
}
