import { type ModuleInterface } from "@creit.tech/stellar-wallets-kit"

/**
 * Place the Nido module FIRST in the picker, ahead of the standard wallets.
 *
 * Pure and import-light (only a type from the kit, erased at runtime) so it can
 * be unit-tested without pulling in the Nido module's passkey/crypto chain.
 */
export function withNidoFirst(
	nido: ModuleInterface,
	standard: ModuleInterface[],
): ModuleInterface[] {
	return [nido, ...standard]
}
