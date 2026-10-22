/**
 * Which Perch deployment this build talks to: `PUBLIC_PERCH_DEPLOYMENT`
 * overrides it, with a manifest as JSON (the shape of `perch.PerchDeployment`)
 * or `none`. With `none` every recovery page says recovery is not available
 * on this network (the fast UI tier builds that way, so it never reaches a
 * chain). Unset, the default depends on `NETWORK_NAME`: testnet builds use
 * Perch's testnet release (`perch.TESTNET`); mainnet builds have no default —
 * there is no `perch.MAINNET` yet (no mainnet contracts exist), so an
 * unset override fails loud (`undefined`, same as `none`) rather than
 * silently pointing a mainnet-labeled build at testnet contracts. Once
 * mainnet contracts exist, point the mainnet build's `PUBLIC_PERCH_DEPLOYMENT`
 * at the real manifest JSON (same mechanism this file already supports for
 * the e2e fixture build) — no code change needed here.
 */

import { perch } from '@nidohq/passkey-sdk';
import { NETWORK_NAME } from '../network';

let cached: perch.PerchDeployment | undefined | null = null;

export function perchDeployment(): perch.PerchDeployment | undefined {
  if (cached !== null) return cached;
  const raw = import.meta.env.PUBLIC_PERCH_DEPLOYMENT as string | undefined;
  if (raw === 'none') {
    cached = undefined;
  } else if (raw) {
    cached = perch.parsePerchDeployment(JSON.parse(raw));
  } else {
    cached = NETWORK_NAME === 'testnet' ? perch.TESTNET : undefined;
  }
  return cached;
}

export function requireDeployment(): perch.PerchDeployment {
  return perch.requirePerchDeployment(perchDeployment());
}
