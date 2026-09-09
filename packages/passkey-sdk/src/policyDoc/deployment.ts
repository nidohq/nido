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

/** Perch's content-addressed "stateless" subregistry on testnet — the
 *  deployer of every canonical perch contract instance. */
export const PERCH_STATELESS_REGISTRY_TESTNET =
  'CC6ELNH6YVRRO4WIETIURY3PZLD7NHSDXHRMTJQUT7D733SYVQFYB26O';

/** Pinned wasm hashes of the canonical perch deployment (perch-interpreter
 *  0.1.2 era, perch rev f5676a6cfb7ae02e9ae487be18cf6247653124b0). */
export const PERCH_WASM_HASHES = {
  interpreter: 'f8320d3031e7dffe51fac14177c5353b8818f8e6df3bda6c4c1b714f5ce1d858',
  docCompiler: '3645bd0de34f4896c5e6fd8ca141713eb9f8658728bf16d82026418d4ab0b27f',
  ed25519Verifier: '6ddf7cadcb85059cffa5b127f994490ee560f8a46b2bb437975fbe5bd0cc7de4',
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
  ed25519Verifier: string;
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
    ed25519Verifier: derivePerchContractId(
      TESTNET_PASSPHRASE,
      PERCH_STATELESS_REGISTRY_TESTNET,
      PERCH_WASM_HASHES.ed25519Verifier,
    ),
  });
}
