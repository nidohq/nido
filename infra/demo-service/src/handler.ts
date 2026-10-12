import { randomUUID } from "node:crypto";
import { addVisit } from "./store.js";

const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;

export function registerVisit(body: unknown): { status: number; body: unknown } {
    console.log("REGISTERING VISIT");
  if (typeof body !== "object" || body === null) {
    return { status: 400, body: { error: "Invalid JSON body." } };
  }

  const address = (body as { address?: unknown }).address;
  if (typeof address !== "string" || !CONTRACT_ADDRESS_RE.test(address)) {
    return { status: 400, body: { error: "`address` must be a valid C-address." } };
  }

  const visit = randomUUID();
  addVisit(visit, { address, status: "pending", createdAt: Date.now() });
  return { status: 201, body: { visit } };
}
