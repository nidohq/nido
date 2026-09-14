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
 * on another network. See DEPLOYED.md ("Perch canonical deployment").
 */

import { Address, StrKey, hash, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Perch's content-addressed "stateless" registry on testnet — the deployer
 *  of every canonical perch contract instance. This is the NEW registry the
 *  perch release CI publishes to as of doc-compiler 0.2.1 (publish receipt
 *  on the `perch-doc-compiler-v0.2.1` GitHub release); the previous
 *  registry `CC6ELNH6…` holds only the pre-cap builds. */
export const PERCH_STATELESS_REGISTRY_TESTNET =
  'CDX2DMYMMEYU6FGN3HPJ2GQSSL5EZHIAMEJD4SPF55FZE5LEUBPPPDA7';

/** Pinned wasm hashes of the canonical perch contracts nido uses — the
 *  cap-capable 0.2.1 generation. Mirrors the smart account's in-contract
 *  pins (contracts/smart-account/src/doc.rs). */
export const PERCH_WASM_HASHES = {
  interpreter: 'f63cae53fff084183181a220121de3394442ac4a2704e78896c07af8196f3651',
  docCompiler: '35f248f0bcbf3d888bc1e6178707e90dbae37989b0efc3f43c85ce8b491506f5',
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
