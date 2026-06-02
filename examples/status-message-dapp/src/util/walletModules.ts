/**
 * walletModules.ts — instantiates the standard @creit.tech/stellar-wallets-kit
 * modules that appear in the picker alongside g2c.
 *
 * Kept in its own file (imported lazily by `wallet.ts`) so that the pure
 * session/selector logic does not statically pull in every wallet SDK — some
 * of those SDKs are CommonJS and break ESM named-import interop under the test
 * runner. Isolating them here keeps the rest unit-testable.
 *
 * Kit v2.2.0 dropped the v1 `allowAllModules()` helper, so we instantiate the
 * common no-arg modules explicitly. Hardware / WalletConnect modules are
 * intentionally excluded (they need extra config / project ids).
 */

import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit"
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter"
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull"
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo"
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr"
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet"
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana"

export function standardModules(): ModuleInterface[] {
	return [
		new FreighterModule(),
		new xBullModule(),
		new AlbedoModule(),
		new LobstrModule(),
		new RabetModule(),
		new HanaModule(),
	]
}
