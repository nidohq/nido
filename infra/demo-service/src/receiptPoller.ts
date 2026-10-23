import type { InvitePrintQueue } from "./inviteClient.js";
import type { Printer } from "./printer.js";
import { buildQrCode } from "./qrCode.js";
import { FRONTEND_BASE_URL } from "./index.js";
/** Drains the whole `/pending-print` queue on each tick rather than one
 *  record at a time, so a burst of confirmations doesn't lag behind the
 *  poll interval. */
export async function pollReceiptsOnce(client: InvitePrintQueue, printer: Printer): Promise<void> {
  for (;;) {
    const record = await client.nextPendingPrint();
    if (!record) return;
    const qrCode = await createQrCode(record.address);
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
export const PR_PREVIEW = process.env.PR_PREVIEW ?? false;
async function createQrCode(address: string | undefined) {
  const walletUrl = new URL(FRONTEND_BASE_URL);
  if (PR_PREVIEW) {
    walletUrl.hostname  = `${address}--${walletUrl.hostname}`
  } else {
    walletUrl.hostname  = `${address}.${walletUrl.hostname}`
  }
  console.log("the url : ", walletUrl.toString())
  const qrCode = await buildQrCode(walletUrl.toString());
  return qrCode
}

export function startReceiptPolling(client: InvitePrintQueue, printer: Printer, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    pollReceiptsOnce(client, printer).catch((err) => console.error("receipt poll error:", err));
  }, intervalMs);
}
