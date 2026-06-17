import { buf2hex, stripSubdomain } from "@nidohq/passkey-sdk";

function setupHost(host: string): string {
  const hostname = host.split(":")[0];
  if (hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return host;
  }
  const first = hostname.split(".")[0];
  if (/^\d+$/.test(first) || hostname.split(".").length <= 2) {
    return host;
  }
  const legacyPreview = first.match(/^pr-(\d+)$/);
  if (legacyPreview) {
    return host.replace(/^pr-\d+(?=\.)/, legacyPreview[1]);
  }
  return stripSubdomain(host);
}

export function createNido(host: string): string {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return `//${setupHost(host)}/new-account/?salt=${buf2hex(salt)}&setup=1`;
}
