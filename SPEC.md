# Nido permanent G-account MVP

Status: implementation plan; no functionality or proofs described as proposed below are implemented by this document.

Date: 2026-11-10.

Primary product: Nido. First network: Stellar testnet. First custody adapter: Turnkey.

## 1. Objective and release decisions

Add an optional classic Stellar account to Nido. A user receives one stable G-address, signs locally after unlocking a passkey, can obtain fee sponsorship without a transaction relayer, and can replace a lost local signer through an enrolled recovery process. Changing signers does not move the user's balances to a new account.

Nido remains the reference product for reusable wallet, policy, recovery and custody components. Existing Perch C-accounts remain supported through their existing account adapter and infrastructure.

The MVP is an invite-only testnet release with the following decisions:

| Decision | MVP choice |
| --- | --- |
| Account identity | A separately generated bootstrap public key defines the permanent G-address. |
| Daily authority | Self-directed: local signer U has weight 2; service signer S and recovery signer R each have weight 1. All thresholds are 2; master weight is 0 after activation. |
| Passkey use | WebAuthn PRF unlocks an encrypted, randomly generated Ed25519 signer secret U. |
| Recovery authority | S + R replace U. R is a separate offline recovery secret controlled by the user; S requires an explicit service approval. |
| Recovery product | Operator-assisted recovery for the testnet cohort, with an attempt-bound approval, a delay and explicit cancellation semantics. This is not advertised as automated identity recovery or transaction MFA. |
| Fee sponsorship | Separate key F signs an outer fee-bump envelope. The browser or requesting dApp submits. |
| Service policy | Official Cedar engine, embedded in the API service, with a strict validation/error wrapper. |
| Safety logic | A small pure Rust kernel, modeled in Lean and exercised against the implementation and Stellar. |
| Runtime | Static Nido frontend, one API deployment, managed PostgreSQL, Turnkey, and chain endpoints. No new channel pool or submission-worker fleet. |
| G-account origin | One configured wallet origin/RP ID per deployment; no per-G-account subdomains. |
| White labeling | A second neutral-brand deployment fixture must use the same packages and safety code. |
| Production claims | Testnet MVP is not full Wallets Kit conformance, a fully verified wallet, or a production recovery service. Those have separate gates below. |

The protected profile, U1/S1/R1 with threshold 2, is a subsequent feature. Model its authority now to detect unsafe generalizations, but do not expose an MVP toggle or a generic service co-signing endpoint for daily payments.

### 1.1 Successful MVP demonstration

The release demonstration must complete this sequence using real testnet accounts:

1. Choose “Classic G-account” in Nido and enroll a PRF-capable passkey.
2. Save and verify the independent recovery kit.
3. Activate a G-account with the exact intended on-chain signer configuration.
4. Connect from a clean Wallets Kit consumer and obtain that G-address.
5. Sign a transaction, receive parseable signed XDR, and prove no submission occurred during signing.
6. Submit a self-funded transaction and a separately sponsored fee-bump transaction.
7. Replace the passkey/local signer; receive at the original address and reject the removed key.
8. Simulate loss of the original passkey. Use R plus service approval to install a new local signer, without recovering the old U secret.
9. Replace the service signer using U while the old service is unavailable.
10. Repeat the critical flows under the neutral brand and show existing C-account regression tests passing.

### 1.2 Deliberate scope limits

MVP supports new G-accounts, XLM payments, payments/trustlines for an explicit test-asset set, controlled signer-change templates, and one documented Soroban transaction integration established in milestone M0. Each supported operation has a decoder, human-readable review and tests. Unsupported operations fail explicitly.

Deferred: importing arbitrary existing G-accounts; transparent C-to-G asset migration; multiple independent local U signers; automatic identity-based recovery; routine service-enforced MFA; hardware-wallet adapters; arbitrary Soroban authorization trees; unrestricted message signing; production reserve sponsorship; a Fireblocks implementation; and a production Cedar-to-Perch compiler.

Do not block work on the G-account MVP on completion of the general Cedar-to-Perch bridge. Do not claim the limited transaction feature set satisfies every Wallets Kit method.

## 2. Repository baseline and integration points

