import { usb } from "usb";
import type { Visit } from "./store.js";

// The Meridian kiosk's thermal printer — see the fordefi-waas spike
// (client/receipt.ts) for how these were found via `system_profiler
// SPUSBDataType`. ESC/POS over WebUSB; no serial/tty abstraction, since this
// device identifies as a USB Printer class, not CDC.
const PRINTER_VID = 0x0416;
const PRINTER_PID = 0x5011;

const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0];
const ALIGN_CENTER = [ESC, 0x61, 1];
const BOLD_ON = [ESC, 0x45, 1];
const BOLD_OFF = [ESC, 0x45, 0];
const CUT = [GS, 0x56, 0];

export interface ReceiptLine {
  title: string;
  text: string;
}

function formatReceipt(lines: ReceiptLine[]): Uint8Array {
  const bytes: number[] = [...INIT, ...ALIGN_CENTER];
  bytes.push(...new TextEncoder().encode("Nido\n\n"));
  bytes.push(...ALIGN_LEFT);

  for (const line of lines) {
    bytes.push(...BOLD_ON);
    bytes.push(...new TextEncoder().encode(line.title + ": "));
    bytes.push(...BOLD_OFF);
    bytes.push(...new TextEncoder().encode(line.text + "\n\n"));
  }

  bytes.push(...CUT);
  return new Uint8Array(bytes);
}

// TODO: the poller only confirms `balance > 0` today — it doesn't capture
// which transaction funded the account, so the receipt can't show an amount
// or tx hash yet. Print what's actually known until that's wired up.
function visitToReceiptLines(id: string, visit: Visit): ReceiptLine[] {
  return [
    { title: "Visit", text: id },
    { title: "Address", text: visit.address },
  ];
}

/** Sends a receipt to the thermal printer over WebUSB. Logs and returns
 *  instead of throwing — a missing printer or a failed print shouldn't take
 *  down the poller. */
export async function printReceipt(id: string, visit: Visit): Promise<void> {
  const device = await usb.findDeviceByIds(PRINTER_VID, PRINTER_PID);
  if (!device) {
    console.error(`[printer] not found, skipping receipt for visit ${id}`);
    return;
  }

  await device.open();
  try {
    await device.selectConfiguration(1);
    await device.claimInterface(0);
    await device.transferOut(1, formatReceipt(visitToReceiptLines(id, visit)));
  } catch (err) {
    console.error(`[printer] failed to print receipt for visit ${id}`, err);
  } finally {
    await device.close();
  }
}
