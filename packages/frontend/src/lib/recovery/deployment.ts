/**
 * Which Perch deployment this build talks to: Perch's testnet release
 * (`perch.TESTNET`) unless `PUBLIC_PERCH_DEPLOYMENT` overrides it, with a
 * manifest as JSON (the shape of `perch.PerchDeployment`) or `none`. With
 * `none` every recovery page says recovery is not available on this network
 * (the fast UI tier builds that way, so it never reaches a chain).
 */

import { perch } from '@nidohq/passkey-sdk';

let cached: perch.PerchDeployment | undefined | null = null;

export function perchDeployment(): perch.PerchDeployment | undefined {
  if (cached !== null) return cached;
  const raw = import.meta.env.PUBLIC_PERCH_DEPLOYMENT as string | undefined;
  cached = raw === 'none' ? undefined : raw ? perch.parsePerchDeployment(JSON.parse(raw)) : perch.TESTNET;
  return cached;
}

export function requireDeployment(): perch.PerchDeployment {
  return perch.requirePerchDeployment(perchDeployment());
}
