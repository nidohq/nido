import { type ModuleInterface } from "@creit.tech/stellar-wallets-kit"

/**
 * Place the g2c module FIRST in the picker, ahead of the standard wallets.
 *
 * Pure and import-light (only a type from the kit, erased at runtime) so it can
 * be unit-tested without pulling in the g2c module's passkey/crypto chain.
 */
export function withG2cFirst(
	g2c: ModuleInterface,
	standard: ModuleInterface[],
): ModuleInterface[] {
	return [g2c, ...standard]
}
