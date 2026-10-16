import { randomUUID } from "node:crypto";
import { addVisit } from "./store.js";

const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;

// Mirrors the frontend's `eventTokenMatches` (packages/frontend/src/lib/demo/visit.ts) —
// duplicated, not shared, since this service is deliberately isolated from the
// frontend package. Empty expected token disables the check (same convention).
//
// Same token the frontend uses for its own `/demo/start` gate, reused here
// rather than a second value — both are equally client-visible either way,
// so splitting them wouldn't raise the security bar, only the config
// surface. Not a real secret: a deterrent, not authentication.
function eventTokenMatches(expected: string, provided: unknown): boolean {
  if (!expected) return true;
  return provided === expected;
}

export function registerVisit(body: unknown): { status: number; body: unknown } {
    console.log("REGISTERING VISIT");
  if (typeof body !== "object" || body === null) {
    return { status: 400, body: { error: "Invalid JSON body." } };
  }

  const { address, token } = body as { address?: unknown; token?: unknown };

  if (!eventTokenMatches(process.env.DEMO_EVENT_TOKEN ?? "", token)) {
    return { status: 401, body: { error: "Invalid or missing event token." } };
  }

  if (typeof address !== "string" || !CONTRACT_ADDRESS_RE.test(address)) {
    return { status: 400, body: { error: "`address` must be a valid C-address." } };
  }

  const visit = randomUUID();
  addVisit(visit, { address, status: "pending", createdAt: Date.now() });
  return { status: 201, body: { visit } };
}
