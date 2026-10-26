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
[Perch recovery spec §2](https://github.com/stellar-registry/perch/blob/2258433aa340428d65676cd269c8e4240674deb1/docs/recovery/spec.md#2-roles-and-trust)
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
| Setup secret (the setup key's seed, carried as `salt`) | URL fragment, a `nido_setup_<account>` cookie on the parent domain (30 minutes), and the browser's `nido:<network>:pending` storage until the account exists. The relayer sees only the setup PUBLIC key and the setup key's signature over the user's passkey | Whoever holds it can bind its own passkey to the address first (F6 stops everyone else). The wallet then refuses that address rather than activate or fund it (W11), so the owner loses the address, not funds. |
| Factory admin key | Nido operators | The account code and the verifier new accounts get, once a scheduled change waits out the factory's delay (adversary 8). |
| Relayer keys | Fly.io host | Sponsor budget; censorship; claiming, and so denying, accounts that are being set up (adversary 10). |
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
   A link asking a guardian to approve a reconfiguration is checked against
   its config hash, then shown setting by setting next to the current one,
   with any new controller, proof checker, pool, circuit, friend, or kit
   called out; Approve signs the hash of exactly those settings (W2).
5. **Setup-key thief.** Reads the setup secret before the owner deploys,
   signs its own passkey with it, and calls `create_account` first. The
   secret travels in the URL fragment and is scrubbed from the address bar,
   but during setup it is also in a cookie on the parent domain (sent with
   every request to Nido's subdomains, so it reaches the worker and Pages
   logs if they record cookies) and in `nido:<network>:pending`, which the storage
   bridge shares with that account's own origin and no other (adversary 15).
   A second `create_account` with the same setup key fails (F2), so the risk
   is a race before the first deploy, not a takeover after. The wallet
   detects a won race before it activates or funds the address (W11); the
   race itself remains, as a denial of setup. Seeing the setup public key is
   not enough: the factory deploys only the passkey the setup key signed
   (F6), so the relayer (adversary 10) and the manager can't race. See L5.
6. **Script in the wallet origin (XSS, malicious extension, compromised CDN).**
   Can't read the passkey, but can ask the authenticator to sign whatever the
   page builds, read the setup keys in `nido:<network>:pending`, and swap the recovery
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
8. **Malicious or compromised factory admin.** Can upgrade the factory to
   pin different account code, pin a verifier that accepts anything, set
   a manager that admits no one (or anyone), or hand the factory to another
   admin. The factory makes each change at once and announces it
   (`upgraded`, `verifier_pinned`, `manager_changed`, `admin_changed`;
   SECURITY_INVARIANTS F4). It affects only accounts created afterwards; an
   existing account's code changes only through its own seven-day upgrade
   path (U1), and its signers' verifier only through its own `apply_doc`.
   The admin can't change whose passkey a new account gets (F6). The
   factory itself enforces no delay: on mainnet the admin is a smart account
   that enforces a 24-hour delay between announcing a factory change and
   making it, and lets its own signers cancel (MAINNET_READINESS B1,
   RUNBOOKS §3), which gives watchers and wallets time to stop creating
   accounts through this factory. Pinning the verifier does not limit this
   admin either: it can repin, or upgrade the wasm and the pin together. The
   mitigations are the admin account's delay and quorum, and someone
   watching the factory's events. The deployed testnet factory's admin is a
   single key, it has no delay at all, and nothing watches its events.
9. **Wrong deployment.** A wallet built with a hostile deployment would send
   users to an attacker's factory or controller. The account trusts whatever
   controller its own document names, so this is a wallet-supply-chain risk.
   The committed `perch.TESTNET` is checked field by field against Perch's
   manifest (`deployment.test.ts`, W6), and Perch's `verify-deployment.sh`
   checks that manifest against the chain by hash and content address. A
   `PUBLIC_PERCH_DEPLOYMENT` override bypasses the first check
   (MAINNET_READINESS A1). The deployment decides where new enrollments go.
   For an enrolled account the wallet uses the controller the account
   adopted, not the deployment's (see
   [Several Perch generations](#several-perch-generations)).
10. **Compromised relayer.** Can refuse or delay transactions and spend its
    sponsor budget. For an existing account it can't forge authorization:
    every transaction it submits already carries the account's signed auth
    entries. It sponsors any call with valid auth, not only Nido's
    (`infra/relayer/plugins/channels/index.ts` passes every request to the
    upstream channels handler).

    **An account being set up.** `create_account(setup_pk, key, setup_sig)`
    derives the address from the setup public key alone, because a Nido
    passkey's RP ID is that address and it has to exist before the passkey.
    The relayer receives the setup transaction before it lands, but sees
    only the setup public key and the setup key's signature over the user's
    passkey, for this factory and network. It can't bind its own key to the
    address: the factory refuses any passkey the setup key did not sign
    (F6). It can withhold or delay the setup, which a user answers by
    trying another relayer or starting again. On a factory with a manager
    whose signer the relayer holds, it also decides admission: it can admit
    accounts it shouldn't, and refuse anyone (F7).

    A factory that predates the binding (the testnet factory deployed today,
    DEPLOYED.md) lets anyone who sees the setup value create that account
    with its own key first. For those, and for a thief holding the setup
    secret (adversary 5), the wallet detects the claim. It does not take the
    relayer's confirmation as proof of what landed: after setup, and
    whenever it resumes a setup whose address already holds a contract, it
    reads the account from RPC (not through the relayer) and accepts it only
    as the account the user's own `create_account` creates: the deployment's
    account wasm, untouched since construction, with the user's passkey
    under the deployment's verifier as its only rule (W11). Anything else
    stops setup before the account is activated, shown as ready, or funded,
    and tells the user to start again with a new address. A key check alone
    would not be enough: a claimant can apply a document naming the user's
    key as admin while keeping its own authority elsewhere (RUNBOOKS §5),
    which the untouched-account requirement refuses. RUNBOOKS §5 gives the
    response to a host compromise.

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
    ([Perch ZK README](https://github.com/stellar-registry/perch/blob/2258433aa340428d65676cd269c8e4240674deb1/docs/zk/README.md)
    (`vendor/perch/docs/zk/README.md`); MAINNET_READINESS D5). Until then,
    recovery's ZK factor rests on that unaudited code.
14. **Malicious dApp or link.** Anyone can send the user a link into their
    own account's wallet pages, or open `/sign/` from a dApp, with whatever
    parameters they like. The requesting dApp's origin is itself only a URL
    parameter, so "a trusted dApp asks" can be claimed by any page; the
    wallet shows it as the requester, never as proof. What the wallet will
    sign for such a request:
    - **No own-action framing from a link.** Wallet-built requests ("Claim a
      name", "Grant an app a session key") are framed as the user's own
      action. The account page's only link-triggered one is `?claim=<name>`,
      a name registration validated against the name grammar and rendered as
      one. Anything else from outside, including the status-message demo,
      reaches `/sign/` as a dApp request under the requester's origin.
    - **Transactions: the whole authorization tree.** `/sign/` simulates the
      dApp's transaction and renders every call the account would authorize,
      sub-calls included, not just the top-level call. The ceremony signs only
      the tree that was shown, and refuses when a fresh simulation yields a
      different one. It refuses any tree that calls the account itself
      (`apply_doc`, `execute`, `schedule_upgrade`, …: those change who
      controls the account or move its funds through its own entry points,
      and only Nido's own pages build them) or deploys a contract in its name
      (`packages/frontend/src/lib/signing/authReview.ts`).
    - **Authorization entries (`kind=authEntry`).** The passkey signs these
      under the admin rule, and the result is a bearer authorization: whoever
      holds it can use it in any transaction until it expires. The wallet
      signs only a Soroban authorization preimage for its own network,
      expiring within 720 ledgers (about an hour), whose tree passes the same
      rules; the page shows the tree and says what the signature allows and
      until when.
    - **Network.** A request naming any other network passphrase is refused.
    - **Grants.** The grant card describes each contract-scoped rule the
      request adds or changes, one card per rule; a request that changes an
      account-scoped rule after the first apply, removes a rule, changes
      nothing, grants more rules than one request carries, or grants rules
      for different keys or with different expiries is refused
      (`packages/frontend/src/lib/policy/grantReview.ts`).

    Every signing page is unframeable (`X-Frame-Options: DENY`). What
    remains is the user's judgement: a tree of calls on other contracts (a
    token transfer, a swap) is approved on the dApp's word, and the dApp's
    claimed origin is unauthenticated.
15. **Script on a sibling origin under the apex.** The apex's storage bridge
    holds every account's setup key in `nido:<network>:pending` and the account list
    every origin's switcher shows. Pages that share the apex but are not this
    account's wallet — the built-in status-message dApp, the relayer's host,
    any future service on `*.nido.fyi`, or a network attacker serving one of
    them over plain http — must not read those keys or plant entries. Every
    response carries `Strict-Transport-Security` with `includeSubDomains`.
    The bridge page alone may be framed, under an enforced
    `frame-ancestors https://*.nido.fyi`, and its handler answers only a
    message from the window embedding it, from an https origin one label
    below the apex whose label is a valid contract address or name-shaped
    (the built-in dApps and `relay` excluded). It returns the account list,
    cached names, and at most one setup key, the requester's own; it accepts
    only the requester's own entries; ids are checked as contract StrKeys and
    escaped where rendered (`packages/frontend/src/lib/nidoSharedStorage.ts`,
    `public/_headers`, `frontend/worker-proxy-nido/index.js`;
    `tests/e2e/ui/storage-bridge.spec.ts` runs it under the production
    headers). A name-shaped label is indistinguishable from a registered
    name's wallet origin and the registry reserves no labels, so a service
    on one can read the account list and names, though no setup key. HSTS
    protects only after a first https visit; the domain is not preloaded.

## Several Perch generations

Every Perch redeploy puts the recovery controller, pool, and adapter at new
addresses with empty state, and none of the old ones can be upgraded or
removed (§16). An existing account keeps the stack it enrolled with, because
it calls the controller its own document names (§10). So testnet runs
several generations at once, and mainnet will after any Perch fix to those
contracts.

- **The wallet follows the account.** Recovery reads (attempts, the freeze,
  the epoch, statements) and every controller call (`begin_*`, `submit_*`,
  `approve_change`, `publish_baseline`) go to the controller the account
  adopted (`configuration()`'s `recovery_controller`). A completion's target
  is derived by the compiler the account pins, and proofs use the pool its
  enrolled ZK factor names (`perch.PerchRecovery`, `RecoveryWiring`). A
  wallet that used the deployment's controller instead would show a `Loss`
  owner no attempt to veto. It would also send guardians' approvals to a
  controller that has no record of the account.
- **Moving is the owner's choice.** `/security/recovery/` offers to move
  recovery to the deployment's stack, keeping every setting
  (`perch.movedRecovery`), through the ordinary `apply_doc` flow. The
  controller being left evaluates the switch as a reconfiguration (§10,
  "Remove or switch away"). Under `Protected` the switch needs the enrolled
  condition recorded at that controller, so a passkey thief cannot move
  recovery alone. Under `Loss` the owner alone moves it, as they could remove
  it. A ZK factor on an earlier pool moves only with a new credential (§3.4):
  the move makes a new recovery kit, and the old kit stops working. The page
  reads the published baseline at the old controller and publishes the same
  bytes at the new one.
- **Guardians hold one rule per controller.** A Nido guardian approves
  through a rule its document scopes to the guarded account's controller:
  `guardian`, then `guardian-<start of the address>` for each further one.
  Adding a rule never removes another, so a guardian can approve for
  accounts on different generations.
- **A link can name any controller.** The guardian page reads the controller
  from the account the link names, and anyone can create an account whose
  document names a contract of their own as its controller. A link for such
  an account asks the guardian to add a rule scoped to that contract. The
  rule lets the guardian's signers authorize calls to that one contract,
  each with a passkey tap. It reaches no other contract, and not the
  guardian's own account, which only its admin rule governs. The page shows
  the controller's full address, and says so when it is not the one Nido sets
  up today. A victim's account always names the controller its owner
  adopted, so such a link cannot affect the victim's recovery.
- **Each generation is its own code.** A fix in a later Perch release
  reaches an account only when its owner moves. Renewing recovery state
  (RUNBOOKS §6) targets each account's own controller and pool.

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
- **L5. Only the holder of the setup secret can claim an address being set
  up.** The factory binds each address to its setup key and deploys only
  the passkey that key signed (F6), so the relayer, a mempool watcher, or
  the manager can't claim it (nidohq/nido#245). A thief who reads the
  secret from the browser before the passkey exists (adversary 5) can, and
  the wallet then refuses the address before activating or funding it
  (W11): the user loses the address and the passkey made for it, not funds.
  The check trusts the RPC endpoint it reads. The deployed testnet factory
  predates the binding, so there anyone who sees the setup value can claim
  the address, and only W11 stands. Invariants: F2 (no takeover after the
  first deploy), F6 (the binding), W5 (the secret stays out of query
  strings), W11 (the check). Gates: MAINNET_READINESS A6 (detection), A7
  (prevention); A2 covers only query-string exposure.
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
  ([Perch CAP-0071 notes](https://github.com/stellar-registry/perch/blob/2258433aa340428d65676cd269c8e4240674deb1/docs/recovery/cap-0071.md)
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
- Nido's operators, through the factory admin. The factory makes each admin
  change at once; the delay and quorum are the admin smart account's, and
  on testnet the admin is a single key (MAINNET_READINESS B1).

## Out of scope

- Losing both the passkey and every recovery factor.
- A thief who holds the passkey and every factor of the enrolled condition.
- Device theft together with the device's unlock.
- Stellar consensus or host-function bugs; browser or OS compromise.
- Hiding which accounts use ZK recovery (outside Perch's scope, §1).
