import { describe, it, expect } from "vitest"
import { xdr, Address, nativeToScVal } from "@stellar/stellar-sdk"
import {
	decodeContractCall,
	buildApprovalDetails,
	shortenStrkey,
} from "./describeAuthEntry"

const CONTRACT = "CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM"
const ACCOUNT = "CBKMUZNFQIAL775XBB2W2GP5CNHBM5YGH6C3XB7AY6SUVO2IBU3VYK2V"

function contractInvocation(
	contract: string,
	fn: string,
	args: xdr.ScVal[],
): xdr.SorobanAuthorizedInvocation {
	const ica = new xdr.InvokeContractArgs({
		contractAddress: new Address(contract).toScAddress(),
		functionName: fn,
		args,
	})
	return new xdr.SorobanAuthorizedInvocation({
		function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(ica),
		subInvocations: [],
	})
}

describe("decodeContractCall", () => {
	it("decodes the contract, function and args from the actual invocation", () => {
		const inv = contractInvocation(CONTRACT, "update_message", [
			nativeToScVal("gm soroban"),
			new Address(ACCOUNT).toScVal(),
		])
		expect(decodeContractCall(inv)).toEqual({
			contract: CONTRACT,
			fn: "update_message",
			args: ["gm soroban", ACCOUNT],
		})
	})

	it("returns null when the invocation is not a contract call", () => {
		const createFn =
			xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractHostFn(
				new xdr.CreateContractArgs({
					contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
						new xdr.ContractIdPreimageFromAddress({
							address: new Address(ACCOUNT).toScAddress(),
							salt: Buffer.alloc(32),
						}),
					),
					executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
				}),
			)
		const inv = new xdr.SorobanAuthorizedInvocation({
			function: createFn,
			subInvocations: [],
		})
		expect(decodeContractCall(inv)).toBeNull()
	})
})

describe("shortenStrkey", () => {
	it("shortens a 56-char strkey address", () => {
		expect(shortenStrkey(CONTRACT)).toBe("CBXVJX…GNDM")
		expect(shortenStrkey(ACCOUNT)).toBe("CBKMUZ…YK2V")
	})

	it("leaves ordinary text untouched", () => {
		expect(shortenStrkey("gm soroban")).toBe("gm soroban")
		expect(shortenStrkey("")).toBe("")
	})
})

describe("buildApprovalDetails", () => {
	it("labels args by name and shortens address values", () => {
		const details = buildApprovalDetails(
			{ contract: CONTRACT, fn: "update_message", args: ["gm soroban", ACCOUNT] },
			["message", "author"],
		)
		expect(details).toEqual([
			{ label: "Operation", value: "update_message" },
			{ label: "Contract", value: "CBXVJX…GNDM" },
			{ label: "message", value: "gm soroban" },
			{ label: "author", value: "CBKMUZ…YK2V" },
		])
	})

	it("falls back to positional labels and stringifies non-string args", () => {
		const details = buildApprovalDetails(
			{ contract: CONTRACT, fn: "do_thing", args: [42n, true] },
			[],
		)
		expect(details).toEqual([
			{ label: "Operation", value: "do_thing" },
			{ label: "Contract", value: "CBXVJX…GNDM" },
			{ label: "arg 1", value: "42" },
			{ label: "arg 2", value: "true" },
		])
	})
})
