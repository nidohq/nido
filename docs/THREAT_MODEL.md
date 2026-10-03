# Threat model

What Nido protects, against whom, and what it trusts. Companion to
[AUDIT_SCOPE.md](./AUDIT_SCOPE.md) and
[SECURITY_INVARIANTS.md](./SECURITY_INVARIANTS.md); invariant IDs (F1, R3, ...)
refer to the latter.

Recovery's own threat model, by profile, is Perch's
([spec §2](../vendor/perch/docs/recovery/spec.md#2-roles-and-trust)). This
file adds what Nido's contracts, wallet, and infrastructure bring.

## Assets

| Asset | Where it lives | If compromised |
| --- | --- | --- |
| Funds | The user's `perch-account` | Theft. |
| Passkey private key | The user's authenticator; never leaves it | Full control under `Loss`; ordinary activity under `Protected`. |
| Recovery kit (ZK secret) | A JSON file the user downloads | The ZK factor: alone under `ZkOnly`, half of `Combined`. |
| Guardian accounts | Each guardian's own Nido or G wallet | One guardian's share of the quorum. |
| Setup key (salt) | URL fragment, a `nido_setup_<account>` cookie on the parent domain (30 minutes), and the browser's `nido:pending` storage until the account exists | Whoever uses it first owns the address it derives. |
| Factory admin key | Nido operators | The account code and the verifier new accounts get (adversary 8). |
| Relayer keys | Fly.io host | Sponsor budget; censorship. |
| The wallet's deployment (`perch.TESTNET`, or a `PUBLIC_PERCH_DEPLOYMENT` override) | Baked into the wallet at build time | Which factory, controller, pool, adapter, and verifier the wallet tells users to trust (adversary 9). |

## Adversaries

1. **Passkey thief.** Holds the owner's passkey.
   - `Loss`: the thief is the owner. They can change recovery, veto attempts,
     and drain funds. `Loss` assumes the key is lost, not stolen.
   - `Protected`: they can spend outside an authorized window, but cannot
     change recovery, upgrade the account, or block a recovery without the
     enrolled condition (R5, R6, U2). Once an attempt is authorized the account
     authorizes nothing but its completion (R4). Without an enrolled baseline,
     any document change the thief makes invalidates a collecting lost-key
     attempt; compromise recovery from a baseline is the defence (R8). The
     wallet offers the baseline on the settings page; requiring it for
     `Protected` is open product work (#220).
2. **Colluding guardians or a ZK-secret thief.** Indistinguishable from the
   owner's own factor (Perch spec §2). Under `Loss` the owner's veto is never
   capped (R6). `Combined` requires both factors. Every attempt waits out the
   delay before it can complete, which is the owner's window to notice.
3. **Griefer.** Opens attempts without evidence, submits stale evidence, or
   replays proofs. Opening an attempt is permissionless and blocks nothing until
   its condition is met (R1). Proofs bind one statement: account, controller,
   network, epoch, action, and attempt (R2). Nullifiers can't be reserved or
   burned by anyone but a completion (Z3).
4. **Phishing link to a guardian.** Asks a guardian to approve an attempt that
   replaces the owner's passkey with the attacker's. The guardian page
   refuses (offers no Approve button for) a link without the replacement set,
   one whose set doesn't hash to what the attempt bound, and one whose
   credential is checked by any verifier other than the deployment's (W3). It
   shows the new key's ending for the guardian to confirm with their friend
   out of band. The chain cannot tell whose passkey
   a replacement is; Perch's spec puts that check on the guardian.
5. **Setup-key thief.** Reads a salt before the owner deploys and calls
   `create_account(salt, their_key)` first. The salt travels in the URL
   fragment and is scrubbed from the address bar, but during setup it is also
   in a cookie on the parent domain (sent with every request to Nido's
   subdomains, so it reaches the worker and Pages logs if they record
   cookies) and in `nido:pending`, shared with the apex through the storage
   bridge. A second `create_account` with the same salt fails (F2), so
   the risk is a race before the first deploy, not a takeover after.
6. **Script in the wallet origin (XSS, malicious extension, compromised CDN).**
   Can't read the passkey, but can ask the authenticator to sign whatever the
   page builds, read the setup keys in `nido:pending`, and swap the recovery
   kit before download. Mitigations: per-account origins, security headers
   (CSP in report-only, see MAINNET_READINESS E1), and every script bundled at
   build time. Proving downloads Barretenberg's reference string from
   `crs.aztec.network`; a substituted one makes proofs fail to verify.
7. **The passkey verifier.** Every passkey signer names a verifier, and a
   verifier that accepts any signature authorizes anything. Accounts the
   current factory mints name Perch's WebAuthn verifier, which has no admin
   and no upgrade path. Accounts minted by older factories name Nido's former
   verifier, which is admin-upgradeable; for them that admin key stays a trust
   anchor until they move to a new account (DEPLOYED.md, "Retired").
8. **Malicious or compromised factory admin.** Can upgrade the factory to embed
   different account code, or repoint the verifier pin to a verifier that
   accepts anything. This affects only accounts created afterwards; an
   existing account's code changes only through its own seven-day upgrade
   path (U1), and its signers' verifier only through its own `apply_doc`. The
   admin must be a multisig with an upgrade delay users can see
   (MAINNET_READINESS B1).
9. **Wrong deployment.** A wallet built with a hostile deployment would send
   users to an attacker's factory or controller. The account trusts whatever
   controller its own document names, so this is a wallet-supply-chain risk.
   The committed `perch.TESTNET` is checked field by field against Perch's
   manifest (`deployment.test.ts`), and Perch's `verify-deployment.sh` checks
   that manifest against the chain by hash and content address. A
   `PUBLIC_PERCH_DEPLOYMENT` override bypasses the first check.
10. **Compromised relayer.** Can refuse or delay transactions and spend its
    sponsor budget. It can't forge authorization: every transaction it submits
    already carries the account's signed auth entries. It sponsors any call
    with valid auth, not only Nido's (AGENTS.md, "Relayer channels plugin").
    An unavailable relayer blocks onboarding, which only it sponsors; on
    2026-10-03 the testnet relayer refused every account setup ("Too many
    transactions queued") while its health check passed.
11. **Storage expiry.** Recovery state lives in persistent storage. An expired
    entry is archived, never silently reset (T1), but a recovery transaction
    that must restore everything at once exceeds the write limit (T2). Anyone
    can renew it; nobody is paid to.
12. **Supply-chain attacker.** Swaps a dependency, the Perch submodule, or the
    proving toolchain. See [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md).
13. **Proof analysis.** The adapter verifies non-ZK UltraHonk proofs
    (`UltraKeccakFlavor`, the flavor the audited verifier supports), and
    proving is deterministic. The proofs are sound, but Perch makes no claim
    that they hide the witness. Every ZK-backed completion rotates the
    enrollment (Perch spec §11), so a secret is retired once the attempt it
    proved completes. Initiation proofs for attempts that never complete, and
    cancellation, reconfiguration, and upgrade proofs, leave the secret in use
    after their proof is on chain. Whether a published proof leaks
    anything about the secret is a question for the ZK review
    ([AUDIT_SCOPE.md](./AUDIT_SCOPE.md)); until it is answered, the wallet
    could prompt for a new kit after such a proof.

## Trusted

- The Stellar network: consensus, RPC, and the host's secp256r1, SHA-256,
  BN254, and Poseidon2 functions.
- The host's CAP-0071 delegated-auth and invoker-auth behaviour, as pinned by
  Perch's tests ([cap-0071.md](../vendor/perch/docs/recovery/cap-0071.md)).
- The OZ `stellar-accounts` fork at the pinned revision: `do_check_auth`,
  context rules, nonces.
- Perch's controller, pool, adapter, compiler, and policies behave as their
  source says. None has an admin or an upgrade entry point (spec §16 states
  it for the controller, adapter, verifier, and pool; the code shows it for
  the rest), so this is trust in code at a content-addressed address, not in
  a party.
- The user's authenticator keeps the private key non-exportable, and the
  browser enforces the RP ID.
- Nido's operators, through the factory admin key, until it sits behind a
  multisig and delay.

## Out of scope

- Losing both the passkey and every recovery factor.
- A thief who holds the passkey and every factor of the enrolled condition.
- Device theft together with the device's unlock.
- Stellar consensus or host-function bugs; browser or OS compromise.
- Hiding which accounts use ZK recovery (Perch epic #99 non-goal).
