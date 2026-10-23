import { randomUUID } from "node:crypto";
import type { CodeStore } from "./codeStore.js";

/** Issues a fresh code, good for `ttlMs` from now. */
export async function issueCode(store: CodeStore, ttlMs: number): Promise<{ code: string; expiresAt: number }> {
  let code = randomUUID();
  while (await store.get(code)) code = randomUUID(); // collision: vanishingly rare, cheap to guard anyway

  const now = Date.now();
  const expiresAt = now + ttlMs;
  await store.put({ code, status: "issued", issuedAt: now, expiresAt });
  return { code, expiresAt };
}
