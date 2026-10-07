/**
 * Where to find a Nido account's Perch stack on a network.
 *
 * Perch's release workstream (stellar-registry/perch#99 WS4) publishes one
 * deployment manifest per network (`vendor/perch/deployments/<network>.json`):
 * the content-addressed doc compiler, interpreter, spending limit, and
 * WebAuthn verifier, the constructorless recovery controller, ZK pool, and ZK
 * adapter, and the account wasm hash. `fromPerchManifest` reads one;
 * `TESTNET` is Perch's testnet release plus Nido's factory, checked field by
 * field against the manifest in `deployment.test.ts`.
 */

import { StrKey } from '@stellar/stellar-sdk';

export interface PerchDeployment {
  /** The network passphrase every document must name. */
  network: string;
  /** Nido's account factory. Not Perch's: Perch's factory derives an
   *  address from the admin signers, but a Nido passkey's RP ID is the
   *  account's own subdomain, so the address must exist before the passkey
   *  does. Nido's derives it from a salt alone. */
  factory: string;
  /** Perch's WebAuthn verifier, which passkey signers name and the factory
   *  pins. Constructorless, with no admin. */
  webauthnVerifier: string;
  /** The registry Perch's infra is content-addressed under (the manifest's
   *  `registry.id`); the account derives its infra from it. */
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

/** Perch's testnet release (`vendor/perch/deployments/testnet.json`, at the
 *  submodule's pin) and Nido's factory built around its account
 *  (`scripts/deploy-factory.sh`). */
export const TESTNET: PerchDeployment = {
  network: 'Test SDF Network ; September 2015',
  factory: 'CCCY6PPRD7ZYNZDH7QMZZ4U57J5WBNJG4ZUQKJ4NYTPJIP35AWA4BKT6',
  webauthnVerifier: 'CCN63JUG7EAMFSQ2VEZA73ZDFDW6WMOCOM67U5Z7ERI5B67KWTMQ6UBG',
  statelessRegistry: 'CBU7P2S72OL4TD63OBJC3WYQSJSPKS7WRLDO4YT5STOKH7CSQ54HCUY5',
  docCompiler: 'CCECBBCM5WV6KHZULIO6ORWWBT35ZKVLEJTO6ALIOOULRXAVD7JHICO6',
  interpreter: 'CDUU5QEXGCZ5TJNK35WVVSPYURIIFM5H5ZNWJJW3QDSZB57B66C3DNHQ',
  spendingLimit: 'CCUM47GUADDA5CQ54CSPPGAKFXGJQHNZYKP7HQH5Z3UX3E2TBTSAINAD',
  recoveryController: 'CCJGLH3SHOVN3ALAJKBMZ2WVA3ISHFE5ENLYTHZBJKWZ2ELMVA4ZHVWN',
  zkPool: 'CDVEAUJCXT4H3P6PN75JUNWCPJZI26X2T27GI5MZO2KEAKLRSQCDMVH4',
  zkAdapter: 'CB7PYUMZLBHP3DVT6SF2YVTSTCLSXKZC4EPIII7VHYLJ6BRDJCQZISIU',
  circuitId: '9e39c41f4f35aad43e64b255dfe3ba13f10e8c9d36d6f56fce23c2d97c0a0b4a',
  treeDepth: 32,
  accountWasmHash: '7743becf9382698f0a6e36d9987d6bac903ed96ed859c3a93cd4486a9e1474e5',
};

/** A Perch deployment manifest (`deployments/<network>.json`), the fields
 *  this SDK reads. */
export interface PerchManifest {
  network_passphrase: string;
  registry: { id: string };
  zk: { circuit_id: string; tree_depth: number };
  contracts: Record<string, { sha256: string; address?: string }>;
}

/** The deployment a Perch manifest describes, with Nido's `factory`. */
export function fromPerchManifest(manifest: PerchManifest, factory: string): PerchDeployment {
  const address = (name: string): string => {
    const a = manifest.contracts[name]?.address;
    if (!a) throw new Error(`perch manifest: no address for ${name}`);
    return a;
  };
  const hash = manifest.contracts['perch-account']?.sha256;
  if (!hash) throw new Error('perch manifest: no perch-account hash');
  return parsePerchDeployment({
    network: manifest.network_passphrase,
    factory,
    webauthnVerifier: address('perch-webauthn-verifier'),
    statelessRegistry: manifest.registry.id,
    docCompiler: address('perch-doc-compiler'),
    interpreter: address('perch-interpreter'),
    spendingLimit: address('perch-spending-limit'),
    recoveryController: address('perch-recovery'),
    zkPool: address('perch-zk-pool'),
    zkAdapter: address('perch-zk-adapter'),
    circuitId: manifest.zk.circuit_id,
    treeDepth: manifest.zk.tree_depth,
    accountWasmHash: hash,
  });
}

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

/** The deployment to use, or a clear error when a network has none. */
export function requirePerchDeployment(deployment: PerchDeployment | undefined): PerchDeployment {
  if (deployment === undefined) {
    throw new Error('No Perch deployment configured for this network.');
  }
  return deployment;
}
