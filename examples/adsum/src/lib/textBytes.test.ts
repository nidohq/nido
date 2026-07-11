import { describe, expect, it } from "vitest"
import { BODY_MAX_BYTES, TITLE_MAX_BYTES, utf8ByteLength } from "./textBytes"

describe("utf8ByteLength", () => {
	it("counts ascii 1:1", () => expect(utf8ByteLength("abc")).toBe(3))
	it("counts multibyte by bytes", () => expect(utf8ByteLength("héllo")).toBe(6))
	it("counts emoji as 4", () => expect(utf8ByteLength("🖋")).toBe(4))
	it("exports contract caps", () => {
		expect(TITLE_MAX_BYTES).toBe(100)
		expect(BODY_MAX_BYTES).toBe(2000)
	})
})
