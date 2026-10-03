/**
 * Which Perch deployment this build talks to.
 *
 * Perch's release workstream (stellar-registry/perch#99 WS4) publishes the
 * testnet manifest. Until then a build can point at one with
 * `PUBLIC_PERCH_DEPLOYMENT` (the manifest as JSON, the shape of
 * `perch.PerchDeployment`); without it every recovery page says recovery is
 * not available on this network yet instead of guessing addresses.
 */

import { perch } from '@nidohq/passkey-sdk';

let cached: perch.PerchDeployment | undefined | null = null;

export function perchDeployment(): perch.PerchDeployment | undefined {
  if (cached !== null) return cached;
  const raw = import.meta.env.PUBLIC_PERCH_DEPLOYMENT as string | undefined;
  cached = raw ? perch.parsePerchDeployment(JSON.parse(raw)) : perch.PENDING_TESTNET;
  return cached;
}

export function requireDeployment(): perch.PerchDeployment {
  return perch.requirePerchDeployment(perchDeployment());
}
