// Describes what a `/account/?sign=<hash>` request actually does, so the
// "Approve this request" surface can show the user the *intent* (e.g. claiming a
// name) instead of only a raw auth-digest hash.
//
// The surface receives just the hash, so on its own it cannot tell a name claim
// apart from any other dApp signature request. The name-claim flow, however, is
// first-party and same-origin: it stashes the name it is about to claim AND the
// exact hash it computed in localStorage before redirecting here. We recognize a
// claim by matching the incoming hash against that stored hash — that match is
// what makes the friendly "claiming <name>" copy *trustworthy*: it is bound to
// the precise payload being signed, and the stored record can only have been
// written by our own code on this origin. A forged or mismatched hash falls back
// to the generic (hash-only) display, so no misleading summary can be injected.

export interface SignRequestInput {
  /** The auth-digest hex the user is being asked to sign (`?sign=` param). */
  signHash: string;
  /** Hex hash stashed by the name-claim flow, or null if none is pending. */
  claimHash: string | null;
  /** Name the pending claim is for, or null if none is pending. */
  claimName: string | null;
}

export type SignRequestSummary =
  | { kind: "name-claim"; name: string }
  | { kind: "generic" };

function normalizeHash(hash: string): string {
  return hash.trim().toLowerCase();
}

export function describeSignRequest(input: SignRequestInput): SignRequestSummary {
  const { signHash, claimHash, claimName } = input;
  if (!claimHash || !claimName) return { kind: "generic" };

  const incoming = normalizeHash(signHash);
  // Never treat a blank hash as a match — both sides being empty must not
  // masquerade as a recognized claim.
  if (!incoming) return { kind: "generic" };

  if (incoming === normalizeHash(claimHash)) {
    return { kind: "name-claim", name: claimName };
  }
  return { kind: "generic" };
}
