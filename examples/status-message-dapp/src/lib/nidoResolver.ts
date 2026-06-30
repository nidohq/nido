/**
 * Client for the Nido name resolver (`GET <subdomain>.nido.fyi/.well-known/nido.json`).
 * Lets the dApp turn a Nido name into an account address (forward) and an
 * address into its name (reverse) without speaking Soroban RPC itself.
 *
 * The kit's `accountOrigin` only accepts contract ids, so we build the URL here
 * (it must also work for a *name* label) — mirroring its preview-suffix logic.
 *
 * `base` (the Nido apex, e.g. `nidoBase()`) is passed in by the caller so this
 * stays a pure, side-effect-free module.
 */

export interface NidoRecord {
  name: string | null
  address: string
  network: string
}

/**
 * Build `<scheme>//<label>[--<N>].<apex>/.well-known/nido.json` for a name or a
 * lowercased address `label`, given the Nido apex `base` (e.g. `https://nido.fyi`
 * or a preview root like `https://126.nido.fyi`). On a preview root the account
 * lives one level down at `<label>--<N>.<apex>`, matching `accountOrigin`.
 */
export function buildWellKnownUrl(base: string, label: string): string {
  const u = new URL(base)
  const preview = u.host.match(/^(?:pr-)?(\d+)\.(.+)$/) // e.g. "126.nido.fyi" / "pr-126.nido.fyi"
  const sub = label.toLowerCase()
  const host = preview ? `${sub}--${preview[1]}.${preview[2]}` : `${sub}.${u.host}`
  return `${u.protocol}//${host}/.well-known/nido.json`
}

async function fetchRecord(url: string): Promise<NidoRecord | null> {
  let res: Response
  try {
    res = await fetch(url, { headers: { accept: "application/json" } })
  } catch {
    return null // network / CORS / DNS error — treat as unresolved
  }
  if (!res.ok) return null // 404 (unregistered name or non-account subdomain), 502, …
  try {
    return (await res.json()) as NidoRecord
  } catch {
    return null
  }
}

/** Forward: a Nido name → its contract address, or null if unresolved. */
export async function resolveNidoName(name: string, base: string): Promise<string | null> {
  const rec = await fetchRecord(buildWellKnownUrl(base, name))
  return rec?.address ?? null
}

/** Reverse: a contract address → its registered Nido name, or null if it has none. */
export async function lookupNidoName(address: string, base: string): Promise<string | null> {
  const rec = await fetchRecord(buildWellKnownUrl(base, address))
  return rec?.name ?? null
}
