import { type ModuleInterface } from "@creit.tech/stellar-wallets-kit"
import { describe, expect, it } from "vitest"
import { withNidoFirst } from "./moduleOrder"

const mod = (productId: string) => ({ productId }) as unknown as ModuleInterface

describe("withNidoFirst", () => {
	it("puts the Nido module ahead of the standard wallets", () => {
		const nido = mod("nido")
		const standard = [mod("freighter"), mod("xbull"), mod("albedo")]

		const ordered = withNidoFirst(nido, standard)

		expect(ordered.map((m) => m.productId)).toEqual([
			"nido",
			"freighter",
			"xbull",
			"albedo",
		])
		expect(ordered).toHaveLength(1 + standard.length)
	})

	it("keeps Nido first even with an empty standard set", () => {
		const nido = mod("nido")
		expect(withNidoFirst(nido, []).map((m) => m.productId)).toEqual(["nido"])
	})
})
