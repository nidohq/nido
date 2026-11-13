import { Buffer } from 'buffer';
const hexHash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const checks = ['exact-intent-xdr', 'perch-addr-oz-v1', 'p256-passkey', 'wallet-rp-origin-uv', 'cedar-fee-policy'];

// Only the trusted wallet constructs this capability. Neither callback nor this
// object is attached to window/postMessage. It grants one attempt per request ID
// in this instance, including concurrent calls and failed attempts; not durable replay protection.
export function createSigningBoundary(evaluate, unlockAndSign) {
  const consumed = new Set();
  return Object.freeze({
    async sign(input) {
      const encoded = JSON.stringify(input); // immutable snapshot before any await
      const snapshot = JSON.parse(encoded);
      if (typeof snapshot.requestId !== 'string' || !snapshot.requestId || consumed.has(snapshot.requestId)) throw Error('Request already consumed or invalid');
      consumed.add(snapshot.requestId);
      const inputHash = await hexHash(new TextEncoder().encode(encoded));
      const envelopeHash = await hexHash(Buffer.from(snapshot.envelope, 'base64'));
      const decision = await evaluate(encoded);
      if (decision?.version !== 1 || decision.allowed !== true || decision.requestId !== snapshot.requestId ||
          decision.inputHash !== inputHash || decision.facts?.envelopeHash !== envelopeHash ||
          JSON.stringify(decision.facts?.checks) !== JSON.stringify(checks) ||
          !Number.isSafeInteger(decision.facts?.feeStroops) || decision.facts.feeStroops <= 0 ||
          decision.facts.feeStroops > (snapshot.intent?.kind === 'local-budget-action' ? 500000 : 1000))
        throw Error('WASI refused: ' + (decision?.reason || 'unbound or malformed decision'));
      // No caller-supplied replacement envelope can enter after the decision.
      return unlockAndSign(snapshot.envelope, snapshot.feeAccount, decision);
    },
  });
}
