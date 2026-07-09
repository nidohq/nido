// Pins the exact toolchain + circuit artifacts this frontend was built against, so a fetched
// circuit/vk can be checked for drift before it's ever handed to bb.js. Values here are generated
// by circuits/zk_recovery/scripts/gen_artifacts.sh (see its "[5/5] writing public/circuits/manifest.json"
// step) and copied into packages/frontend/public/circuits/manifest.json at build time — the two
// manifests (repo-root circuit build output vs. the frontend's public/ copy) must stay identical.

/** Toolchain + artifact pins for the zk_recovery circuit, matching Global Constraints in
 * docs/superpowers/plans/2026-07-03-zk-recovery-m3-sdk-prover-infra.md. */
export const MANIFEST = {
  circuitName: 'zk_recovery',
  /** nargo compiler version used to produce target/zk_recovery.json. */
  nargoVersion: '1.0.0-beta.18',
  /** @aztec/bb.js version used to produce target/vk and to generate proofs. */
  bbVersion: '3.0.0-nightly.20260102',
  /** Noir ACIR oracle hash function — must match the circuit's `oracle_hash` setting. */
  oracleHash: 'keccak',
  /** UltraHonkBackend.generateProof verifier target — matches the on-chain (EVM-style, no ZK
   * wrapping) verifier this proof is destined for. */
  verifierTarget: 'evm-no-zk',
  /** sha256 of public/circuits/zk_recovery.json (the compiled circuit, ACIR + bytecode). */
  circuitSha256: 'bfb14bb25e356411245c7a1ae1a997b3ee8e5c5cdb8e1627aad87b68015a1ec4',
  /** sha256 of public/circuits/vk (the UltraHonk verification key). */
  vkSha256: 'ba39b4ac4350a655792aa55acdf2a4855e099f48809db8569c88f2ed18ad3922',
} as const;

/**
 * Throw if a fetched artifact's sha256 doesn't match the pinned value. Call this before handing a
 * fetched circuit/vk to bb.js/noir_js — never trust artifacts served over the network without
 * checking them against the manifest baked into the build.
 */
export function manifestCheck(fetchedSha: string, expectedSha: string): void {
  const fetched = fetchedSha.trim().toLowerCase();
  const expected = expectedSha.trim().toLowerCase();
  if (fetched !== expected) {
    throw new Error(
      `zk manifest mismatch: fetched artifact sha256 ${fetched} does not match expected ${expected}`,
    );
  }
}
