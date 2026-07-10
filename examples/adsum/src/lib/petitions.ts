/**
 * Data layer over the generated `petitions` contract client
 * (`src/contracts/petitions.ts`, itself a thin `Client` instance built from
 * `packages/petitions/src/index.ts`). Pages import this module rather than
 * the generated client directly, so they never have to know about
 * `AssembledTransaction`, `Option<u32>`/`u32 | undefined`, or `Result`
 * unwrapping.
 */

import petitions from "../contracts/petitions"
import { wallet } from "../util/wallet"
import { signAndSendWithSentinel, type SendResult } from "./sentinel"

export type { SendResult }

/** UI-friendly view of a `Petition`, keyed by its on-chain id. */
export interface PetitionView {
	id: number
	creator: string
	title: string
	body: string
	/** `null` when the petition has no funding goal (contract `Option<u32>`). */
	goal: number | null
	/** `null` when the petition has no deadline (contract `Option<u32>`). */
	deadline: number | null
	sigCount: number
	createdLedger: number
}

/** Fields the caller supplies for a new petition; `creator` comes separately. */
export interface CreatePetitionFields {
	title: string
	body: string
	goal?: number | null
	deadline?: number | null
}

/** `number | null | undefined` -> the generated client's `Option<u32>` (`u32 | undefined`). */
function toOptionU32(value: number | null | undefined): number | undefined {
	return value == null ? undefined : value
}

/** `Option<u32>` (`u32 | undefined`) -> `number | null`, for `PetitionView`. */
function fromOptionU32(value: number | undefined): number | null {
	return value === undefined ? null : value
}

function toPetitionView(
	id: number,
	petition: {
		creator: string
		title: string
		body: string
		goal: number | undefined
		deadline: number | undefined
		sig_count: number
		created_ledger: number
	},
): PetitionView {
	return {
		id,
		creator: petition.creator,
		title: petition.title,
		body: petition.body,
		goal: fromOptionU32(petition.goal),
		deadline: fromOptionU32(petition.deadline),
		sigCount: petition.sig_count,
		createdLedger: petition.created_ledger,
	}
}

/** Read a single petition by id, or `null` if it doesn't exist. */
export async function fetchPetition(id: number): Promise<PetitionView | null> {
	const tx = await petitions.get_petition({ id })
	const raw = tx.result
	return raw ? toPetitionView(id, raw) : null
}

/**
 * Read the `count` most recent petitions (ids assumed to run `0..count-1`),
 * newest first, `pageSize` at a time. Ids that fail to resolve (unexpected —
 * the contract never deletes petitions) are skipped rather than surfaced as
 * `null` entries.
 */
export async function fetchPetitions(
	count: number,
	pageSize = 20,
): Promise<PetitionView[]> {
	const ids: number[] = []
	for (let id = count - 1; id >= 0; id--) ids.push(id)

	const views: PetitionView[] = []
	for (let i = 0; i < ids.length; i += pageSize) {
		const page = ids.slice(i, i + pageSize)
		const results = await Promise.all(page.map((id) => fetchPetition(id)))
		for (const view of results) if (view) views.push(view)
	}
	return views
}

/** The addresses that have signed petition `id`, paginated. */
export async function fetchSigners(
	id: number,
	start: number,
	limit: number,
): Promise<string[]> {
	const tx = await petitions.get_signers({ id, start, limit })
	return tx.result
}

/** Whether `addr` has already signed petition `id`. */
export async function hasSigned(id: number, addr: string): Promise<boolean> {
	const tx = await petitions.has_signed({ id, addr })
	return tx.result
}

/** The total number of petitions ever created. */
export async function fetchPetitionCount(): Promise<number> {
	const tx = await petitions.petition_count()
	return tx.result
}

/**
 * Create a new petition as `address` and sign/send it. Throws (without
 * signing) if the contract-level simulation reports an error (e.g. an
 * invalid title or a deadline in the past). Resolves with the new petition's
 * id alongside the send result.
 */
export async function createPetition(
	fields: CreatePetitionFields,
	address: string,
): Promise<{ id?: number } & SendResult> {
	const tx = await petitions.create_petition(
		{
			creator: address,
			title: fields.title,
			body: fields.body,
			goal: toOptionU32(fields.goal),
			deadline: toOptionU32(fields.deadline),
		},
		{ publicKey: address },
	)
	if (tx.result.isErr()) {
		throw new Error(tx.result.unwrapErr().message)
	}
	const sendResult = await signAndSendWithSentinel(tx, wallet.signTransaction)
	return { id: tx.result.unwrap(), ...sendResult }
}

/**
 * Sign petition `id` as `address`. Throws (without signing) if the
 * contract-level simulation reports an error (e.g. already signed, or the
 * petition has expired).
 */
export async function signPetition(
	id: number,
	address: string,
): Promise<SendResult> {
	const tx = await petitions.sign(
		{ id, signer: address },
		{ publicKey: address },
	)
	if (tx.result.isErr()) {
		throw new Error(tx.result.unwrapErr().message)
	}
	return signAndSendWithSentinel(tx, wallet.signTransaction)
}
