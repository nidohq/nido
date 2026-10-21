import type { CodeStore } from "./codeStore.js";
import { MemoryStore } from "./memoryStore.js";
import { PostgresStore } from "./postgresStore.js";

/** `fly postgres attach` sets DATABASE_URL as a secret on the app it's
 *  attached to; local dev simply never sets it. */
export async function createStore(): Promise<CodeStore> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return new MemoryStore();

  const store = new PostgresStore(databaseUrl);
  await store.init();
  return store;
}
