/**
 * Where the Perch stack a Nido account uses lives on a network.
 *
 * Perch's release workstream (stellar-registry/perch#99 WS4) publishes one
 * deployment manifest per network: the content-addressed doc compiler,
 * interpreter, and spending limit the account pins, the constructorless
 * recovery controller, ZK pool, and ZK adapter, and the account wasm hash.
 * Until that manifest lands there is no deployment of this stack to point
 * at, so this module ships the shape and a loader but no addresses: every
 * builder takes a `PerchDeployment` argument, and `PENDING_TESTNET` is
 * `undefined` on purpose. Hardcoding an address here before the release
 * exists would point wallets at contracts nobody reviewed as a set.
 */

import { StrKey } from '@stellar/stellar-sdk';

export interface PerchDeployment {
  /** The network passphrase every document must name. */
  network: string;
  /** Nido's account factory (moves to Perch with WS4). */
  factory: string;
  /** The WebAuthn verifier passkey signers name (moves to Perch with WS4). */
  webauthnVerifier: string;
  /** Perch's stateless subregistry the account derives its infra from. */
  statelessRegistry: string;
  docCompiler: string;
  interpreter: string;
  spendingLimit: string;
  recoveryController: string;
  zkPool: string;
  zkAdapter: string;
  /** `sha256` of the adapter's verification key, 64 lowercase hex chars. */
  circuitId: string;
  /** The ZK pool and circuit depth. */
  treeDepth: number;
  /** `sha256` of the account wasm the factory deploys, 64 lowercase hex. */
  accountWasmHash: string;
}

/** The testnet deployment, once WS4's manifest exists. */
export const PENDING_TESTNET: PerchDeployment | undefined = undefined;

const CONTRACT_FIELDS = [
  'factory',
  'webauthnVerifier',
  'statelessRegistry',
  'docCompiler',
  'interpreter',
  'spendingLimit',
  'recoveryController',
  'zkPool',
  'zkAdapter',
] as const;

const HEX32 = /^[0-9a-f]{64}$/;

/** Validate a manifest (for example, one a build injects as JSON). Throws
 *  on any missing or malformed field rather than returning a partial
 *  deployment. */
export function parsePerchDeployment(value: unknown): PerchDeployment {
  if (typeof value !== 'object' || value === null) {
    throw new Error('perch deployment: expected an object');
  }
  const v = value as Record<string, unknown>;
  const str = (k: string): string => {
    const x = v[k];
    if (typeof x !== 'string' || x.length === 0) throw new Error(`perch deployment: missing ${k}`);
    return x;
  };
  for (const k of CONTRACT_FIELDS) {
    if (!StrKey.isValidContract(str(k))) throw new Error(`perch deployment: ${k} is not a contract`);
  }
  for (const k of ['circuitId', 'accountWasmHash']) {
    if (!HEX32.test(str(k))) throw new Error(`perch deployment: ${k} is not 32-byte lowercase hex`);
  }
  if (v.treeDepth !== 32 && v.treeDepth !== 24) {
    throw new Error('perch deployment: treeDepth must be 32 or 24');
  }
  return value as PerchDeployment;
}

/** The deployment to use, or a clear error while WS4's manifest is pending. */
export function requirePerchDeployment(deployment: PerchDeployment | undefined): PerchDeployment {
  if (deployment === undefined) {
    throw new Error(
      'No Perch deployment for this network yet: the recovery stack ships with ' +
        "Perch's release manifest (stellar-registry/perch#99 WS4).",
    );
  }
  return deployment;
}
