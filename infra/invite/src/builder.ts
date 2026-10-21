import { randomBytes } from "node:crypto";
import type { Store } from "./store.js";

// Excludes 0/O/1/I/L so a staff member can read a code off a screen or a
// printed card without ambiguity.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

/** Issues a fresh code, good for `ttlMs` from now. */
export function issueCode(store: Store, ttlMs: number): { code: string; expiresAt: number } {
  let code = randomCode();
  while (store.get(code)) code = randomCode();

  const now = Date.now();
  const expiresAt = now + ttlMs;
  store.put({ code, status: "issued", issuedAt: now, expiresAt });
  return { code, expiresAt };
}
