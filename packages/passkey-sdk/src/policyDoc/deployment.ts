/**
 * Perch's canonical registry deployment.
 *
 * Perch contracts are NOT nido-owned deploys: they come from perch's
 * content-addressed "stateless" subregistry, where each contract instance is
 * deployed by the registry with `salt = sha256(wasm)`. That makes every
 * address derivable offline from two auditable pins — the registry id and
 * the wasm hash — via the standard Soroban contract-id preimage:
 *
 *   contract_id = sha256(HashIdPreimage::EnvelopeTypeContractId {
 *     network_id: sha256(network_passphrase),
 *     from_address { address: registry, salt: wasm_hash },
 *   })
 *
 * The pins mirror perch's own CI-guarded `testnet_pins.rs`; the derived
 * addresses are asserted against the known deployment in this module's
 * tests. Addresses are network-specific — the same pins give different ids
 * on another network. See DEPLOYED.md ("Perch policy layer (0.2.1 era)").
 */

import { Address, StrKey, hash, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Perch's content-addressed "stateless" registry on testnet — the deployer
 *  of every canonical perch contract instance. This is the registry recorded
 *  as `registry.id` in Perch's testnet deployment manifest
 *  (`vendor/perch/deployments/testnet.json`); it content-addresses the
 *  interpreter and doc compiler the deployed account cross-calls. */
export const PERCH_STATELESS_REGISTRY_TESTNET =
  'CAR2DSSOBJB76GGD6MAAKWUK36Y7I7O3NDWTN7HTIRV5I3XZ27U3ZBVZ';

/** Pinned wasm hashes of the canonical perch contracts nido uses. These are
 *  the `perch-interpreter` and `perch-doc-compiler` sha256s in Perch's testnet
 *  deployment manifest (`vendor/perch/deployments/testnet.json`); the account's
 *  own in-contract pins (`perch-account.pins` there) name the same hashes. */
export const PERCH_WASM_HASHES = {
  interpreter: '2254f17dd722e5113caee901be96849c13e5a6853a6213d62473abe637ae33e1',
  docCompiler: 'ccea12cd4b2f23d9bce07e3d9d3aaf93c43df79416b22a8c9a122d467b707853',
} as const;

/** Derive a content-addressed perch contract id from its deployer registry
 *  and wasm hash (the deploy salt). */
export function derivePerchContractId(
  networkPassphrase: string,
  registry: string,
  wasmHashHex: string,
): string {
  const salt = Buffer.from(wasmHashHex, 'hex');
  if (salt.length !== 32) {
    throw new Error(`policyDoc: wasm hash must be 32 bytes of hex, got "${wasmHashHex}"`);
  }
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(registry).toScAddress(),
          salt,
        }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

export interface PerchAddresses {
  interpreter: string;
  docCompiler: string;
}

let testnetAddresses: PerchAddresses | undefined;

/** The canonical perch contract addresses on testnet, derived from the pins
 *  above (memoized). */
export function perchTestnetAddresses(): PerchAddresses {
  return (testnetAddresses ??= {
    interpreter: derivePerchContractId(
      TESTNET_PASSPHRASE,
      PERCH_STATELESS_REGISTRY_TESTNET,
      PERCH_WASM_HASHES.interpreter,
    ),
    docCompiler: derivePerchContractId(
      TESTNET_PASSPHRASE,
      PERCH_STATELESS_REGISTRY_TESTNET,
      PERCH_WASM_HASHES.docCompiler,
    ),
  });
}
