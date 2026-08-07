import { ContractExplorer, loadContracts } from "@theahaco/contract-explorer"
import { network } from "../contracts/util"
import { useWallet } from "../hooks/useWallet"
import styles from "./Debug.module.css"

// Import contract clients and load them for the Contract Explorer. `util.ts`
// (no default `Client` export) is skipped by `loadContracts` itself, so the
// glob only needs to exclude nothing here.
const contractModules = import.meta.glob("../contracts/*.ts")
const contracts = await loadContracts(contractModules)

/**
 * Utility page, not part of the petition/trust flow: a raw contract explorer
 * over both generated clients (`petitions`, `web_of_trust`), for poking at
 * contract methods directly from the connected wallet during development.
 */
export function Debug() {
	const { address, signTransaction } = useWallet()

	return (
		<div className={styles.page}>
			<section className={styles.intro}>
				<p className={styles.kicker}>Utility</p>
				<h1 className={styles.heading}>Debug contracts</h1>
				<p className={styles.lede}>
					Call methods on the petitions and web-of-trust contracts directly,
					signed by the connected wallet.
				</p>
			</section>

			<div className={styles.panel}>
				<ContractExplorer
					contracts={contracts}
					network={network}
					address={address}
					signTransaction={signTransaction}
				/>
			</div>
		</div>
	)
}
