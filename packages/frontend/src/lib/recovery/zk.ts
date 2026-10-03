/**
 * ZK recovery in the browser: making a recovery kit at enrollment, and
 * proving a controller statement with one.
 *
 * Everything here loads lazily: the prover (bb.js 0.87.0, through
 * `@nidohq/passkey-sdk/perch-zk`) and the release circuit only download when
 * a page actually enrolls or proves. Proving runs single-threaded on the
 * main thread (about 0.7 s on a desktop per Perch's measurements); the page
 * shows progress while it runs.
 */

import type { perch } from '@nidohq/passkey-sdk';
import { NETWORK_PASSPHRASE } from '../network.js';
import { recoveryClient } from './chain.js';
import { hex, type RecoveryKit } from './model.js';

const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

async function zk() {
  const mod = await import('@nidohq/passkey-sdk/perch-zk');
  await mod.initZk();
  return mod;
}

/** A fresh credential for `account`: the kit the owner saves, and the
 *  enrollment the document names. */
export async function newRecoveryKit(
  account: string,
): Promise<{ kit: RecoveryKit; enrollment: perch.ZkEnrollmentSpec }> {
  const mod = await zk();
  const credential = mod.newZkCredential();
  return {
    kit: {
      version: 1,
      network: NETWORK_PASSPHRASE,
      account,
      enrollmentId: hex(credential.enrollmentId),
      secret: hex(credential.secret),
    },
    enrollment: { enrollmentId: credential.enrollmentId, commitment: mod.zkCommitment(credential) },
  };
}

/** A downloadable copy of `kit`. */
export function kitFile(kit: RecoveryKit): Blob {
  return new Blob([JSON.stringify(kit, null, 2) + '\n'], { type: 'application/json' });
}

/** Prove `statement` with `kit`: find the kit's leaf in the pool, rebuild its
 *  tree from the pool's stored leaves, and prove. The adapter refuses the
 *  result unless the kit really is the enrolled credential. */
export async function proveWithKit(
  kit: RecoveryKit,
  statement: perch.RecoveryStatement,
  onProgress?: (step: string) => void,
): Promise<perch.ZkEvidence> {
  if (kit.account !== statement.account) {
    throw new Error('This recovery kit belongs to a different Nido.');
  }
  const client = recoveryClient();
  onProgress?.('Finding your credential in the pool');
  const position = await client.leafPosition(kit.account, bytes(kit.enrollmentId));
  if (!position) throw new Error("This recovery kit isn't enrolled for this Nido.");
  const leaves = await client.treeLeaves(position.treeId);
  onProgress?.('Loading the prover');
  const mod = await zk();
  const circuit = (await import('@stellar-registry/perch-zk/artifacts/perch_zk_recovery.json')).default;
  onProgress?.('Proving');
  return mod.proveStatement({
    circuit: circuit as unknown as Parameters<typeof mod.proveStatement>[0]['circuit'],
    statement,
    credential: { enrollmentId: bytes(kit.enrollmentId), secret: bytes(kit.secret) },
    position,
    leaves,
  });
}
