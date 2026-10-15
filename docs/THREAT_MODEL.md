# Threat model

What Nido protects, against whom, what it trusts, and where the audited
behaviour stops protecting. Companion to [AUDIT_SCOPE.md](./AUDIT_SCOPE.md)
and [SECURITY_INVARIANTS.md](./SECURITY_INVARIANTS.md). A bare ID (F2, R3,
...) is an invariant in SECURITY_INVARIANTS; a release gate is written as
"Gate" or "MAINNET_READINESS" with its checklist ID in
[MAINNET_READINESS.md](./MAINNET_READINESS.md).
[STRIDE_THREAT_MODEL.md](./STRIDE_THREAT_MODEL.md) indexes every threat below
by STRIDE category with its release gate and status; this file holds the
analysis.

Recovery's own threat model, by profile, is Perch's:
[Perch recovery spec §2](https://github.com/stellar-registry/perch/blob/603f7d5504f2d4d9338c135771cea18ac70dbe0c/docs/recovery/spec.md#2-roles-and-trust)
(`vendor/perch/docs/recovery/spec.md`). "§" and "D" numbers below are that
spec's sections and decisions. This file adds what Nido's contracts, wallet,
and infrastructure bring.

## Assets

| Asset | Where it lives | If compromised |
| --- | --- | --- |
| Funds | The user's `perch-account` | Theft. |
| Passkey private key | The user's authenticator; never leaves it | Full control under `Loss`; ordinary activity under `Protected`. |
| Recovery kit (ZK secret) | A JSON file the user downloads | The ZK factor: alone under `ZkOnly`, half of `Combined`. |
| Guardian accounts | Each guardian's own Nido or G wallet | One guardian's share of the quorum. |
| Setup key (salt) | URL fragment, a `nido_setup_<account>` cookie on the parent domain (30 minutes), and the browser's `nido:pending` storage until the account exists; the relayer sees it in the setup transaction | Whoever uses it first owns the address it derives. |
| Factory admin key | Nido operators | The account code and the verifier new accounts get (adversary 8). |
| Relayer keys | Fly.io host | Sponsor budget; censorship; claiming accounts that are being set up (adversary 10). |
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
     attempt; compromise recovery from a baseline is the defence (R8), and the
     baseline is optional (L1).
2. **Colluding guardians or a ZK-secret thief.** Indistinguishable from the
   owner's own factor (§2). Under `Loss` the owner's veto is never capped
   (R6). `Combined` requires both factors. Every attempt waits out the delay
   before it can complete, which is the owner's window to notice.
3. **Griefer.** Opens attempts without evidence, submits stale evidence, or
   replays proofs. Opening an attempt is permissionless and blocks nothing until
   its condition is met (R1). Proofs bind one statement: account, controller,
   network, epoch, action, and attempt (R2). There are no nullifier
   reservations: only a completion spends a nullifier, and nothing un-spends
   one (Z3).
4. **Phishing link to a guardian.** Asks a guardian to approve an attempt that
   replaces the owner's passkey with the attacker's. The guardian page
   refuses (offers no Approve button for) a link without the replacement set,
   one whose set doesn't hash to what the attempt bound, and one whose
   credential is checked by any verifier other than the deployment's (W3). It
   shows the new key's ending for the guardian to confirm with their friend
   out of band. The chain cannot tell whose passkey a replacement is; Perch's
   spec puts that check on the guardian (§2).
5. **Setup-key thief.** Reads a salt before the owner deploys and calls
   `create_account(salt, their_key)` first. The salt travels in the URL
   fragment and is scrubbed from the address bar, but during setup it is also
   in a cookie on the parent domain (sent with every request to Nido's
   subdomains, so it reaches the worker and Pages logs if they record
   cookies) and in `nido:pending`, shared with the apex through the storage
   bridge. A second `create_account` with the same salt fails (F2), so
   the risk is a race before the first deploy, not a takeover after. The
   relayer sees every salt (adversary 10). See L5.
6. **Script in the wallet origin (XSS, malicious extension, compromised CDN).**
   Can't read the passkey, but can ask the authenticator to sign whatever the
   page builds, read the setup keys in `nido:pending`, and swap the recovery
   kit before download. Mitigations: per-account origins, security headers
   (the CSP is report-only, MAINNET_READINESS E1), and every script bundled at
   build time. Proving downloads Barretenberg's reference string from
   `crs.aztec.network`; a substituted one makes proofs fail to verify
   (MAINNET_READINESS E4).
7. **The passkey verifier.** Every passkey signer names a verifier, and a
   verifier that accepts any signature authorizes anything. Accounts the
   current factory mints name Perch's WebAuthn verifier, which has no admin
   and no upgrade path (`perch-webauthn-verifier` is constructorless and
   stateless); accounts from earlier Perch-era factories name earlier Perch
   deployments of that verifier. Testnet accounts minted by
   pre-Perch factories name Nido's former verifier, which is
   admin-upgradeable; for them that admin key stays a trust anchor until they
   move to a new account (DEPLOYED.md, "Compatibility appendix"). None of
   these legacy contracts deploys to mainnet.
8. **Malicious or compromised factory admin.** Can upgrade the factory to embed
   different account code, or repoint the verifier pin to a verifier that
   accepts anything. This affects only accounts created afterwards; an
   existing account's code changes only through its own seven-day upgrade
   path (U1), and its signers' verifier only through its own `apply_doc`.
   Pinning the verifier does not limit this admin: the pin is
   admin-settable (`set_registry_pins`), and `upgrade` replaces the factory
   wasm, embedded account code included. Only governance over the upgrade
   authority mitigates it: a multisig with an upgrade delay users can see,
   or no upgrade authority at all (MAINNET_READINESS B1).
9. **Wrong deployment.** A wallet built with a hostile deployment would send
   users to an attacker's factory or controller. The account trusts whatever
   controller its own document names, so this is a wallet-supply-chain risk.
   The committed `perch.TESTNET` is checked field by field against Perch's
   manifest (`deployment.test.ts`, W6), and Perch's `verify-deployment.sh`
   checks that manifest against the chain by hash and content address. A
   `PUBLIC_PERCH_DEPLOYMENT` override bypasses the first check
   (MAINNET_READINESS A1).
10. **Compromised relayer.** Can refuse or delay transactions and spend its
    sponsor budget. For an existing account it can't forge authorization:
    every transaction it submits already carries the account's signed auth
    entries. It sponsors any call with valid auth, not only Nido's
    (`infra/relayer/plugins/channels/index.ts` passes every request to the
    upstream channels handler).

    **An account being set up is the exception.** `create_account(salt, key)`
    is permissionless, and the address derives from the salt alone, because
    a Nido passkey's RP ID is that address and it has to exist before the
    passkey. The relayer receives the setup transaction, salt included,
    before it lands. A compromised relayer can submit
    `create_account(salt, its_own_key)` first and own the address the user's
    passkey was made for; the user's own call then fails as a reused salt
    (F2). Nothing in the code prevents or detects this at this revision: the
    wallet doesn't check the new account's admin key before trusting it or
    moving the testnet funding into it. It is a known risk, tracked with the
    candidate mitigations in nidohq/nido#245 (a wallet check of the admin
    key, or a factory commitment to the key before the salt is revealed).
    Launch gate MAINNET_READINESS A6 requires one of them.
    RUNBOOKS §5 gives the response to a host compromise.

    An unavailable relayer blocks onboarding, which only it sponsors, and a
    passing health check does not show that onboarding works: the hosted
    relayer has refused account setups while passing it, for a cause still
    open (RUNBOOKS §5, MAINNET_READINESS D7).
