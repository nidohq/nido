# Nido G-account: formal verification specification and Lusterna handoff

Status: verification requirements and prepared tool inputs; no G-account implementation or proof is supplied by this document.

Date: 2026-11-10. Companion product plan: [SPEC.md](SPEC.md).

Tool: [Certora Lusterna](https://github.com/Certora/lusterna), researched at commit `3524051e8b0e31caaad135e719eec1d9e6c73c68` (2026-11-08). The name is **Lusterna**, rather than “lueserna.”

## 1. Tool-facing focus and current readiness

This file can be passed as Lusterna's `DESIGN_DOC`. If used directly, its **active campaign is authority only: G-01, G-02, G-03 and G-04**. The remaining sections define later campaigns and acceptance criteria, not a request to translate the entire wallet.

Prefer the smaller prepared instruction files when running individual campaigns:

| Input file | Scope | Start condition |
| --- | --- | --- |
| [01_authority.md](formal/lusterna/01_authority.md) | Configuration validation, distinct signer authority and exact signer rotation | The production authority kernel exists and is committed. |
| [02_recovery.md](formal/lusterna/02_recovery.md) | Recovery intent, delay, cancellation, immutable signing authorization and replay | The production recovery transitions exist; authority definitions are reviewed. |
| [03_signing_policy_budget.md](formal/lusterna/03_signing_policy_budget.md) | Signing-role separation, policy composition, sponsorship reservations and reconciliation | The production signing, policy-wrapper and budget functions exist. |

For each run, inspect the actual Rust before selecting function patterns. The proposed target is `crates/g-account-core`, a pure Rust crate used by the real service. Its proposed crate root is `src/lib.rs`. **At the researched Nido baseline, this crate does not exist.** Do not substitute the existing Perch recovery controller, a new proof-only implementation, or an unrelated arithmetic example. Record missing implementation and stop that campaign.

The Rust code describes what the program does; [SPEC.md](SPEC.md) and this document describe what Nido requires. If these disagree, retain the discrepancy. Do not weaken a requirement to match the code or modify production behavior inside a verification run to make a theorem pass. Fixes belong in a separately reviewed implementation change followed by a new verification baseline.

Nido was inspected at `97105a0b54763d27f70d65c0d54239fe33bf777f`. `SPEC.md` was uncommitted and had SHA-256 `eb42a7f54625eb0ecc200e52cd44472d8a2ef3554c9c1b367b7a90f4599d9e00`. These identify the design evidence, not a runnable G-account verification baseline. Lusterna reads the instruction file from the host but seeds the Rust repository from a Git commit; uncommitted implementation and referenced files do not accompany that seed.

| Readiness item | Observed state | Required before a campaign |
| --- | --- | --- |
| Lusterna instructions | This document plus three focused briefs | Review against the implementation commit. |
| Production G kernel | Absent | Implement the selected campaign's pure functions during SPEC milestone M2. |
| Target repository | Full, non-shallow Nido Git repository | Explicit seed commit containing kernel, docs, dependencies and relevant tests. |
| Python | System `python3` is 3.9.6; mise Python 3.12.13 is available | Use Python 3.10+ in a dedicated environment. |
| Lusterna CLI | Not found on PATH | Install the researched revision in that environment. |
| Docker | CLI 29.4.0 found; daemon/image not exercised | Working daemon and a recorded toolchain image. |
| Aeneas/Charon/Lean | No Lusterna-compatible image tested here | Pin and probe the compatible toolchain; record its actual versions. |
| Model-provider credentials/cost | Not inspected or used | Configure credentials and an explicit per-stage spending cap for execution. |

Prepared means the inputs and run procedure are ready. It does not mean verification has run or the implementation prerequisite has been satisfied.

## 2. Research findings that change the verification plan

### 2.1 Fit

Lusterna orchestrates inference, Rust-to-Lean translation, theorem generation, proof attempts and reporting. It is experimental, emphasizes Solana, and also supports general Rust. Its pipeline uses Charon/Aeneas; it is a suitable candidate for Nido's small pure Rust safety kernel. It is not a direct verifier for Nido's TypeScript browser, PostgreSQL, Cedar policies as deployed, or Stellar ledger execution. [Upstream overview](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/README.md).

The inference stage treats the supplied document as guidance and derives properties from existing code. Therefore a successful run can still omit a product requirement. Nido must review the inferred scope against the obligation IDs below before proceeding. This is a separate acceptance gate, not something Lusterna automatically guarantees. [Inference implementation](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/briefings.py).

Translation commonly creates a reduced extraction crate. An independent agent reviews its fidelity; that review is useful evidence but is not a machine-checked equivalence proof between arbitrary edited Rust and the original source. Prefer extracting the production pure crate directly when its dependency closure permits it. [Translation pipeline](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/docs/pipeline.md).

### 2.2 Nido-specific extraction hazards

Lusterna's generic guidance permits dropping irrelevant keys, serialization and framework fields. In Nido, the following values carry the safety properties and must remain whenever the active campaign uses them:

- Exact public-key identity, key inequality, signer weight and threshold category.
- Tenant, network, account kind, permanent address and signing role.
- Attempt/request identity, target key, intent digest, policy digest and monotonic revision.
- Operation source and intended signer mutation, including unexpected operations.
- Recovery timestamps, provider uncertainty, durable signing boundary and reservation identity.
- Fee amount, outstanding liability, settlement and rollover bookkeeping.

Represent identifiers with bounded value types whose equality is faithful to production. Removing a text encoder may be valid for an authority theorem; removing the bytes that distinguish two keys is not. For an encoding theorem, the encoder itself becomes a target and cannot be removed as plumbing.

Do not import Solana account ownership, PDA, signer-flag or rollback semantics into this Stellar/off-chain model. Lusterna's inspected platform detector recognizes Solana patterns; it does not supply a Stellar semantic model. [Platform detection](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/pipeline.py).

### 2.3 What the verdict establishes

The inspected harness distinguishes proofs using only Lean's standard axioms, proofs that additionally depend on declared assumptions, and tainted/unresolved proofs. It also distinguishes theorems that execute translated functions from theorems concerning only abstract definitions or types. Nido accepts no headline claim based solely on a successful build or a theorem count. [Axiom and grounding implementation](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/lean.py).

Lusterna's mechanical theorem checks reduce several forms of vacuous specification. They do not prove that the chosen properties are the right product requirements. Human review still covers requirements, assumptions, extraction fidelity and host integration. [Check definitions](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/docs/skills/mechanical-checks.md).

The current tool uses containerized Claude sessions and an Anthropic API key. Runs can cost money and send code context to that provider. Its documented dollar limit is per stage/session, not a campaign-wide ceiling. Nothing in this preparation installs the tool, starts those sessions or uploads Nido source. [Usage](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/docs/usage.md).

## 3. Verification boundary and production shape

### 3.1 Boundary

```text
Browser / HTTP / Cedar / PostgreSQL / Turnkey / Stellar adapters
                 |
        authenticated, validated facts
                 v
      production Rust g-account-core
      deterministic validation + transition + typed effects
                 |
       Charon -> Aeneas -> Lean implementation
                 |
       checked properties + model correspondence

External effects occur only after durable authorization.
The kernel itself has no I/O, clock, signing key or network client.
```

The intended semantic interface is `step(state, event) -> Result<transition, refusal>`, where an accepted transition contains the next state and explicit effects. Use production functions, including smaller validators and transition helpers, as proof targets. This is an interface requirement, not an assertion that a function named `step` already exists.

Prefer immutable inputs and an owned transition result. If implementation uses in-place mutation, proofs must cover the real post-state on both success and rejection. A rejection must not carry an executable signing effect or mutate protected state. Prove the behavior of whichever interface is actually shipped, rather than proving a convenient wrapper the service never uses.

Use bounded collections, explicit fixed-width arithmetic and checked operations. Treat arithmetic overflow as a typed refusal where required by the API, not a panic or silent wrapping success. Preserve the deployed compilation profile in extraction. Nido currently sets release overflow checks to true; verify the actual kernel and per-package settings at the selected seed.

### 3.2 Proposed target map

These are module responsibilities for implementation, not existing function names or a pre-generated Lusterna manifest. INFER must resolve them to real callable targets.

| Proposed module | Target behavior | Property-bearing data |
| --- | --- | --- |
| `authority` | Validate profile, calculate distinct-key authority, validate/apply rotation | B/U/S/R/F identities, signer map, all thresholds, master weight, G identity, profile |
| `intent` | Compare evidence/approval bindings and current revisions | AccountRef, purpose, attempt, request, target, policy, revision, digest, expiry |
| `recovery` | Begin, accept evidence, prepare, approve, authorize signing, cancel, reconcile | Lifecycle, immutable target, evidence, time, durable version, provider status |
| `signing` | Select permitted role/key/request and accept provider response | Registry binding, exact digest, request ID, role, verification outcome |
| `policy` | Strict composition of required Cedar decisions | Layer presence, schema validity, Allow/Deny/errors, kernel decision |
| `budget` | Reserve, deduplicate, settle, expire and roll forward exposure | Tenant/treasury, request identity, maximum liability, settled fees, outstanding records |

Exclude UI, transport, provider SDKs, the Cedar evaluator internals, wallet secret wrapping and Stellar XDR internals from the first campaigns. Their adapters retain separate tests and assumptions. No private key, PRF output, production credential or recovery kit belongs in any verification fixture.

### 3.3 Model versus implementation

Maintain the explanatory Lean model planned in `SPEC.md`, but prove important properties over the Aeneas-translated Rust as well. A model theorem and a passing trace corpus do not establish universal implementation correspondence.

For a model abstraction `alpha`, the later bridge should establish, over representable inputs and all relevant outcomes:

```text
abstract_outcome(run_extracted_rust(s, e))
  = run_model(alpha(s), abstract_event(e))
```

Both sides include refusal, next state and effects. The relation must not discard errors, alternate operation sources, changed keys or signing requests. A simulation covering only successful cases is insufficient for refusal-safety claims. Prove progress/non-panic obligations separately where the extraction semantics can fail or diverge.

Charon/Aeneas, Rust compilation and the correspondence of any extraction edits remain part of the declared trust boundary. A theorem over their Lean output does not by itself verify the shipped binary or remove those tools from trust.

## 4. Authority and account-transition obligations

The MVP configuration is master B weight 0, U weight 2, S weight 1, R weight 1, all three thresholds 2. F is a separate fee-account key and is never a signer on G. The permanent address is derived from B and retained when U/S/R change.

### G-01 — Exact authority

For every admitted configuration and set of distinct valid signer identities, authorization is exactly the sum of registered weights compared with the relevant threshold. Repeated appearances of one key contribute once; unknown keys and B contribute zero. Accumulation must not overflow its production integer type.

For the MVP, the resulting coalition predicate is `U present OR (S present AND R present)`. Prove it for low, medium and high categories. Include explicit negative cases for no signer, B, S alone and R alone, and positive witnesses for U and S+R.

This predicate is about authority. Do not infer that attaching every available signature yields a valid Stellar envelope: unnecessary signatures and protocol validation remain H-01 concerns.

### G-02 — Exact admissibility and rejection

Accepted activation and signer-change configurations have distinct B/U/S/R/F, master 0, exactly the supported signer set and weights, and thresholds 2. Reject unsafe thresholds, duplicate role keys, unexpected signers, unsupported profiles and an extra independent local signer. Check zero/max weights, duplicate map entries and representational limits.

Prove both directions relevant to the supported domain: an accepted input satisfies the profile, and a well-formed supported input is accepted. A validator that rejects every input must not pass solely because its successful outputs would be safe.

Protected U1/S1/R1 with thresholds 2 is a deferred profile. Its coalition arithmetic may be modeled now, but the MVP validator must reject enabling it. Demonstrate that U+R bypasses S, and two independent U1 keys can together meet threshold 2 if incorrectly enrolled.

### G-03 — Identity, exact mutation and frame preservation

For accepted replace-U, recover-U, replace-S and replace-R templates, prove:

- AccountRef and permanent G remain identical.
- Exactly the declared old key is removed and fresh replacement installed with its prescribed weight.
- Retained keys, master weight, all thresholds and other modeled authority fields remain unchanged.
- Invalid replacement identities, extra mutations, alternate operation sources and unrelated operations are rejected.
- A rejection has no accepted transition or signature effect.

The frame covers every field the production transition can modify, not only convenient fields in a reduced model. Assets, sequence numbers, reserves and ledger execution are outside this local authority frame and must be tested separately. Bootstrap intermediate-state semantics require actual Stellar conformance; do not assume the final-state proof establishes safe operation ordering.

### G-04 — Conditional quorum preservation

Each accepted rotation produces another admitted configuration with the same coalition predicate over the new role identities. Exhibit a reachable authorized route after each single-key loss, assuming the surviving required parties control their keys and cooperate. Explicitly show that losing U and either S or R leaves no recovery quorum.

This is an authority/reachability theorem under stated assumptions, not a liveness claim about a provider, network, user or recovery operator.

## 5. Recovery obligations and the external signing boundary

### R-01 — Complete intent and evidence binding

Compare the complete typed statement before accepting evidence: tenant, network, account kind/address, purpose/version, attempt ID, target U', relevant old authority, policy digest, monotonic revision and expiry. Final approval additionally binds the exact transaction digest, S identity/role and final request identity. Bind the operator identity and the required R/new-U possession evidence to the same attempt.

For every compared field, exhibit a mismatched input that is rejected. Replaying an old approval into a new target, tenant, network, purpose or policy revision must fail. A matching hash is not proof of distinct preimages; equality of structured statements and assumptions about hashing/cryptography must remain distinguishable.

Cryptographic validity is supplied by a reviewed verifier adapter. A theorem that checks binding of already verified evidence is valuable but does not prove Ed25519 verification or authenticate caller-supplied booleans. The service must construct evidence types only after real verification.

### R-02 — Lifecycle, timing and issuance

Prove preservation from a valid initial attempt across every implemented event, including negative/error events. The target remains immutable. At most one active attempt exists in the modeled account state. No accepted signature authorization occurs without all required evidence, current authority/policy versions, exact final approval and elapsed delay.

Specify boundary comparisons explicitly: earliest issuance is at `now >= readyAt`; unexpired authorization requires `now < expiresAt`; final transaction validity must fit the permitted window. Timestamp addition and revision increment are checked. Defaults are the product plan's 24-hour delay, seven-day attempt lifetime and at most five-minute final transaction window; prove parameterized constraints rather than only these constants.

An invalid state or untrusted/stale fact cannot be converted into a valid initial state by a proof precondition. Cover initialization and all entry points that construct validated states. Clock correctness and freshness are explicit adapter assumptions; a rollback must not create permission by unchecked arithmetic.

### R-03 — Cancellation linearization

The durable `Ready -> Signing` transition is the commitment boundary. Its result authorizes one immutable provider command. A successful cancellation committed before that transition prevents any future authorization for that attempt. A competing finalizer with the old version must be rejected.

After Signing, cancellation cannot promise that no signature exists. Prove that the service returns the appropriate too-late/uncertain result and does not falsely move the attempt into a terminal state meaning no usable signature was produced.

This needs a two-trace/order argument plus single-operation checked properties. Database compare-and-swap and the transactional outbox must implement the modeled ordering; Lean alone does not establish PostgreSQL isolation. Dispatch may retry the same committed command more than once, so do not claim exactly-once HTTP execution.

### R-04 — Replay, stale state, crashes and reconciliation

Same scoped idempotency key and same content identify the same logical command. Same key with different content is a conflict. A consumed/terminal/invalidated attempt cannot authorize a new digest. A -> B -> A changes of policy/authority do not revive approvals because the service revision changes.

Model provider request state independently from local response receipt. A lost response becomes Indeterminate, not Refused. Resume uses the same role, key, request identity and digest. Refused requires reliable evidence of no usable signature; Confirmed requires ledger success and the intended signer state. Invalid provider signatures are never accepted as a successful result.

After an old database restore, the service must remain unable to issue new signatures until reconciliation restores trustworthy state. That operational condition is an explicit hypothesis of ordinary durable-trace theorems and a mandatory fault test. An in-memory transition proof cannot establish disaster-recovery correctness.

Policy or authority changes invalidate unreleased approvals. They cannot revoke signatures already issued or guarantee that outside native Stellar transactions did not race the service. Never describe service versions as an on-chain compare-and-swap.

## 6. API, policy and fee-liability obligations

### A-01 — Tenant, purpose and signing-role separation

A sponsored fee request can authorize only F for its bound tenant/treasury and exact outer transaction. Recovery can authorize only the registered S for the bound account and attempt. Reject caller-selected provider handles, mismatched registry entries, wrong account/network and unavailable actions such as routine `CoSignTransaction` in the MVP.

Include the kernel portion of session/action scope: R evidence cannot acquire an ordinary U wallet session or use arbitrary signing actions; an owner session cannot bypass current sensitive-action checks after U is revoked. Actual challenge verification, token transport and session storage remain adapter tests.

If registry or evidence lookup is modeled as an input, state its authenticity assumption. Do not replace tenant isolation with a precondition that simply assumes the request already selected the correct tenant and key.

### A-02 — Exact signing request and response binding

An accepted request carries the exact role, public key, network-bound Stellar digest and immutable transaction identity approved by the caller/service. An accepted result corresponds to that request and a successfully verified signature. Changed payloads, double hashing, provider prefixes, wrong public keys and wrong networks fail adapter conformance.

The kernel proves propagation/comparison of these values. XDR decoding, Stellar digest calculation, Ed25519 and signature-format normalization are separately tested/trusted until their implementations are themselves verified. The exact-byte theorem must not claim to cover those adapters when the extraction takes a digest or verification result as an input.

### P-01 — Strict policy intersection

Final authorization implies request/entity validity, an error-free Allow from every required platform/tenant/account layer, acceptance by the kernel and a successful durable commit before dispatch. Missing required layers, Deny and relevant evaluation errors all refuse.

For fixed authenticated facts and fixed other layers, replacing a layer's allowed set by a subset cannot enlarge the composite allowed set. Prove this relation rather than assuming arbitrary policy-text edits are monotonic. Runtime policy version changes additionally invalidate prior service approvals.

The pure composition proof is independent of the official Cedar evaluator's internals. Cedar's own Lean proofs do not verify Nido's facts, wrapper, schema, persistence or provider integration. Cover actual Cedar error behavior with pinned-engine fixtures, including the service's stricter rejection of diagnostic errors.

### B-01 — Reservation conservation

Represent amounts in integer stroops with checked bounds. Define the outstanding liability as the sum of maximum enforceable fees for issued or potentially issued unresolved envelopes. Include all still-live liabilities conservatively, even where only one of competing envelopes might eventually execute.

For each enforced budget window, maintain `chargedInWindow + outstandingLiability <= allowance` under the admitted limit-update rules. Reserve atomically before authorizing F. Settlement replaces a reservation with its evidenced actual fee, which must not exceed the reserved maximum; an inconsistent observation must not silently free capacity. Reject negative, overflowing, inconsistent and over-limit updates.

A limit reduction below already committed exposure cannot retroactively make that exposure disappear. For this invariant, reject such a limit update; if the product later supports a lower future limit, represent the outstanding overhang explicitly and deny new issuance until it clears. Do not prove conservation by assuming externally editable allowances never change.

### B-02 — Retries, uncertainty and window rollover

Duplicate identical requests reuse the original reservation. Changed bytes require their own liability assessment and cannot borrow an old authorization. Cancellation, client disconnection, process restart and provider timeout do not release a potentially signed fee bump.

Release only against evidence that the liability settled or can no longer execute under the chain's rules. Local wall-clock expiry alone is not sufficient evidence of ledger ineligibility. Reconciliation and settlement are themselves idempotent, including delayed/repeated events.

On a budget-window change, retain every unresolved reservation. Charge a settled transaction in the configured accounting window and remove its reservation in one logical transition. Define the treatment of delayed observations of earlier-window settlements, and retain their historical charge records. Rollover may reset the applicable window's settled counter; it must never reset outstanding liability. Prove the invariant for the complete reserve/settle/expire/rollover transition set.

## 7. Encoding, correspondence and deferred obligations

| ID | Requirement | Verification route and limit |
| --- | --- | --- |
| E-01 | Versioned, typed application statements encode unambiguously; distinct purposes and changed bound fields cannot alias through omissions, parsing or concatenation. | Separate campaign once the actual encoder/decoder exists. Prove structural encoding/decoding properties over the accepted domain. Test RFC 8785, canonical decimal integers, duplicate-field rejection, lengths and domain tags. Hash collision resistance stays an assumption; a finite hash is not injective over arbitrary inputs. |
| I-01 | The production kernel and explanatory Lean model agree on accepted transitions, refusals, state and effects. | Direct extracted-function proofs plus explicit abstraction/refinement theorems. Every copied or changed extraction body needs provenance and review; a judge verdict is not a deductive source-equivalence proof. Differential traces supplement, but do not replace, the bridge. |
| H-01 | Supported templates behave as modeled on Stellar, including signer use, sequence, reserves, fee bumps and operation ordering. | Native/testnet conformance with a pinned protocol/SDK and real authorization. No Lusterna Stellar-host proof is supplied by the researched tool. Any later host model has its own trusted boundary. |
| C-01 | A future supported Cedar fragment compiles to Perch with preserved authorization meaning and rejection of unsupported inputs. | Post-MVP, separate compiler campaign. Requires an implemented compiler, precise fragment/bindings and source/target semantics. This is not a prerequisite for the G-account kernel campaigns. |

Together with sections 4–6, this preserves all 17 obligation IDs from `SPEC.md`: four G, four R, two A, one P, two B, and E/I/H/C. No ID is considered covered simply because an upstream library has a related proof.

## 8. Theorem construction and anti-vacuity rules

### 8.1 Two levels of failure

Charon/Aeneas execution has a failure/divergence layer. A Rust function returning `Result::Err(PolicyDenied)` is an ordinary program value, not necessarily a failure at that outer layer. A successful formal execution may therefore correctly return an application refusal.

For every important validator/transition, prove defined execution and useful constraints on the returned value for both accepted and rejected inputs. State ordinary input bounds where necessary; do not assume that the output was successful, valid or already equal to the desired result.

Use Lusterna's checked-property family for single executions and its justified lemma family for relational properties, induction and abstraction bridges. The following is schematic, not a supplied Lean file or guaranteed concrete API:

```lean
@[lusterna]
theorem g02_validate_profile (input : Input) (h : Representable input) :
  translated_validate input ⦃ result => CorrectValidation input result ⦄
```

The postcondition must be pure, mention the result and genuinely constrain it. Implement `CorrectValidation` from the intended profile, not by restating the validator itself. Paired success witnesses and rejection theorems exclude an always-refuse implementation. Any projected measurement needs a proved connection to the real getter/function if the claim depends on that measurement.

### 8.2 Trace invariants

An invariant requires an initialized base case and preservation across every event that can change the relevant state. Cover retries, failures, cancellations, external observations, policy updates and rollover, not only the happy path. Induct over finite traces of the real transition relation. State environment assumptions explicitly; do not assert unconditional liveness or safety under arbitrary ledger/provider/database behavior.

Cancellation, non-interference, monotonicity and implementation equivalence can legitimately need multiple executions. Supporting lemmas may express them, but must connect to checked properties of the actual operations. Relabeling every target theorem as a helper does not pass Nido's coverage gate.

### 8.3 Proof acceptance

- For a fully established kernel claim, require axiom dependencies contained in `propext`, `Classical.choice` and `Quot.sound`.
- `sorryAx`, unresolved checks, generated holes or compiler-trusted proof shortcuts do not satisfy that gate. A proof that compiles with `sorry` is unfinished.
- Record declared extra assumptions and affected theorems as conditional results; do not count them as unconditional kernel proofs. Do not change the harness's classification rules.
- Preserve false statements and report concrete counterexamples. Fix code or requirements through review; do not quietly narrow the statement or turn it into an axiom.
- Upstream permits a broader trust basis for some refutations, including `native_decide`. Record that dependency and replay the counterexample in Rust; require an ordinary axiom-audited proof if claiming the same trust strength as an established theorem.
- Preserve generated Lean, source diffs, LLBC, compilation profile, theorem statements and harness output. A prose report cannot override the machine verdict.

Mechanical gates are necessary but not sufficient. A reviewer must still check that assumptions are satisfiable, inputs cover production behavior and the result is grounded in the selected production functions.

## 9. Required counterexamples and integration evidence

These are expected limitations to demonstrate, not failing product requirements to hide:

| Witness | What it establishes |
| --- | --- |
| U signs a payment without the API | Self-directed custody bypasses Cedar and F. Sponsorship is not MFA. |
| S+R signs a payment | Recovery quorum is not recovery-only authority on Stellar. |
| U+R in protected mode; two independent U1 signers | Service participation is not guaranteed by an arbitrary weight-2 quorum. |
| A previously issued signature is submitted after an off-chain cancel/change | Off-chain cancellation cannot recall signatures. |
| Policy/authority A -> B -> A with a repeated state hash | State hashes alone do not make old approvals fresh. |
| Restored old durable state without reconciliation | Memory-level replay safety does not prove restore safety. |
| Schema-valid caller input claiming MFA or another tenant | Schema validation is not authentication. |
| Sufficient weight but extra signatures, stale sequence or inadequate reserves | An authority theorem does not establish transaction executability. |

For each refuted desired property, retain the exact statement, concrete inputs/trace, tool trust classification and a production regression test. For each expected limitation, label it as an intentional non-guarantee.

Connect the campaigns to the product tests rather than replacing them:

| Campaign | SPEC acceptance evidence still required |
| --- | --- |
| Authority | T-01 activation, T-08 rotation, T-10 service exit, T-13 hostile templates/signatures; real bootstrap order and signer-reserve probes |
| Recovery | T-09 lost passkey, T-11 bad evidence, T-12 sequence/resource changes, T-17 scoped sessions; cancel/finalize races, stale restore and lost provider responses |
| Signing/policy/budget | T-05 sign-only, T-06 fee bumps, T-07 sponsor failure, T-15 tenant isolation; reservation races, delayed settlement, rollover and wrong provider signatures |
| Outside the kernel | T-02–T-04 PRF/bootstrap/wrapping, T-14 Soroban integration, T-16 C-account regressions; browser/session/XDR/crypto/DB/provider conformance |

No new formal claim about existing C-account code follows from this work. Keep Perch repinning and its existing proofs independently versioned.

## 10. Execution runbook

### 10.1 Prepare the implementation baseline

1. Implement the selected pure-kernel slice and have the production service call it. Complete its unit/property tests and the relevant M0 probes.
2. Commit the kernel, `SPEC.md`, this file, the chosen brief, Cargo metadata/lockfile and required fixtures on the intended implementation branch. Review only the intended changes; do not stage unrelated work wholesale.
3. Record the exact seed SHA and check that required files exist in that commit. Supply a named branch at that SHA to the run command, as explained below. A full clone is required. A parent Git bundle does not materialize submodule contents; the first kernel campaign should not depend on `vendor/perch` being checked out inside the container.
4. Verify the crate builds in the selected environment. If root workspace dependency resolution drags in unrelated Soroban/Perch packages, use a reviewed extraction strategy with source provenance and the same behavior/profile. Do not replace the target with a simplified reimplementation.

Example source checks, after setting `NIDO_VERIFY_SEED` to the real implementation commit:

```sh
NIDO_VERIFY_REPO=/Users/willem/c/nidohq/nido
: "${NIDO_VERIFY_SEED:?Set the committed implementation SHA}"
git -C "$NIDO_VERIFY_REPO" rev-parse --is-shallow-repository
git -C "$NIDO_VERIFY_REPO" rev-parse --verify "$NIDO_VERIFY_SEED^{commit}"
git -C "$NIDO_VERIFY_REPO" cat-file -e "$NIDO_VERIFY_SEED:crates/g-account-core/src/lib.rs"
git -C "$NIDO_VERIFY_REPO" cat-file -e "$NIDO_VERIFY_SEED:formal_SPEC.md"
git -C "$NIDO_VERIFY_REPO" cat-file -e "$NIDO_VERIFY_SEED:formal/lusterna/01_authority.md"
git -C "$NIDO_VERIFY_REPO" status --short
```

The kernel existence check intentionally fails against today's researched baseline. Do not proceed from that failure into a paid run.

**Pinned-version CLI pitfall:** the inspected preflight accepts a raw commit SHA, but the subsequent `git bundle create ... <seed>` operation fails for a bare SHA with `Refusing to create empty bundle`. This was reproduced in a synthetic local repository; a named ref succeeds. The commands below create a dedicated seed branch without checking it out, verify that it names the intended commit, and pass that branch to Lusterna. Keep that seed branch unchanged for the session. This is a workaround for the researched implementation, not a change to its gates.

### 10.2 Install and pin the toolchain

Use a separate tools checkout and a Python 3.10+ virtual environment. The preparation research clone is temporary; it is not a dependency of this specification. Commands below are instructions, not actions already taken:

```sh
git clone https://github.com/Certora/lusterna.git /private/tmp/nido-lusterna-tool
git -C /private/tmp/nido-lusterna-tool checkout --detach 3524051e8b0e31caaad135e719eec1d9e6c73c68
/Users/willem/.local/share/mise/installs/python/3.12.13/bin/python3.12 -m venv /private/tmp/nido-lusterna-venv
/private/tmp/nido-lusterna-venv/bin/python -m pip install -e /private/tmp/nido-lusterna-tool
NIDO_LUSTERNA=/private/tmp/nido-lusterna-venv/bin/lusterna
"$NIDO_LUSTERNA" run --help
```

Choose and validate an exact Aeneas revision in M0/M2. Lusterna's default resolves a current release, so do not rely on that moving default for retained evidence. Aeneas pins its compatible Charon and Lean toolchain. The existing rule-core extraction provides an engineering reference, not proof that its older pin works with this Lusterna revision.

```sh
: "${NIDO_AENEAS_REF:?Set the tested exact Aeneas commit}"
NIDO_VERIFY_IMAGE=nido-lusterna-g-account:pilot
"$NIDO_LUSTERNA" build-image --tag "$NIDO_VERIFY_IMAGE" --aeneas-ref "$NIDO_AENEAS_REF"
NIDO_VERIFY_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$NIDO_VERIFY_IMAGE")
```

Retain the immutable local image ID (and registry digest if published), source commits, build logs, dependency locks, architecture and actual Rust/Charon/Aeneas/Lean/Lake/agent CLI versions. The inspected Dockerfile installs some tools without exact package pins; pinning the Lusterna commit alone does not make the image rebuild reproducibly. Record or harden those inputs before a production reproducibility claim. Never patch the proof gates to obtain a favorable result.

### 10.3 First run: inspect inferred scope

Configure `ANTHROPIC_API_KEY` through the operator's secret handling; never put its value in these files or the run manifest. Choose a per-stage cap and a fresh session ID. The operator must also monitor total cost across the campaign; the cap below is not a total-run cap.

Use the exact committed brief as the host input, so its bytes match the seed. In this filename scheme Lusterna derives the campaign identifier `C01Authority` from `01_authority.md`; passing the root file directly produces `FormalSpec`.

```sh
: "${ANTHROPIC_API_KEY:?Configure the provider credential outside the repository}"
: "${NIDO_STAGE_BUDGET_USD:?Set the per-stage spending cap}"
: "${NIDO_VERIFY_IMAGE_ID:?Build and record the toolchain image first}"
: "${NIDO_VERIFY_SESSION:?Choose a new readable session ID}"
NIDO_VERIFY_REF="nido-verification/$NIDO_VERIFY_SESSION"
git -C "$NIDO_VERIFY_REPO" branch "$NIDO_VERIFY_REF" "$NIDO_VERIFY_SEED"
if test "$(git -C "$NIDO_VERIFY_REPO" rev-parse "$NIDO_VERIFY_REF^{commit}")" != "$NIDO_VERIFY_SEED"; then
  echo 'Seed branch does not match the recorded implementation commit.' >&2
  exit 1
fi
NIDO_VERIFY_INPUT_DIR=$(mktemp -d /private/tmp/nido-lusterna-input.XXXXXX)
NIDO_VERIFY_BRIEF="$NIDO_VERIFY_INPUT_DIR/01_authority.md"
git -C "$NIDO_VERIFY_REPO" show "$NIDO_VERIFY_SEED:formal/lusterna/01_authority.md" > "$NIDO_VERIFY_BRIEF"

LUSTERNA_CC_STAGE_BUDGET_USD="$NIDO_STAGE_BUDGET_USD" \
LUSTERNA_STOP_AFTER_INFER=1 LUSTERNA_STOP_AFTER_TRANSLATE=0 LUSTERNA_STOP_BEFORE_PROVE=0 \
"$NIDO_LUSTERNA" run "$NIDO_VERIFY_REPO" "$NIDO_VERIFY_BRIEF" "$NIDO_VERIFY_REF" \
  --image "$NIDO_VERIFY_IMAGE_ID" --session-id "$NIDO_VERIFY_SESSION"

git -C "$NIDO_VERIFY_REPO" show "lusterna/$NIDO_VERIFY_SESSION:verification/infer/campaigns/C01Authority.json"
git -C "$NIDO_VERIFY_REPO" diff "lusterna/$NIDO_VERIFY_SESSION-base" "lusterna/$NIDO_VERIFY_SESSION"
```

Before continuing, verify actual functions in `target_patterns`, complete `relevant_state`, any measurement `anchor_functions`, success/refusal coverage, and a mapping to G-01..G-04. All target patterns must refer to functions/methods in the correct crate. No automatic mapping from a desired obligation to an inferred property should be assumed.

If INFER omits a requirement, stop and resolve the gap. The design document is not authoritative to Lusterna's inference, so a normal-looking output is not sufficient. A changed campaign brief or target baseline normally needs a new session; resuming a checkpoint can skip completed inference.

### 10.4 Inspect translation/statements, then prove

Resume the same session, unchanged input and baseline, through theorem generation:

```sh
LUSTERNA_CC_STAGE_BUDGET_USD="$NIDO_STAGE_BUDGET_USD" \
LUSTERNA_STOP_AFTER_INFER=0 LUSTERNA_STOP_AFTER_TRANSLATE=0 LUSTERNA_STOP_BEFORE_PROVE=1 \
"$NIDO_LUSTERNA" run "$NIDO_VERIFY_REPO" "$NIDO_VERIFY_BRIEF" "$NIDO_VERIFY_REF" \
  --image "$NIDO_VERIFY_IMAGE_ID" --session-id "$NIDO_VERIFY_SESSION"

git -C "$NIDO_VERIFY_REPO" diff "lusterna/$NIDO_VERIFY_SESSION-base" "lusterna/$NIDO_VERIFY_SESSION"
```

Review translation provenance, changes to source/toolchain files, overflow posture, state projection, target bodies, theorem assumptions and intended postconditions. At this pin the harness removes `rust-toolchain*` files from its container checkout; account for that in the diff and record the actual compiler used. Do not mistake adaptation to the extraction compiler for proof of equivalence to the deployment build.

After that review, resume with all inspection stops disabled:

```sh
LUSTERNA_CC_STAGE_BUDGET_USD="$NIDO_STAGE_BUDGET_USD" \
LUSTERNA_STOP_AFTER_INFER=0 LUSTERNA_STOP_AFTER_TRANSLATE=0 LUSTERNA_STOP_BEFORE_PROVE=0 \
"$NIDO_LUSTERNA" run "$NIDO_VERIFY_REPO" "$NIDO_VERIFY_BRIEF" "$NIDO_VERIFY_REF" \
  --image "$NIDO_VERIFY_IMAGE_ID" --session-id "$NIDO_VERIFY_SESSION"
```

Results arrive on `lusterna/<session>` with a corresponding `-base` branch. The working tree is not automatically replaced. Review the branch rather than checking it out over unrelated local changes. Exit code or a completed stage is not a substitute for examining proof coverage and the final verdict.

For recovery or signing/budget, use the corresponding brief and a new session. A prior accepted result branch can be the seed for an incremental campaign if it contains the intended implementation revision. Reconcile every reused theorem with code changes and let the harness rebuild/re-audit it. Never use a stale verified branch merely because it already contains proofs.

### 10.5 Evidence to retain

The harness owns `verification/`; do not pre-populate fake successful results or force its output into the product model directory. Its exact module names are discovered from the run. Expected evidence includes:

```text
verification/
  infer/campaigns/<Campaign>.json
  translate/campaigns/<Campaign>/
  lean/<Crate>.lean
  lean/<Crate>/Spec/<Campaign>.lean
  lean/<Crate>/Refutations.lean          # if any statements were refuted
  report/axioms.json
  report/campaigns/<Campaign>/
  VERIFICATION_REPORT.md               # or incomplete-run evidence
```

Keep a separate Nido claims ledger under the planned `formal/g-account/claims.yaml`. For each obligation, record requirement/subclaim, exact target functions, theorem names, seed/result commits, input/spec hashes, toolchain/image IDs, deployment profile, assumptions, extraction edits, axiom classification, projection/bridge status, counterexamples and host/test evidence.

Use independent fields for proof status, implementation grounding and product acceptance. An axiom-clean abstract theorem is `proven-model`; an axiom-clean theorem over faithful extracted production logic can support `proven-implementation` only with its extraction assumptions disclosed. An unresolved bridge stays unresolved. Required IDs with no theorem are missing coverage, not zero failures.

## 11. Delivery and release gates

| Stage | Deliverable | Gate |
| --- | --- | --- |
| Preparation — this change | Research, complete obligation contracts, three tool inputs and runbook | Files checked; no verification claim. |
| M0/M2 authority pilot | Real authority kernel, first inference/translation/proof campaign | G-01..G-04 covered or exact counterexamples/gaps reported; real Stellar tests separate. |
| M2/M6 recovery | State-machine implementation and second campaign | R-01..R-04, relevant A-01/A-02, trace invariants and persistence race tests. |
| M2/M5 sponsorship | Role/policy/budget implementation and third campaign | A-01/A-02/P-01/B-01/B-02 plus real provider and database conformance. |
| Before testnet pilot | Required model proofs, campaign evidence, product tests and published assumptions | No missing pre-MVP requirements concealed by partial Lusterna success. |
| Before formal production claims | E-01/I-01 refinements, reviewed extraction correspondence, independent security review and host evidence | Wording limited to actually established code/versions; no whole-wallet verification claim. |
| Later Perch/Cedar work | Implemented fragment compiler and separate C-01 campaign | No implied transfer of G-service proofs into on-chain Perch guarantees. |

Lusterna can move implementation proofs earlier than the original plan's differential-only MVP bridge. Adopt that improvement per campaign when supported by evidence. It does not automatically change the testnet release gate or make an incomplete proof an approved exception.

## 12. Source index and evidence boundaries

Research used the public source checkout at the recorded Lusterna commit, including its implementation where prose and code differ:

- [README](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/README.md): purpose, maturity and prerequisites.
- [Usage](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/docs/usage.md), [CLI](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/cli.py), [configuration](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/config.py): invocation, stops, naming, checkpoints and cost controls.
- [Container implementation](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/container.py), [Dockerfile](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/Dockerfile): committed seeding, toolchain changes, export and dependency pinning limits.
- [Pipeline](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/docs/pipeline.md), [briefings](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/briefings.py): inference, extraction, review and counterexample handling.
- [Lean checks](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/lean.py), [theorem schema guidance](https://github.com/Certora/lusterna/blob/3524051e8b0e31caaad135e719eec1d9e6c73c68/lusterna/docs/skills/mechanical-checks.md): proof status, checked statements and grounding.
- [Nido product specification](SPEC.md): authoritative product decisions, protocol/provider references and acceptance tests.
- [Rule-core extraction reference](https://github.com/stellar-registry/soroban-rule-core/blob/cbabe594ae2df408991e825e56ddd618ea29541b/formal/README.md): existing project pattern; not evidence that Nido G-account obligations are already proved.

All Nido theorem contracts, campaign boundaries and additional acceptance gates here are proposed project requirements. Upstream capabilities were inspected, not exercised against a G-account kernel during this preparation.
