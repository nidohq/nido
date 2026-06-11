import { Keypair } from "@stellar/stellar-sdk";
import { stripSubdomain } from "@g2c/passkey-sdk";

function setupHost(host: string): string {
  const hostname = host.split(":")[0];
  if (hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return host;
  }
  return stripSubdomain(host);
}

export function createNido(host: string): string {
  const keypair = Keypair.random();
  const secret = keypair.secret();
  return `//${setupHost(host)}/new-account/?key=${encodeURIComponent(secret)}&setup=1`;
}