11. **Storage expiry.** Durable recovery state (configuration, counters,
    enrollment/revocation/nullifier records, persistent attempt records) lives
    in persistent storage: an expired entry is archived, never silently reset
    (T1). Collecting attempts in temporary storage are the exception — they
    carry a TTL of at least their evidence window and simply expire (spec §3.6,
    §6.2). A recovery transaction
    that must restore everything at once exceeds the write limit (T2), so
    restoration runs in separate transactions first. Anyone can renew the
    state; nobody is paid to, and the wallet does not renew it or run the
    explicit restoration workflow, though automatic restoration can still
    succeed (L6, D1).
12. **Supply-chain attacker.** Swaps a dependency, the Perch submodule, or the
    proving toolchain. See [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md).
13. **The ZK verifier.** Proofs are Barretenberg's zero-knowledge flavor
    (`UltraKeccakZKFlavor`), so a published proof hides the secret, and the
    adapter refuses any other flavor. The verifier is NethermindEth's audited
    UltraHonk verifier plus Perch's delta for that flavor (one new file and
    visibility-only changes). **The delta is not audited**; Perch lists its
    audit as a release criterion
    ([Perch ZK README](https://github.com/stellar-registry/perch/blob/603f7d5504f2d4d9338c135771cea18ac70dbe0c/docs/zk/README.md)
    (`vendor/perch/docs/zk/README.md`); MAINNET_READINESS D5). Until then,
    recovery's ZK factor rests on that unaudited code.

## Limits within the audited behaviour

These hold at the audited revision. Each names the adversary it widens, the
invariants that bound it, its release gate, and, where the change is
post-audit work, its entry in [DEFERRED.md](./DEFERRED.md).

- **L1. `Protected` without a baseline does not give the same compromise
  protection.** The baseline is optional (§3.5); the wallet offers it as a
  checkbox on `/security/recovery/`. Without one, a thief holding the passkey
  can invalidate every collecting lost-key attempt by changing the document
  (§6.3, T4), and only compromise recovery, which restores a baseline, is
  immune to that. Adversary 1. Invariants: R7, R8. Gate: D2.
- **L2. The freeze blocks new account authorizations, not allowances already
  granted.** While a `Protected` attempt is authorized, the account
  authorizes nothing new on any path. A token allowance, or an approval
  another contract stored, that the account granted earlier stays usable by
  its holder, and no account code can revoke it (§9, "What the freeze cannot
  reach"). Adversary 1. Invariant: R4 (new authorizations only). Gate: E7.
- **L3. Replacing a spending policy resets its window.** A capped rule that an
  apply leaves unchanged, or edits in place without touching its spending
  limit, keeps the limit's state. Replacing the rule (it gets a new id), or
  changing the spending limit's install parameters (the limit or its period),
  reinstalls the policy with a fresh window (§7.5). The same holds for a
  compromise recovery: where restoring the baseline replaces a capped rule or
  changes its cap, the baseline's signers on that rule get a fresh window. A
  cap is a per-window limit on the rule as installed, not a budget that
  persists across document changes. Adversaries 1 and 2. Invariant: A5 (installation only;
  no Nido test pins the reset). Gate: E7. Deferred:
  [persistent spending budgets](./DEFERRED.md#persistent-spending-budgets-across-replacements).
- **L4. Revision checks apply to document writes, not ordinary
  transactions.** `apply_doc` with `expected_revision` refuses a document
  prepared at another revision (A8). An ordinary transaction's signature
  binds the invocation and the selected rule ids, not a revision (§15,
  "Revision binding"). A transaction signed before its rule was removed or
  replaced fails closed (`ContextRuleNotFound`); one whose rule was edited in
  place keeps the rule id and, until its `signature_expiration_ledger`,
  executes under the rule as it is at inclusion, not as it was when signed.
  Whoever holds a signed, unsubmitted transaction (a dApp, the relayer) can
  submit it after the owner changes that rule. Invariants: A8, W10. Gate:
  none; this is the audited semantics. Deferred:
  [revision-bound ordinary signatures](./DEFERRED.md#revision-bound-ordinary-signatures).
- **L5. The setup-salt race is unresolved.** Whoever submits `create_account`
  with a salt first owns the address, and the wallet does not check the
  created account's admin key before using or funding it (adversaries 5 and
  10, nidohq/nido#245). Invariants: F2 (no takeover after the first deploy),
  W5 (the salt stays out of query strings). Gate: MAINNET_READINESS A6
  (open); A2 covers only query-string exposure.
- **L6. The wallet lacks the archived-state restoration and renewal
  workflow.** On chain, archived recovery state is restored, never reset
  (T1), and renewal is permissionless (T2). The wallet does not implement the
  explicit restoration workflow (reading a `restorePreamble`, submitting a
  `RestoreFootprint`) or scheduled renewal; automatic restoration can still
  succeed when a recovery transaction's simulation marks its entries for it and
  the result fits the write limit (MAINNET_READINESS D1). RUNBOOKS §6 gives the
  manual procedure for the explicit case. Until then, a user whose recovery
  state expired in a way that needs an explicit restore cannot recover through
  the wallet alone.
  Adversary 11. Invariants: T1, T2. Gates: D1, D3.

## Trusted

- The Stellar network: consensus, RPC, and the host's secp256r1, SHA-256,
  BN254, and Poseidon2 functions.
- The host's CAP-0071 delegated-auth and invoker-auth behaviour, as pinned by
  Perch's tests
  ([Perch CAP-0071 notes](https://github.com/stellar-registry/perch/blob/603f7d5504f2d4d9338c135771cea18ac70dbe0c/docs/recovery/cap-0071.md)
  (`vendor/perch/docs/recovery/cap-0071.md`)).
- The OZ `stellar-accounts` fork at the pinned revision: `do_check_auth`,
  context rules, nonces.
- Perch's WebAuthn verifier, controller, pool, adapter, compiler, and
  policies behave as their source says. None has an admin or an upgrade
  entry point (§16 states it for the controller, adapter, and pool; the code
  shows it for the rest), so this is trust in code at a content-addressed
  address, not in a party.
- The user's authenticator keeps the private key non-exportable, and the
  browser enforces the RP ID.
- Nido's operators, through the factory admin key, until it sits behind a
  multisig and delay.

## Out of scope

- Losing both the passkey and every recovery factor.
- A thief who holds the passkey and every factor of the enrolled condition.
- Device theft together with the device's unlock.
- Stellar consensus or host-function bugs; browser or OS compromise.
- Hiding which accounts use ZK recovery (outside Perch's scope, §1).
