/**
 * walletModules.ts — instantiates the standard @creit.tech/stellar-wallets-kit
 * wallet modules to register alongside g2c.
 *
 * Kept in its own file (imported dynamically by `walletConnect.initWalletKit`)
 * so that importing the pure session/warning logic from `walletConnect.ts`
 * does NOT pull in every wallet SDK. Several of those SDKs (e.g. Freighter's
 * `@stellar/freighter-api`) are CommonJS and break ESM named-import interop
 * under test runners; isolating them here keeps the pure logic unit-testable.
 *
 * v2.2.0 of the kit dropped the v1 `allowAllModules()` helper, so we
 * instantiate the common no-arg modules explicitly. Hardware/WalletConnect
 * modules are intentionally excluded (they need extra config / project ids).
 */

import type { ModuleInterface } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { RabetModule } from '@creit.tech/stellar-wallets-kit/modules/rabet';
import { HanaModule } from '@creit.tech/stellar-wallets-kit/modules/hana';

export function standardModules(): ModuleInterface[] {
  return [
    new FreighterModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
    new RabetModule(),
    new HanaModule(),
  ];
}
