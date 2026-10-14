#!/usr/bin/env node
// Rewrite the Perch pins Nido's TypeScript carries from a Perch deployment
// manifest (vendor/perch/deployments/testnet.json):
//
//   packages/passkey-sdk/src/perch/deployment.ts         `TESTNET`, every
//       field but `network` and `factory` (Nido's own, redeployed separately)
//   packages/passkey-sdk/src/policyDoc/deployment.ts     the stateless registry
//       and the interpreter/doc-compiler wasm hashes
//   packages/passkey-sdk/src/policyDoc/deployment.test.ts  the addresses those
//       pins must derive to
//
// Each pin is located by its exact source shape and must match once; a file
// whose shape changed fails here rather than keeping a stale pin. The tests
// next to each file check the result against the same manifest.
//
// Usage: node scripts/repin-perch-pins.mjs <manifest.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('usage: repin-perch-pins.mjs <manifest.json>');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const CONTRACT = /^C[A-Z2-7]{55}$/;
const HEX32 = /^[0-9a-f]{64}$/;
function field(path, value, shape) {
  if (!shape.test(String(value))) {
    throw new Error(`${manifestPath}: ${path} is ${JSON.stringify(value)}, expected ${shape}`);
  }
  return value;
}
const contract = (name, key) =>
  field(`contracts.${name}.${key}`, manifest.contracts?.[name]?.[key], key === 'address' ? CONTRACT : HEX32);

const registry = field('registry.id', manifest.registry?.id, CONTRACT);
const testnet = {
  webauthnVerifier: contract('perch-webauthn-verifier', 'address'),
  statelessRegistry: registry,
  docCompiler: contract('perch-doc-compiler', 'address'),
  interpreter: contract('perch-interpreter', 'address'),
  spendingLimit: contract('perch-spending-limit', 'address'),
  recoveryController: contract('perch-recovery', 'address'),
  zkPool: contract('perch-zk-pool', 'address'),
  zkAdapter: contract('perch-zk-adapter', 'address'),
  circuitId: field('zk.circuit_id', manifest.zk?.circuit_id, HEX32),
  treeDepth: field('zk.tree_depth', manifest.zk?.tree_depth, /^(24|32)$/),
  accountWasmHash: contract('perch-account', 'sha256'),
};

function rewrite(rel, edits) {
  const path = join(root, rel);
  let text = readFileSync(path, 'utf8');
  for (const [pattern, replacement] of edits) {
    const hits = text.match(new RegExp(pattern.source, 'gm'))?.length ?? 0;
    if (hits !== 1) throw new Error(`${rel}: expected one match of ${pattern}, found ${hits}`);
    text = text.replace(pattern, replacement);
  }
  writeFileSync(path, text);
}

// `  key: 'value',` (or a bare number) inside one object literal, which
// `scope` isolates by its opening line.
function objectField(scope, key, value) {
  const literal = typeof value === 'number' ? String(value) : `'${value}'`;
  return [
    new RegExp(`(${scope.source}[\\s\\S]*?\\n  ${key}: )(?:'[^']*'|\\d+)(,)`, 'm'),
    `$1${literal}$2`,
  ];
}

const TESTNET_SCOPE = /^export const TESTNET: PerchDeployment = \{/;
rewrite(
  'packages/passkey-sdk/src/perch/deployment.ts',
  Object.entries(testnet).map(([key, value]) => objectField(TESTNET_SCOPE, key, value)),
);

const HASHES_SCOPE = /^export const PERCH_WASM_HASHES = \{/;
rewrite('packages/passkey-sdk/src/policyDoc/deployment.ts', [
  [/(^export const PERCH_STATELESS_REGISTRY_TESTNET =\n  )'[^']*'(;)/m, `$1'${registry}'$2`],
  objectField(HASHES_SCOPE, 'interpreter', contract('perch-interpreter', 'sha256')),
  objectField(HASHES_SCOPE, 'docCompiler', contract('perch-doc-compiler', 'sha256')),
]);

const PINNED_SCOPE = /^const PINNED = \{/;
rewrite('packages/passkey-sdk/src/policyDoc/deployment.test.ts', [
  objectField(PINNED_SCOPE, 'interpreter', testnet.interpreter),
  objectField(PINNED_SCOPE, 'docCompiler', testnet.docCompiler),
]);
