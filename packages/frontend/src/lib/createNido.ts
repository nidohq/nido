import { buf2hex, stripSubdomain } from "@nidohq/passkey-sdk";

export function createNido(host: string): string {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  // A2: this is the SETUP SECRET, the seed of a one-time Ed25519 setup key
  // (passkey-sdk `perch/setupKey.ts`). Its public key derives the
  // deterministic account address, and only its signature binds a passkey
  // there, so whoever holds it can claim the pre-funded account before the
  // owner attaches a passkey. It keeps the `salt` name in links, pending
  // storage and the setup cookie. Carry it in the URL HASH, never the query:
  // the fragment is never sent to the server, so it stays out of worker/CDN
  // access logs and cross-origin Referer. `setup=1` is not secret and stays a
  // query param (the receiver reads it before the secret is scrubbed).
  return `//${stripSubdomain(host)}/new-account/?setup=1#salt=${buf2hex(secret)}`;
}
