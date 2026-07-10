import { describe, it, expect, vi, afterEach } from "vitest"
import { buildWellKnownUrl, resolveNidoName, lookupNidoName } from "./nidoResolver"

const CONTRACT = "CDRBWQZV7EBKU53FTGWF2OCZE7Z52MFAWCG5CEMTR4HZHIFFX4RZBFMM"

function mockFetch(impl: (url: string) => { ok: boolean; json?: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const r = impl(url)
    return { ok: r.ok, json: async () => r.json } as unknown as Response
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe("buildWellKnownUrl", () => {
  it("builds a production name URL", () => {
    expect(buildWellKnownUrl("https://nido.fyi", "alice")).toBe(
      "https://alice.nido.fyi/.well-known/nido.json",
    )
  })
  it("builds a preview-root name URL with the --<N> suffix", () => {
    expect(buildWellKnownUrl("https://126.nido.fyi", "alice")).toBe(
      "https://alice--126.nido.fyi/.well-known/nido.json",
    )
  })
  it("handles the legacy pr-<N> preview root", () => {
    expect(buildWellKnownUrl("https://pr-7.nido.fyi", "alice")).toBe(
      "https://alice--7.nido.fyi/.well-known/nido.json",
    )
  })
  it("lowercases an address label", () => {
    expect(buildWellKnownUrl("https://nido.fyi", CONTRACT)).toBe(
      `https://${CONTRACT.toLowerCase()}.nido.fyi/.well-known/nido.json`,
    )
  })
})

describe("resolveNidoName (forward)", () => {
  it("returns the address for a registered name", async () => {
    let asked = ""
    mockFetch((url) => { asked = url; return { ok: true, json: { name: "alice", address: CONTRACT, network: "testnet" } } })
    expect(await resolveNidoName("alice", "https://nido.fyi")).toBe(CONTRACT)
    expect(asked).toBe("https://alice.nido.fyi/.well-known/nido.json")
  })
  it("returns null on a 404 (unregistered)", async () => {
    mockFetch(() => ({ ok: false }))
    expect(await resolveNidoName("ghost", "https://nido.fyi")).toBeNull()
  })
  it("returns null on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net") }))
    expect(await resolveNidoName("alice", "https://nido.fyi")).toBeNull()
  })
})

describe("lookupNidoName (reverse)", () => {
  it("returns the name for a contract address", async () => {
    mockFetch(() => ({ ok: true, json: { name: "alice", address: CONTRACT, network: "testnet" } }))
    expect(await lookupNidoName(CONTRACT, "https://nido.fyi")).toBe("alice")
  })
  it("returns null when the account has no name", async () => {
    mockFetch(() => ({ ok: true, json: { name: null, address: CONTRACT, network: "testnet" } }))
    expect(await lookupNidoName(CONTRACT, "https://nido.fyi")).toBeNull()
  })
})
