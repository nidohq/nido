import { type ModuleInterface } from "@creit.tech/stellar-wallets-kit"
import { describe, expect, it } from "vitest"
import { withG2cFirst } from "./moduleOrder"

const mod = (productId: string) => ({ productId }) as unknown as ModuleInterface

describe("withG2cFirst", () => {
	it("puts the g2c module ahead of the standard wallets", () => {
		const g2c = mod("g2c")
		const standard = [mod("freighter"), mod("xbull"), mod("albedo")]

		const ordered = withG2cFirst(g2c, standard)

		expect(ordered.map((m) => m.productId)).toEqual([
			"g2c",
			"freighter",
			"xbull",
			"albedo",
		])
		expect(ordered).toHaveLength(1 + standard.length)
	})

	it("keeps g2c first even with an empty standard set", () => {
		const g2c = mod("g2c")
		expect(withG2cFirst(g2c, []).map((m) => m.productId)).toEqual(["g2c"])
	})
})
