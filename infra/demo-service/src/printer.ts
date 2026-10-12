import type { Visit } from "./store.js";

// Skeleton — just logs for now. Will eventually trigger the kiosk's thermal
// printer; signature stays the same either way.
export function printReceipt(id: string, visit: Visit): void {
  console.log(`[printer] receipt for visit ${id} — ${visit.address}`);
}
