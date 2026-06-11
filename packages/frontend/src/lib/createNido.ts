import { buf2hex, stripSubdomain } from "@g2c/passkey-sdk";

function setupHost(host: string): string {
  const hostname = host.split(":")[0];
  if (hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return host;
  }
  return stripSubdomain(host);
}

export function createNido(host: string): string {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return `//${setupHost(host)}/new-account/?salt=${buf2hex(salt)}&setup=1`;
}