This plan was grounded in Nido main at `97105a0b54763d27f70d65c0d54239fe33bf777f`. The earlier release research also considered [Nido #356](https://github.com/nidohq/nido/pull/356) and [Perch #168](https://github.com/stellar-registry/perch/pull/168), including Perch pin `fc0fb2bfb88c2a41ded912da435ad1dbbc3dabc1`. Reconcile against the actual integration base before implementation; these are evidence snapshots, not instructions to restore an older dependency.

| Existing surface | Required change |
| --- | --- |
| `packages/passkey-sdk/src/types.ts` | Introduce account-kind-aware public types without making G accounts depend on factory contracts. |
| `packages/passkey-sdk/src/storage.ts` | Add explicit tenant, network, account-kind and address namespaces. The existing assumption that an account address distinguishes networks does not hold for G-addresses. |
| `packages/passkey-sdk/src/webauthn.ts` | Reuse appropriate ceremony utilities; add a separate PRF enrollment/unlock implementation rather than treating a P-256 assertion as an encryption secret. |
| `packages/frontend/src/lib/myNidoModel.ts`, `nidoSwitcher.ts`, `accountLinks.ts` | Display and route G and C accounts explicitly; remove assumptions that every account record is a `contractId`. |
| `packages/frontend/src/pages/connect/index.astro` | Select account kind and network, return the selected address and capability information. |
| `packages/frontend/src/pages/sign/index.astro`, `src/lib/signing/` | Dispatch through account adapters. The G path signs envelopes locally and separates submission. |
| `packages/stellar-wallets-kit-module/src/module.ts`, `urls.ts`, `handover.ts`, `redirect.ts` | Support stable G-mode origins, scoped caches, request binding and genuine sign-only responses. |
| `packages/frontend/src/lib/recovery/model.ts` and SDK `src/perch/` | Preserve C recovery; use shared product concepts without pretending the G state machine inherits Perch's on-chain guarantees. |
| `infra/relayer/` | Retain for C accounts. Do not reintroduce a function allowlist into the existing Channels plugin as part of this work. |

The existing Wallets Kit module can return a submitted transaction hash in `signedTxXdr` for the C path. The new G path must never do this. Existing C behavior needs its own explicit compatibility work; do not normalize it silently into the new contract.

The current relayer runbook describes Fly, Caddy, Redis, channel accounts and Turnkey-backed keys. Those are the baseline for measuring G-path load avoided, not infrastructure that can immediately be deleted.

## 3. Authority model and trust boundary

### 3.1 Keys and roles

| Symbol | Location and lifecycle | Authority |
| --- | --- | --- |
| B | Temporary browser bootstrap secret; encrypted pending-state backup only until activation is confirmed | Defines the G-address and authorizes initial setup. Master weight becomes 0. |
| U | Random Ed25519 secret encrypted under a PRF-derived key; decrypted locally for a bounded ceremony | Weight 2; authorizes daily transactions and deliberate signer replacement. |
| S | Dedicated provider key bound to this tenant/account and its recovery policy | Weight 1; co-signs approved recovery transactions with R. |
| R | Separate random Ed25519 secret exported in an offline recovery kit; not retained by the service | Weight 1; participates in recovery with S. |
| F | Separately permissioned provider key for a tenant fee account | Pays outer fee-bump fees; is not a signer on user G-accounts. |

B, U, S and R public keys must be distinct. F must not be reused as U, S, R or B. Independence of operators and secret storage is an operational assumption in addition to key inequality.

Use minimal necessary transaction signatures. A mathematical quorum being sufficient does not imply a transaction with extra signatures is accepted by Stellar; envelope validation is a separate obligation.

### 3.2 MVP coalition table

For each threshold category, `requiredWeight = 2`:

| Available signers | Authority reaches threshold? | Intended use |
| --- | --- | --- |
| None, B alone, S alone, R alone | No | No account control. |
| U | Yes | Daily use; owner-controlled rotation or service exit. |
| S + R | Yes | Assisted recovery; also has native spending authority. |
| U + any other signer | Yes mathematically | Normally attach U alone to avoid unnecessary signatures. |

Any single loss is survivable if the remaining necessary parties cooperate. Losing U and either S or R is not recoverable under this profile. Losing S and R while retaining U does not lock the user out.

The future protected profile requires any two of U, S and R. Two local keys with weight 1 would bypass S; blindly adding another U signer is therefore prohibited. Prove configurations against actual controlled-key coalitions, not just labels such as “user” and “recovery.”

### 3.3 Guarantees that must not be claimed

- “Permanent” means the account ID survives authorized signer changes while the account is retained. An authorized AccountMerge can close it.
- Fee sponsorship is not MFA. U can self-pay or use another sponsor.
- S + R is not cryptographically recovery-only. It can spend and change authority outside Nido.
- Service delay, cancellation and Cedar rules govern the service path. They do not constrain another valid native quorum.
- The self-directed profile does not protect funds from theft of U. A pending recovery does not freeze that key's on-chain authority.
- A compromised wallet origin can steal U after unlock, or R while the user enters it. Passkey wrapping does not remove browser/application trust.
- Cedar/Lean do not prove Turnkey, an RPC server, PostgreSQL, browser execution or Ed25519/SHA-256 secure.
- No claim of independent user MFA follows merely from an operator approving possession of R. Automated recovery and stronger identity factors require a separate threat model.

## 4. Component design

Proposed paths are new unless listed as existing above:

| Component | Proposed location | Responsibility |
| --- | --- | --- |
| Public account and intent types | `packages/wallet-core/` | Account references, capabilities, operation intent, errors and adapter contracts. No brand constants. |
| G browser adapter | `packages/g-account-sdk/` | PRF wrapping, pending onboarding, ledger reads, transaction construction/review, signature assembly, local submission and recovery client. |
| Pure safety kernel | `crates/g-account-core/` | Validated authority configurations, allowed transition/operation templates, recovery state transitions, signing-role bindings and budget arithmetic. No network, clock, SDK or database access. |
| Signing API | `crates/g-account-service/` | HTTP/authentication, official Cedar engine, authoritative data loading, transactional persistence and provider adapters. |
| API deployment | `infra/g-account-service/` | Container, deployment config, migrations, secrets contract, operational runbook and metrics. |
| Policy bundle | `policies/g-account/` | Cedar schema/policies, typed bindings, supported actions, enforcement manifest, fixtures and version digest. |
| Formal model | `formal/g-account/` | Lean state/configuration models, invariants, proofs, generated traces and axiom audit. |
| Brand fixtures | `examples/white-label-g-account/` | Neutral configuration and a clean consuming app exercising the same packages as Nido. |

The Rust service uses the official Cedar evaluator and a Turnkey adapter via a pinned supported SDK or the documented stamped API. M0 must settle the adapter's exact library/version and request-signing mechanism before implementation of provider access. Do not build a second custody implementation from scratch.

The browser uses typed schemas and conformance vectors generated from or checked against the kernel. A browser preview is not authoritative service authorization. Compile a small kernel validation facade to WASM only where sharing executable code materially reduces drift; do not require the full Cedar runtime or a Lean prover in the wallet.

Dependency direction: product UI -> wallet SDK -> public types; API -> pure kernel + policy engine + providers. Neither the kernel nor schemas import Nido UI, a provider SDK or Perch deployment addresses.

## 5. Account references, records and canonical binding

### 5.1 Public account identity

```ts
type AccountRef = {
  tenantId: string;
  networkId: string; // SHA-256 of the exact network passphrase
  kind: "stellar-g" | "perch-c";
  address: string;
};
```

Every cache, connection, wrapped secret, account record, budget and request is scoped by this identity. A G-address string alone is never a storage or authorization namespace. Do not infer a chain or tenant from an address prefix.

### 5.2 Required records

| Record | Minimum content |
| --- | --- |
| Account | AccountRef, activation state, public signer roles, provider key references, profile/version, RP identity, policy digest, latest accepted ledger snapshot reference. |
| Wrapped secret | Version, role, AccountRef, credential ID, PRF input, HKDF salt, AEAD nonce/ciphertext, associated-data version, expected signer public key. |
| Chain snapshot | Network, account ID, sequence, master weight, all signers/weights/thresholds, relevant balances/reserves, observation ledger and canonical state digest. |
| Recovery attempt | Unique ID/nonce, account, old authority digest, service revision, policy digest, old U, proposed U', evidence records, delay/expiry, state, version, transaction/provider request references. |
| Signing request | Typed purpose, account, key role/reference, immutable envelope/digest, network, intent/policy/state bindings, expiry, idempotency key, reservation and provider status. |
| Reservation | Tenant, fee treasury, budget period, maximum liability, request ID, state and safe-release evidence. |
| Audit event | Tenant/account/action, attempt/request IDs, actor identities, state versions, intent/policy digests, decision and reason codes; no secret material. |

Use a versioned canonical representation for signed statements and policy bundles. Initial choice: RFC 8785 canonical JSON; integers in these application statements are validated canonical decimal strings, with typed fields and no optional/default ambiguity. Use explicit domain tags for each purpose, for example `nido/g/recovery-intent/v1` and `nido/g/session-proof/v1`, and length-delimit the tagged payload before hashing.

This canonicalization does not replace Stellar XDR or its network-bound signing payload. Provider transaction signatures always use Stellar's actual digest. Proofs about application canonicalization do not prove the XDR parser.

Bind the policy bundle digest to schema, policies, bindings and capability manifest. Include a monotonic service revision in addition to a state hash; changing A -> B -> A must not revive earlier service approvals. That service revision is not a native Stellar account precondition.

### 5.3 API authentication and backup retrieval

Use short-lived, purpose-scoped challenge sessions rather than assuming the browser's PRF result authenticates an API request. The service issues a random, single-use nonce bound to tenant, AccountRef, permitted purpose, configured wallet origin and expiry. The client signs the versioned, domain-separated challenge with the appropriate local Ed25519 key; the service validates it against authoritative enrollment/ledger state.

- Before activation, require the pilot invite plus proof of B matching the candidate G-address and proof of U possession. Reject attempts to claim an unexpected existing account. Provisioning S does not establish ownership of G.
- After activation, ordinary wallet sessions require the current registered U with sufficient on-chain authority. S or R alone must not obtain an ordinary wallet session merely because they appear in the signer list.
- R may obtain only an account/attempt-scoped recovery session. This cannot invoke normal spending, arbitrary signer changes or another account's endpoints.
- Service approvers authenticate independently through their configured operator/provider identity; they do not inherit the requester's session.
- Backup creation, replacement and deletion require an authorized wallet/pending-setup session. A user with a synced passkey may retrieve the public account's encrypted unlock bundle and credential-discovery metadata needed to unlock U; that read-only discovery path cannot authorize any mutation. Private backup-management records require a session. Without usable U, use recovery to create U' instead.

The unlock bundle's ciphertext and minimal discovery metadata are therefore not access-control secrets. Explicitly separate them from private profile/operator/audit records, rate-limit discovery and document this metadata exposure. This avoids a circular requirement to prove U possession before retrieving the only ciphertext that can unlock U.

Use a reviewed challenge/session implementation, bounded token lifetime, origin/CSRF controls and a narrow CORS allowlist. Keep bearer material out of URLs and durable browser storage. Session authorization is rechecked for sensitive transitions; a cached session cannot override a revoked signer or changed policy. This U-based login is intentionally not an independent second factor.

## 6. Passkey, local secret and recovery-kit lifecycle

### 6.1 Enrollment and wrapping

1. Select the deployment RP ID and exact permitted origin before creating a credential.
2. Request WebAuthn user verification and check actual PRF extension support. Unsupported authenticators receive a clear unsupported result; never substitute a public credential ID or signature as a secret.
3. Generate U using a cryptographically secure random source. U is a signer on G, not the master secret defining G.
4. Derive an AES-256-GCM wrapping key from PRF output through HKDF-SHA-256, with a random salt and a versioned application/role context. Specify exact bytes and golden vectors in M0.
5. Use a fresh 96-bit GCM nonce for every encryption under a wrapping key. Bind version, role, AccountRef, RP ID, credential ID and U public key as authenticated associated data.
6. Store ciphertext and metadata in browser persistence and an authenticated backup record. The service never receives PRF output, the wrapping key or U.
7. Immediately exercise unlock and prove that the recovered secret yields the expected U public key. Only then permit activation.

Secret bytes remain in memory only for the necessary ceremony and are cleared on completion/cancel on a best-effort basis. Do not claim complete zeroization of JavaScript, WASM or cryptographic-library copies.

### 6.2 Recovery kit

Generate R independently using a cryptographically secure random source. For the MVP, export its standard Stellar StrKey secret seed, plus AccountRef, kit format version, recovery origin and public R key. Do not invent a mnemonic or secret-sharing scheme for this release.

The kit is secret-bearing. Show it only in an explicit backup ceremony, prevent accidental analytics/logging capture, and require a verification challenge before activation. Do not upload R or persist it as ordinary wallet storage. Explain that an unencrypted exported file is a bearer recovery secret and should be stored offline, separately from the passkey device.

During recovery, R is used locally to sign an attempt statement and the final transaction. It is never sent to the API. The offline kit remains useful when U's ciphertext is unavailable: recovery installs a new U rather than decrypting the old one.

The MVP service approval is an authenticated operator action for an enrolled testnet account, after reviewing the exact recovery intent. The requester must prove R possession. The operator sees the known cohort/account and the target-bound evidence, then approves with its own provider-backed authentication. Do not accept email ownership, a support message or knowledge of G as replacement proof. Document operator discretion and root override as trust assumptions.

### 6.3 Rotation and deletion

Deleting a ciphertext or passkey does not revoke a copied U secret. A new independent passkey means generating U', wrapping it under the new credential and removing U on chain. Retain old ciphertext until the successful ledger transition is confirmed; then remove it from active storage/backups.

Synced copies of one credential are one authority. Device count is not signer independence. Credential/RP migration, independent additional devices and recovery-kit replacement each use an explicit signer lifecycle.

Sensitive wallet routes must have a restrictive CSP, no unnecessary third-party scripts, secret-safe error reporting and no secret-bearing URLs. Public identifiers may use existing sharing flows; secret-bearing backup material may not.

## 7. Bootstrap and stable-address transitions

### 7.1 Bootstrap

The testnet flow uses Friendbot for initial account funding. Reserve sponsorship and a production activation treasury are separate later work; F's fee-signing role must not silently expand into arbitrary treasury transfers.

1. Generate B and derive G. Bind the pending setup to network/tenant/G.
2. Enroll U, obtain/prove control of provider S, and create/verify R. Check key distinctness and the target authority configuration.
3. Encrypt B in pending setup storage under the passkey-derived wrapping scheme with a distinct bootstrap role. Never reuse the existing plaintext pending-secret representation for this path.
4. Fund G on testnet only. Before any funds or authority mutation, re-read the account and reject unexpected existing signers/state. If interrupted, resume this exact pending account rather than creating another automatically.
5. Construct an atomic transaction that installs U2, S1 and R1 and finishes by setting master weight 0 and low/medium/high thresholds to 2. Sign with the required bootstrap authority according to actual Stellar evaluation semantics.
6. Confirm ledger success and fetch the full final authority configuration. Only an exact match promotes the account to Active.
7. Delete B's pending ciphertext and clear B from memory. An old B copy cannot sign once the master weight is 0.

M0 must test the exact operation order and transaction-signature behavior on Stellar; the spec does not assume that a toy weight model captures changing authority within a transaction. Failure must not leave a partially configured account because operations in one transaction are atomic. A separately funded but not yet configured account remains Pending, with an explicit resumable setup path.

Do not invite deposits or advertise recovery readiness until activation is verified. If the entire bootstrap capability is lost before activation, the MVP has no fallback to a service-controlled master key.

### 7.2 Allowed signer-change templates

Every template is a source-G transaction with no alternate operation source, no unrelated operations and bounded validity. Require the current configuration to match an accepted profile and the new key to be distinct from retained keys and B/F.

| Transition | Existing authorization | Exact intended final change |
| --- | --- | --- |
| Replace local signer | U | Install U' at weight 2; remove U. |
| Recover local signer | S + R | Install U' at weight 2; remove U. |
| Replace service signer | U | Install S' at weight 1; remove S. |
| Replace recovery signer | U | Install R' at weight 1; remove R after kit verification. |

Keep master weight 0 and thresholds 2 throughout the accepted final state. New-key proofs of possession are application evidence, not extra envelope signatures to append indiscriminately.

Install/remove in one atomic transaction using the tested template. Do not leave two service signers active during a provider migration. On success, update the provider/public-key mapping and invalidate affected pending service decisions. On uncertainty, fetch ledger state before continuing.

## 8. Transaction signing and Wallets Kit

### 8.1 Sign-only contract

`getAddress` returns the selected account's permanent G-address. `signTransaction` returns a parseable signed transaction envelope and never submits. A transaction hash is not an acceptable substitute for XDR.

The browser must:

1. Parse and validate the requested envelope, network, account and permitted operation forms.
2. Resolve relevant on-chain state and render a review from actual decoded operations, including destinations, assets, amounts and all operation sources.
3. Reject expired, malformed, unsupported, wrong-network or mismatched-account requests.
4. Obtain an unlock, recover U and sign the exact reviewed transaction digest.
5. Preserve the original transaction body and valid caller-provided signatures. Return an explicit error rather than silently stripping, modifying or submitting the caller's transaction.

For browser-built Soroban transactions, simulate and assemble resources before authorization. For caller-built transactions, required changes must be surfaced through a prepare/rebuild flow; the sign-only method cannot silently alter a signed body. Fee bumps cannot repair an invalid footprint or resource budget.

The initial supported transaction policy is deliberately narrow and distinct from the existing C-account relayer policy. A G-mode unsupported operation does not justify modifying C-mode Channels behavior.

### 8.2 Sponsorship and submission

Sponsorship is an explicit operation after inner signing. The service validates eligibility, inner signatures, allowed operations and fee bounds, reserves budget, builds the outer fee bump and has F sign it. The returned artifact includes the final fee-bump XDR and both inner/outer hashes where needed for status tracking.

The caller chooses whether to submit. Handle ordinary transactions through the configured chain endpoint and Soroban transactions through the appropriate RPC flow. Confirmation is obtained from the chain, not a relayer transaction ID.

A decline or unavailable sponsor offers self-payment when the transaction is otherwise valid and G has sufficient balance. Do not automatically broadcast as a fallback. Account reserves, trustlines and signer entries require separate funding.

### 8.3 Kit and session safety

- Select the account adapter before constructing ceremony URLs; existing `accountOrigin` rejects G-addresses and cannot be reused unchanged.
- G ceremonies run on the configured stable wallet origin. Existing C ceremonies retain their own RP/origin behavior.
- Bind requests/responses to request ID, method, caller origin, wallet origin, AccountRef, network, expiry and popup/window source.
- Clear or scope caches on account/network/tenant switches. Never sign for a stale cached C/G account.
- Keep timeout, rejection, unsupported operation, network mismatch and user cancellation distinguishable.
- Publish and test a concrete supported-method matrix against pinned Kit versions; record the actual versions in release artifacts rather than treating an old semver range as conformance evidence.

MVP must cover connect/address/network and sign-only transactions from a clean consumer. General `signMessage` and `signAuthEntry` remain explicit unsupported capabilities until dedicated tests show correct account-aware verification. A signature by U does not verify against the disabled master public key embedded in G. Investigate SEP-10 for classic account login, including threshold verification; do not return proprietary proofs where a consumer expects a standard raw signature.

The post-MVP full-compatibility gate includes message/auth-entry semantics, Soroban multisig, existing signatures, multi-source transactions, incoming fee bumps, reconnect and all specified error behavior. Supporting a method name with incompatible return data does not pass that gate.

## 9. Cedar policy boundary

### 9.1 Action vocabulary

MVP exposes `EnrollAccount`, `SponsorFee`, `BeginRecovery`, `ApproveRecovery`, `CancelRecovery`, `PrepareRecoveryTransaction`, `FinalizeRecovery`, `AcknowledgeSignerChange` and `ChangePolicy`. Reserve `CoSignTransaction` for the protected-profile release; it is denied/unavailable in the MVP.

Principals are verified users, recovery-key holders and service approvers. Resources identify a tenant-scoped account, attempt or fee treasury. Request context is derived by trusted adapters from authentication evidence, decoded XDR, persisted state and ledger observations.

Caller-supplied `tenantId`, `mfa`, amount, role, recovery status or key reference cannot become trusted facts by passing schema validation. Select tenant/key mappings on the server and check requested identifiers against those mappings.

### 9.2 Decision composition

```text
authorized =
  validRequestAndEntities
  AND platformPolicyAllowsWithoutErrors
  AND tenantPolicyAllowsWithoutErrors
  AND accountPolicyAllowsWithoutErrors
  AND kernelAcceptsTransition
  AND durablePreconditionsCommit
```

Required policy layers must be present. An intentionally unrestricted optional layer is an explicit validated configuration, not an accidentally missing bundle. Do not union independent permit sets and assume the result narrows permissions.

Official Cedar normally ignores a policy that evaluates with an error. The signing-service wrapper instead refuses the request if relevant evaluation diagnostics contain errors. Revalidate policies and requests when schema versions change. Exact-byte and integer-domain adapters must reject values they cannot represent without loss.

Cedar is a decision function, not a state store. Quota changes, attempt versions, single-use authorization and cancellation races are enforced by kernel transitions committed transactionally.

### 9.3 Policy bundle and deployment

A bundle contains schema, policy files, bindings, supported action/operation set, required enforcement per rule, profile version and fixture/proof references. Pin the engine version and bundle digest in each deployment and audit record. Reject bundles requiring features the target account adapter cannot enforce.

MVP bundles are reviewed release artifacts. A tenant can configure supported limits and narrow approved profiles; a brand/theme configuration cannot relax platform invariants or choose arbitrary provider keys. Changes to policy or recovery authority invalidate affected pending service requests.

## 10. Recovery state machine and concurrency

### 10.1 Defaults for the testnet pilot

Use a 24-hour recovery cooling period, a seven-day attempt lifetime, and a final transaction validity window no longer than five minutes. These are proposed product defaults, not protocol requirements. Tests may use an injected clock; a deployed override requires explicit pilot configuration and visible labeling.

Allow one active recovery attempt per AccountRef. New target keys, changed policy, changed authority or an expired attempt require a new attempt and fresh evidence. A changed transaction sequence may require a newly prepared transaction and fresh final signatures; never patch signed XDR.

### 10.2 States

| State | Meaning | Allowed next transitions |
| --- | --- | --- |
| Proposed | Statement recorded; R/new-U possession evidence not yet accepted | Cooling, Canceled, Expired, Invalidated |
| Cooling | Required evidence accepted; delay running; target immutable | Ready, Canceled, Expired, Invalidated |
| Ready | Delay elapsed and exact final transaction prepared; explicit operator approval and R transaction signature required | Signing, Canceled, Expired, Invalidated |
| Signing | Durable authorization and provider-request record committed; external signing may have begun | Signed, Refused, Indeterminate |
| Signed | A usable S signature may exist; envelope is immutable | Confirmed, SettledFailure, ExpiredOnChain, Indeterminate |
| Indeterminate | Provider or ledger outcome is uncertain | Reconcile to an evidenced state; no speculative budget release or new target |
| Confirmed | Successful ledger result and target signer state verified | Terminal; invalidate related pending authorization |
| Canceled / Expired / Invalidated / Refused | No usable final signature was released, with evidence appropriate to that status | Terminal; new attempt required |
| SettledFailure / ExpiredOnChain | Released transaction has a confirmed failure or can no longer execute | Terminal; re-evaluate before a fresh attempt |

Only report Refused after provider evidence establishes that the request did not produce a usable signature. Local timeout is Indeterminate, not Refused.

### 10.3 Finalization protocol

1. Verify R's domain-separated attempt approval and proof of control of U'.
2. At/after the delay, read a fresh chain snapshot, verify service/policy revisions and prepare the exact recovery template with bounded time/ledger validity as supported by the transaction format.
3. Obtain R's transaction signature. Present the same decoded transaction and digest to the service approver; bind the approval to that exact envelope and key role.
4. Under a database transaction, compare-and-swap the expected attempt version, revalidate all durable predicates, reserve any necessary fee budget, create the immutable provider request and transition Ready -> Signing.
5. Request S's signature through the restricted provider adapter. The committed request acts as a durable outbox; it can be resumed idempotently for the same digest after a crash.
6. Verify the returned signature against the expected S public key and Stellar digest. Persist the result before reporting it. Never log raw secrets or provider credentials.
7. Assemble the required inner signatures, obtain optional F sponsorship separately, and return the envelope for explicit browser submission.
8. Confirm on chain and verify the intended signer replacement before marking recovery complete and promoting the new wrapper/account session.

Cancellation is guaranteed only while a compare-and-swap can win before Signing. After Signing, the UI must say cancellation is no longer guaranteed, because an external provider may already have signed. A database flag cannot recall a valid Stellar signature. Preserve/reconcile uncertain operations rather than claiming atomicity across PostgreSQL, the provider and Stellar.

An owner-authenticated cancellation uses U with an account-bound challenge; a recovery requester can withdraw its own unreleased attempt with R evidence. Neither permits untrusted support staff to cancel or alter targets without the configured authorization. These cancellation rules must be tested alongside expiry and policy changes.

G-account authority can change outside Nido. Re-read before final signing and refuse stale states, but do not claim an arbitrary off-chain state hash or service epoch is checked atomically by Stellar. Expected source sequence and short validity windows reduce exposure; they do not create an on-chain compare-and-swap on every policy attribute or prevent all alternate-source authority changes.

## 11. API contract and provider boundary

All mutation endpoints require authenticated, purpose-bound evidence, explicit request IDs and tenant/account binding. They return typed status/errors; they do not accept caller-selected provider key handles or a general-purpose digest-to-sign command.

| Endpoint | Purpose and output |
| --- | --- |
| `POST /v1/g/accounts/enroll` | Create pending account binding and provision S; return public metadata only. |
| `POST /v1/g/accounts/activate` | Verify final ledger authority and activate the record. |
| `PUT /v1/g/accounts/{id}/wrappers/{wrapperId}` | Authenticated ciphertext backup with version checks; never plaintext U/R/B. |
| `GET /v1/g/accounts/{id}` | Public configuration plus authorized private metadata as appropriate; no secrets. |
| `GET /v1/g/accounts/{id}/unlock-bundle` | Rate-limited ciphertext and minimal credential/derivation metadata for local unlock, with no private profile/audit data; no write authority. |
| `POST /v1/g/session-challenges`, `POST /v1/g/sessions` | Issue and verify single-use purpose-bound challenges; return a short-lived scoped session. |
| `POST /v1/g/fee-requests` | Accept signed inner XDR and sponsorship intent; return signed outer XDR or pending/declined status. |
| `GET /v1/g/signing-requests/{id}` | Authorized polling/reconciliation of a request, without triggering different bytes. |
| `POST /v1/g/recoveries` | Begin an immutable target-bound attempt. |
| `POST /v1/g/recoveries/{id}/evidence` | Submit R/new-key proofs and evidence references. |
| `POST /v1/g/recoveries/{id}/prepare` | Prepare the exact final transaction after delay and fresh checks. |
| `POST /v1/g/recoveries/{id}/approve` | Record an explicit approver decision bound to the final transaction. |
| `POST /v1/g/recoveries/{id}/finalize` | Commit signing authorization; return signed/pending/indeterminate status, never silently broadcast. |
| `POST /v1/g/recoveries/{id}/cancel` | Versioned cancellation before the irreversible boundary. |
| `POST /v1/g/accounts/{id}/reconcile` | Verify owner-initiated signer changes against ledger state and update mappings/invalidations. |

Changing the body while reusing an idempotency key is a conflict. Same key/same body returns the same logical request and reservation. Scope keys by tenant, account, purpose and payload digest. Authorization expiry does not erase unresolved external liability.

Define machine-readable errors including `UNSUPPORTED_OPERATION`, `UNSUPPORTED_CAPABILITY`, `WRONG_NETWORK`, `ACCOUNT_MISMATCH`, `STALE_AUTHORITY`, `STALE_POLICY`, `STALE_ATTEMPT`, `RECOVERY_NOT_READY`, `CANCELLATION_TOO_LATE`, `POLICY_DENIED`, `POLICY_ERROR`, `BUDGET_EXCEEDED`, `PROVIDER_PENDING`, `PROVIDER_INDETERMINATE` and `INVALID_SIGNATURE`.

### 11.1 Turnkey adapter

The provider interface supports public-key discovery, a signature request for immutable bytes, approval status and signature normalization/verification. Internal inputs include role, tenant/account, provider key reference, network, expected digest and expiry.

For Stellar, sign the SDK-computed transaction hash with Ed25519 and no additional provider hashing/prefix. Validate the precise response representation in M0 and normalize it to the expected 64-byte signature; do not assume `r`, `s` or provider formatting maps to Stellar without a test vector.

Use separately scoped credentials/policies for F and S. The API initiator must not possess an unrestricted path that automatically signs any S request. Recovery requires the enrolled operator approval path. Provider root/admin overrides remain an explicitly audited custody assumption. Reuse Nido's Turnkey integration experience, not its current shared relayer key permissions.

Future adapters, including Fireblocks, must pass the same detached-signature, public-key stability, exact-byte, approval, idempotency and failure conformance suite. An API that only transfers from a provider-owned wallet is insufficient.

### 11.2 Fee budget accounting

Reserve the maximum signed fee liability before producing F's signature, not after submission. A valid signed fee bump may be submitted later or by someone other than the original browser.

Budget invariants cover both outstanding reservations and settled charges. Deduplicate retries; include liability from multiple still-valid envelopes conservatively; do not release on client cancellation, HTTP timeout or an unconfirmed claim of failure. Reconcile actual chain outcomes, or establish that the envelope can no longer execute, before release. Carry outstanding liabilities across budget-window rollover so a reset cannot manufacture capacity.

An insufficient F balance or reserve is a separate refusal from the tenant policy budget. Keep F's account funded operationally without authorizing arbitrary treasury transfers through the sponsorship endpoint.

## 12. Operations and white-label deployment

One service deployment may host multiple tenants only with enforced tenant isolation in authentication, database access, provider permissions, fee budgets and audit records. Prefer provider organization/key separation where supported. No browser-configurable tenant field selects privileged key material by itself.

PostgreSQL provides versioned transitions, unique constraints, transactional reservations and durable request/outbox records. No shared account sequence pool is needed: the user's G-account supplies the inner sequence, and the outer fee bump has no channel sequence. Browser-built transactions still need per-account concurrency/retry handling.

The MVP may reconcile on authenticated status requests and through an operator command; a small bounded periodic reconciliation job may be added for abandoned requests. It must not become a transaction-submission relayer or release liability merely because it could not observe an outcome.

Operate and document:

- API/provider availability, request latency, denial/error reasons, outstanding reservations, unresolved signing requests and recovery age.
- Database backups and restore drills that preserve consumed approvals, signing intents and outstanding liabilities. A stale restore must stop new signing until reconciled.
- Independent kill switches for new enrollment, fee sponsorship and S recovery signing. Disabling the service does not revoke U or recall issued signatures.
- Request/audit correlation without U/R/B, PRF output, raw operator credentials or recovery-kit content in logs.
- Recovery operator access, root override events, treasury balance alerts and incident procedures.

Brand configuration includes display assets, configured origin/RP ID, networks/endpoints, supported account modes, custody adapter, identity/approver configuration, fee treasury and approved policy profile. It cannot alter core transition code or authorize another tenant's signer.

Provide Nido and one neutral-brand fixture using the same component APIs. Assert no `nido.fyi`, Nido-specific provider organization, treasury key, Perch address or product icon is embedded in generic logic. Custom domains are credential-lifecycle decisions: changing RP identity requires supported re-enrollment/rotation, not merely changing the theme.

The Perch track continues independently. A later bridge may consume finalized, target-bound Perch guardian approvals for G recovery, but the service remains a trusted bridge. A C-address is not directly an Ed25519 signer on G. A future policy installer must reject G mode for requested guarantees such as recovery-only guardian authority that this profile cannot enforce.

## 13. Formal verification plan

### 13.1 Scope and model

Build a small executable Lean model before expanding the production kernel. Model:

- Distinct keys, finite signer maps, 0..255 weights and thresholds, disabled master, account identity and supported profiles.
- Typed actions, immutable intent bindings, decoded operation templates and signing roles.
- Recovery state, versions, evidence, abstract trusted clock, deadlines, cancellation and the signature-release boundary.
- Provider request states including unknown outcomes, idempotency and replay.
- Reservations, settled fees, budget periods and conservative liability.
- Separate platform/tenant/account decisions and a strict error result.

Cryptographic verification is abstracted as valid evidence bound to bytes, with explicit unforgeability/collision assumptions. Availability and control of a key are assumptions, not inferred from a public key appearing in a map.

Keep the transition function pure: `step(state, event) -> Result<newState, effects>`. Effects are typed commands such as `RequestSignature(role, digest, requestId)`; no model transition directly performs network I/O. The service must persist the new state/effect authorization before dispatching the corresponding external command.

Do not model fee/signature production as atomically committed with the database. Model the intermediate Signing/Indeterminate states explicitly.

### 13.2 Proof obligations

All entries below are planned obligations, not claims of completed proofs.

| ID | Proposed theorem/property | Main assumptions and implementation evidence | Release gate |
| --- | --- | --- | --- |
| G-01 | **Exact authority:** MVP and protected-profile coalition predicates match their specified weight sums; B/S/R alone cannot control MVP G. | Distinct-key map, weight bounds, master 0. Separately test Stellar signature-use behavior. | Lean model before MVP. |
| G-02 | **Admissible configuration:** activation/rotation validators reject duplicate-role keys, wrong weights, unsafe thresholds and unsupported local-key additions. | Input decoding preserves key identity; profile interpretation is explicit. | Lean model + Rust tests before MVP. |
| G-03 | **Stable identity and exact mutation:** a successful accepted signer-change template preserves G and all unrelated authority fields, and installs/removes only its declared keys. | Model SetOptions semantics; compare templates against Stellar and source overrides. No claim about arbitrary user-created transactions. | Lean model + ledger tests before MVP. |
| G-04 | **Quorum preservation:** each accepted transition retains the intended daily/recovery authority under the documented surviving-key scenarios. | Surviving parties actually control their keys and can cooperate. This is conditional reachability, not guaranteed service availability. | Lean model before MVP. |
| R-01 | **Intent/evidence binding:** evidence from different account/network/attempt/target/policy/version domains cannot satisfy one attempt. | Canonical encoding and signature/hash assumptions. Mutation vectors tie the model to wire encoding. | Lean model + boundary tests before MVP. |
| R-02 | **Lifecycle safety:** only allowed transitions occur; target is immutable; no signature effect is emitted before delay, evidence and exact final approval requirements hold. | Trusted clock facts; current policy/state facts passed by the service. | Lean model before MVP. |
| R-03 | **Cancellation linearization:** cancel before the durable Signing transition prevents that attempt's signature effect; cancel after it makes no such claim. | Database compare-and-swap implements the modeled linearization point. Race/fault tests validate the adapter. | Lean model + concurrency tests before MVP. |
| R-04 | **Stale/replay exclusion:** terminal or invalidated attempts cannot authorize a fresh digest; retries cannot change the authorized effect. | Durable versions, restored-state reconciliation, unique request IDs and immutable intent hashes. | Lean model + crash tests before MVP. |
| A-01 | **Role/tenant separation:** fee authorization only emits an F request for the bound tenant; recovery authorization only emits the bound S request. | Provider key registry is authenticated and accurately binds public keys to roles. | Lean model + provider-negative tests before MVP. |
| A-02 | **Exact-byte signing:** each returned transaction signature verifies against the selected key and digest of the reviewed envelope/network. | XDR/hash adapters and cryptography; verify every provider result. Typed binding is proved, byte adapters tested initially. | Kernel theorem + vectors before MVP; implementation refinement before production claim. |
| P-01 | **Policy composition:** final authorization implies each required layer allowed without errors; tightening a layer cannot broaden the final allowed set. | Correct Cedar result adapter; comparisons use the same authenticated facts. | Lean wrapper theorem + Cedar differential fixtures before MVP. |
| B-01 | **Budget conservation:** outstanding liability plus settled charges never exceeds authorized allowance after any successful modeled trace. | Correct maximum-liability calculation; atomic reserve/update; no premature release. | Lean model + database race tests before MVP. |
| B-02 | **Retry/crash safety:** duplicate requests do not create a second logical spend; unknown provider/chain outcomes retain liability; period rollover does not erase it. | Durable idempotency/outbox semantics and truthful reconciliation evidence. | Lean model + failure injection before MVP. |
| E-01 | **Statement encoding:** accepted canonical statements have unambiguous typed identity and distinct purpose domains; fields cannot be omitted/defaulted into the same meaning unexpectedly. | RFC 8785 library/parser and string/integer validation; hash collision resistance remains assumed. | Golden/property tests before MVP; encoding-model proof and implementation link before formal production claim. |
| I-01 | **Kernel correspondence:** translated production Rust transitions equal the Lean model, including refusal and unchanged-state behavior. | Charon/Aeneas extraction boundary and their trusted toolchain; audit unsupported Rust constructs. | Differential suite before MVP; deductive bridge targeted before mainnet. |
| H-01 | **Host correspondence:** supported templates' modeled effects match Stellar's authority/sequence/fee/reserve behavior. | Explicit protocol version and trusted Stellar implementation boundary. | Native/testnet conformance before MVP; broader proof is later research. |
| C-01 | **Cedar-to-Perch preservation:** for a declared supported fragment and trusted bindings, compilation preserves its authorization meaning. Unsupported programs reject. | Parser, integer domain, root bindings and target semantics; no automatic transfer of Cedar's proofs. | Post-MVP; required before claiming a verified compiler. |

### 13.3 Proof artifacts and CI

Create:

```text
formal/g-account/
  Model/Authority.lean
  Model/Intent.lean
  Model/Recovery.lean
  Model/Signing.lean
  Model/Budget.lean
  Proofs/Authority.lean
  Proofs/Recovery.lean
  Proofs/Signing.lean
  Proofs/PolicyComposition.lean
  Proofs/Budget.lean
  Encoding/Statements.lean
  Extracted/                 # generated only, once extraction is integrated
  Equiv/                     # model ↔ extracted implementation
  Main.lean                  # trace/vector generator and replay
  CheckAxioms.lean
  TRUSTED.md
  claims.yaml
```

Pin Lean and extraction dependencies. Reuse rule-core's restricted Rust/extraction pattern where possible rather than rewriting Cedar or inventing a second proof pipeline. Cedar's existing Lean formalization supports language-level reasoning; it does not establish correctness of Nido's policy inputs or service.

CI must check Lean proofs and an actual axiom-dependency audit, rejecting unapproved axioms and proof holes. Generated extracted files are never edited by hand. Record proof IDs, theorem declarations, code/bundle/toolchain revisions, test evidence and status (`proven-model`, `proven-implementation`, `tested`, `assumed`, `deferred`) in `claims.yaml`.

Before an extraction proof exists, generate valid and adversarial traces from the model and replay them against Rust. A passing corpus is evidence, not a universal equivalence proof. Keep explicit claims for both layers.

### 13.4 Required counterexamples and non-properties

The model/test suite must demonstrate these limitations rather than accidentally “prove” them away:

- U bypasses Cedar in the self-directed profile.
- S + R can authorize a payment outside the recovery API.
- U + R bypasses S in the protected profile.
- Adding a second U1 to protected mode permits those two local keys to meet threshold 2.
- A valid released signature may still execute after an off-chain cancellation/policy change.
- A state hash can repeat after A -> B -> A; a service revision is needed for local approval freshness.
- Restoring an old database snapshot can revive consumed approvals unless signing is halted and reconciled.
- A schema-valid caller-provided claim is not authenticated evidence.
- A permitted transaction is not necessarily executable: balance, reserves, sequence, signatures, time bounds and protocol rules still apply.

## 14. Delivery milestones and reviewable changes

Each milestone is independently reviewable. Do not merge a UI that advertises a safety property before its underlying gate passes. Role names below describe ownership, not a requirement to use multiple agents.

| Milestone | Work and suggested change boundary | Dependencies | Exit evidence |
| --- | --- | --- | --- |
| M0: executable design probes | Pin supported browser/authenticator, Kit, Stellar SDK/protocol, Cedar and Turnkey versions. Prove PRF round-trip, exact S/F signature format, bootstrap order, non-master U signing, fee-bump submission, and one Soroban integration. Define canonical bytes and operation templates. | This spec | Reproducible probes/vectors and a capability report. Resolve any failed assumption before product implementation. |
| M1: account identity and adapter seam | Add AccountRef/capabilities/errors; adapt picker, links, storage and Kit routing while preserving C behavior. Add neutral brand configuration. | M0 for wire choices | G/C/network/tenant cache isolation tests; existing C unit tests pass. |
| M2: kernel and proof scaffold | Implement pure validated types/transitions; write G-01..G-04 and initial recovery/signing/budget models; add claims ledger and differential trace runner. | M0 | Lean build/axiom audit and Rust/Lean trace agreement; no I/O in kernel. |
| M3: passkey and onboarding | PRF wrapping/backup, recovery-kit ceremony, pending bootstrap resume, Friendbot testnet funding and exact activation confirmation. | M1, M2 | Real-device enrollment and reset/resume tests; verified on-chain master 0/U2/S1/R1/thresholds 2. |
| M4: local signing and Kit | Operation decoding/review, local U signing, sign-only return, explicit submission, supported Soroban path and consumer fixture. | M3 | Clean dApp signs/receives XDR/submits; zero submission calls during sign-only; unsupported methods fail correctly. |
| M5: Cedar and fee API | Rust service, schema/bundles, F adapter, tenant auth, PostgreSQL reservations/idempotency, bounded sponsorship and reconciliation. | M0, M2, M4 | A-01/A-02/P-01/B-01/B-02 gates; real sponsored testnet transaction; denial/outage/self-pay flow. |
| M6: recovery and signer rotation | Operator approval surface, target-bound evidence, cooling/cancel flow, S provider approval, durable signing state, local R signature, ledger confirmation and provider exit. | M2, M3, M5 | R-01..R-04 gates; lost-passkey exercise; service outage rotation; all fault-injection scenarios below. |
| M7: white-label and pilot release | Neutral-brand end-to-end suite, operations/runbooks, restore drill, package/artifact reproducibility, feature flags and pilot enrollment. | M4, M5, M6 | All MVP acceptance criteria and required proof/model gates pass; capabilities and remaining assumptions published. |
| M8: protected/mainnet expansion | Independent user step-up authentication, protected profile, fuller Kit semantics, second provider, stronger implementation proof and security review. | Successful pilot evidence | Separate release review against section 16; no implied production approval from the MVP. |

M1 and the initial M2 proof/model work can progress independently after M0 fixes their shared types. M6 should begin as a model early, but service signing must not be enabled until its persistence and release-boundary behavior is implemented.

Do not schedule engineering dates without staffing and probe results. The critical path is M0 -> identity/kernel -> onboarding/signing -> service/recovery -> pilot; the Cedar-to-Perch compiler is outside that path.

## 15. Acceptance matrix

### 15.1 Product and chain tests

| ID | Test | Required result |
| --- | --- | --- |
| T-01 | New G enrollment/activation | Same recorded G; exact complete signer state; bootstrap master disabled. |
| T-02 | Unsupported PRF authenticator | Clear refusal before funding; no weak-secret fallback. |
| T-03 | Reload after each bootstrap step | Resume exact pending identity or explain the unrecoverable loss; no unintended duplicate funding/account creation. |
| T-04 | Wrong-origin/network/tenant ciphertext or tampered nonce/AAD | Decryption/validation fails; no signature. |
| T-05 | Sign-only in a clean Kit consumer | Valid signed XDR; body preserved; no chain submit request. |
| T-06 | Self-funded and sponsored transfers | Both settle; F only pays outer fees; user G is inner source; no channel account. |
| T-07 | Sponsor denial/outage | No implicit broadcast; self-pay remains possible with sufficient funds. |
| T-08 | Passkey replacement | G/balances retained; U' works; removed U fails new authorization. |
| T-09 | Lost-passkey recovery | New U installed through S + R only after required evidence/delay/approval; no old secret required. |
| T-10 | Service unavailable | U transacts and replaces S; account ID unchanged. |
| T-11 | Wrong/mixed/duplicate/stale recovery approvals | No new provider signature request. |
| T-12 | Two tabs use same sequence; stale prepared Soroban resources | Explicit retry/rebuild/re-approval as appropriate; no silent mutation or duplicate logical spend. |
| T-13 | Extra/malformed signatures, alternate sources, account merge or unrelated SetOptions appended to recovery | Reject unsupported/unintended envelope; do not “repair” by stripping intent. |
| T-14 | Named Soroban integration | Simulated/assembled before signing and accepted by the network with U as non-master signer. |
| T-15 | Neutral brand + separate tenant | Same components work; no keys, fees, records or callbacks cross tenants. |
| T-16 | Existing C account flows | Existing onboarding/signing/recovery routes remain functional against their configured Perch release. |
| T-17 | Fresh-device unlock and scoped API sessions | Unlock-bundle retrieval has no U-proof circular dependency; challenge replay/wrong purpose fails; R cannot obtain a general wallet session; revoked U cannot authorize a sensitive mutation. |

### 15.2 Failure and concurrency tests

Inject process termination or network failure before/after each durable transition and provider call. Required cases include:

- Two finalizers compete; only one immutable signing request is authorized.
- Cancel competes with finalization; the outcome agrees with the committed Signing boundary.
- Provider signs but the response is lost; request becomes Indeterminate and retains liability.
- Signed response is persisted but the client disconnects; replay returns the same artifact/status.
- Transaction is submitted by another party; reconciliation finds its actual chain outcome.
- Two sponsorship requests would jointly exceed budget; at most the permissible set reserves capacity.
- A budget period rolls over while an old envelope remains valid; outstanding liability remains accounted for.
- Policy/authority changes while an attempt cools or waits for provider approval; no new stale authorization is emitted. Already released signatures are reported honestly.
- PostgreSQL is unavailable; no new service signatures are authorized. Local U use is unaffected.
- RPC responses disagree or are stale; stop sensitive service finalization and reconcile rather than selecting a convenient answer.
- Provider returns a signature for another key, digest or network; local verification rejects it.
- A database restore loses newer request records; signing stays disabled until outstanding provider/chain activity is reconciled.

Use real provider sandbox/testnet exercises in addition to mocks. Use the actual Stellar signing/operation path for authority tests; a helper that simply sums weights is not sufficient integration evidence.

## 16. Release gates and post-MVP work

### 16.1 Invite-only testnet MVP gate

- M0-M7 exits and T-01..T-17 pass, with any explicit unsupported capabilities visible in product and SDK documentation.
- Required pre-MVP Lean model obligations compile without proof holes/unapproved axioms. Differential and integration evidence is attached to the same revision.
- Provider roles, manual recovery approval, independent R storage and cancellation limits are documented and exercised.
- Restore/reconciliation drill and operator-assisted recovery drill succeed.
- No plaintext U/R/B or PRF material is found in persisted ordinary records, telemetry, URLs or audit logs.
- The build runs from a clean checkout with pinned packages; no unpublished local tarball is required for a consuming app.
- Feature flags enable G mode only on the pilot deployment/network. Existing Perch repin work remains independently versioned and verified.

### 16.2 Mainnet/protected-profile gate

Before mainnet, resolve production funding/reserve policy, provider recovery/authentication policy, independent user step-up factors, key/treasury isolation, incident response, supported authenticator coverage and an independent security review.

Complete the targeted deductive implementation bridge for the safety kernel, or explicitly document/review remaining empirical links without calling them formally verified. Provider SDKs, databases, browser cryptography, RPCs and Stellar remain a declared trusted/tested boundary even after the kernel proof.

Before protected mode, prove and test the new profile and its transition from/to self-directed mode, independent-factor behavior, recovery/service-exit paths, and all weight combinations admitted by device enrollment. Explain which alternate quorum can bypass routine service approval.

Before claiming full Wallets Kit compliance, pass the complete method/version matrix, including account-aware message/login proofs, auth entries, non-master signer verification, multi-party transactions and caller-compatible fee-bump behavior.

Before shipping a common Cedar authoring path for G and Perch, publish the accepted fragment, binding rules, integer-domain limits and enforcement manifest; prove the compiler relation for that fragment and reject unsupported inputs wholesale. Keep G service guarantees distinct from Perch on-chain guarantees.

## 17. Sources and evidence boundaries

Primary protocol/product references:

- [Stellar signatures and multisig](https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig): signer weights, thresholds, disabled master and reserve/signature considerations.
- [CAP-0015](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md): fee-bump separation.
- [Stellar accounts](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts): classic account structure and reserves.
- [WebAuthn Level 3 PRF](https://www.w3.org/TR/webauthn-3/#prf-extension): PRF extension behavior; implementation support must still be tested.
- [Cedar authorization](https://docs.cedarpolicy.com/auth/authorization.html) and [validation](https://docs.cedarpolicy.com/validation.html): decision/error behavior and schema boundaries.
- [Cedar specification](https://github.com/cedar-policy/cedar-spec): Lean formalization and differential testing infrastructure.
- [Turnkey raw signing](https://docs.turnkey.com/api-reference/activities/sign-raw-payload) and [policies](https://docs.turnkey.com/features/policies/overview): signing API and approval/root authority.
- [SEP-10](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md): account-aware authentication and signer-threshold verification.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785): canonical JSON for application statement bindings.

Repository evidence:

- [Nido architecture](ARCHITECTURE.md), [relayer runbook](infra/relayer/README.md), [SDK storage](packages/passkey-sdk/src/storage.ts), [Kit module](packages/stellar-wallets-kit-module/src/module.ts), [Kit URLs](packages/stellar-wallets-kit-module/src/urls.ts).
- [Perch formal scope at the researched pin](https://github.com/stellar-registry/perch/blob/fc0fb2bfb88c2a41ded912da435ad1dbbc3dabc1/formal/README.md#what-is-not-modeled): recovery controller/account authorization are not established by its existing formal model.
- Local Perch vision at `272eac9b191fbf6783de8775198b72934746b9e4`, `docs/perch-paper/source/papers/vision/html/sections/cedar.html`: proposed Cedar bridge, offline prototype and small unpublished proof experiment; not a general production compiler.
- Local `soroban-rule-core` at `cbabe594ae2df408991e825e56ddd618ea29541b`: restricted Rust, Charon/Aeneas extraction, equivalence proofs and a claims ledger provide a reusable engineering pattern; its proofs do not already cover this G-account design.

All MVP defaults, APIs, paths, transitions and proof IDs in this document are proposed Nido design decisions. Existing library/protocol proofs do not automatically transfer to these new components.
