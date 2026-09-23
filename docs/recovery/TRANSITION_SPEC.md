# Perch/Nido recovery — transition specification

**Status:** Design reference. This document specifies the state machine and
invariants for Perch/Nido account recovery's transition model — nailed down
here before the recovery API is frozen. This document and the executable
reference model in `packages/recovery-spec/` are the canonical description
of that state machine; the contracts and circuits implementing it live under
`contracts/recovery-controller`, `contracts/recovery-verifier`, and
`circuits/zk_recovery_doc` (see AGENTS.md's "Account recovery" section for
the full layer breakdown).

**Executable companion:** every rule below has a corresponding transition
function in `packages/recovery-spec/src/model.ts` and at least one test in
`packages/recovery-spec/src/{lifecycle,adversarial}.test.ts`. Where this
document says a behavior is AGREED, CONFIGURABLE, or UNRESOLVED, the code
tags the same behavior the same way — see §9.

## 1. What this spec is not

- Not a byte encoding. The proposal-commitment encoding (byte layout,
  hashing/signing scheme) is left as engineering work for the implementation
  stage; this spec and the reference model represent commitments as plain
  structured records compared by field equality, not as a hash/signature
  preimage.
- Not a document schema. The reference model uses a minimal toy document
  (`{ docHash, signers: Record<role, credentialId> }`) — enough to make
  target-document construction and baseline-replacement rules executable.
  Perch's real `PolicyDoc` schema is unrelated and unaffected.
- Not a decision on the pending-activity policy question. See §10 below —
  it is recorded as an open gate, with every candidate modeled, not
  resolved.

## 2. States

| State | Meaning |
| --- | --- |
| **Enrollment / configuration** | `RecoveryConfig` is set (mode, profile, guardian set and/or verifier, baseline, replaceable roles, delay/expiry, the two §10 policy parameters). No attempt is in progress. |
| **Evidence collection** (`collecting-evidence`) | An attempt exists; a target document and its commitment are fixed; evidence (guardian approvals and/or a ZK proof) accumulates until the enrolled mode's requirement is met. |
| **Authorized pending** (`authorized-pending`) | The mode's full initiation evidence is satisfied. The delay clock starts here (`initiatedAt`, `executableAfter = initiatedAt + delaySeconds`, `expiresAt = executableAfter + expirySeconds`). |
| **Ready after delay** | Not a stored state — a derived predicate `now ∈ [executableAfter, expiresAt)` over an authorized-pending attempt. Readiness is derived from time rather than stored as another state field, since a separate stored flag would just duplicate information the timestamps already carry. |
| **Terminal: completed** | The target document is installed, its commitment becomes the live commitment, and the attempt is consumed. |
| **Terminal: cancelled** | The attempt is withdrawn using cancellation-domain evidence bound to this attempt. |
| **Terminal: expired** | The delay/evidence window elapsed without completion. No factor requirement is relaxed for the next attempt. |
| **Terminal: invalidated** | Reachable only when `policyWriteConflictPolicy = "invalidate-attempt"` (§10) and a conflicting ordinary write or enrollment change is applied. Not reachable under any other configuration. |

A single account has at most one non-terminal attempt at a time (see §8,
"no silent supersede"). Terminal attempts are retained in an append-only
history, not discarded, so replay/nullifier state and audit trail survive.

## 3. Transitions and authorization evidence per mode

Every account enrolls exactly one of three authentication modes. The table
gives what evidence each transition requires, per mode. "—" means the
factor is not part of that mode and the reference model actively rejects
supplying it (guardians-only must never require or accept ZK evidence, and
vice versa — this hard constraint is stated explicitly just below).

| Transition | guardians-only | ZK-only | combined |
| --- | --- | --- | --- |
| **Begin attempt** (`beginAttempt`) | No evidence yet — fixes the target document, commitment, and frozen enrollment snapshot. | same | same |
| **Reach authorized-pending** | Guardian quorum (`threshold`-of-`guardians`), each approval's commitment structurally equal to the attempt's own commitment. | One verified ZK proof over the same commitment; its nullifier not already reserved or spent. | Both of the above — independently checked against the *same* commitment (see the "combined-mode proof and guardian approvals must refer to the same proposal" checklist item in §11 for the attack this guards against). |
| **Cancel** (§4) | Guardian quorum over the *cancellation*-domain commitment for this attempt. | Verified proof over the cancellation-domain commitment. | Both. |
| **Complete** | No new evidence — the attempt already carries fully-checked initiation evidence; completion re-checks only timing (`executableAfter ≤ now < expiresAt`) and installs the target document. | same | same |
| **Reconfigure while `profile = "protected"`** | Admin **plus** guardian quorum over a `reconfigure`-domain commitment, evaluated against the *currently* enrolled guardian set (not the incoming one). | Admin **plus** a verified `reconfigure`-domain proof, evaluated against the *currently* enrolled verifier. | Admin plus both. |

Guardians-only enrollment that also declares a verifier is rejected
(`ZK_NOT_OPT_IN`) — this is a hard constraint of the recovery design,
enforced identically to every other rule here. `profile = "loss"`
reconfiguration requires only ordinary admin authorization — the `loss`
profile exists precisely so ordinary admin can change or disable recovery
without extra evidence.

## 4. Cancellation domains

Cancellation is **not** initiation evidence replayed. Every proposal
commitment carries an `action` field, and cancellation evidence must carry
`action: "cancel"` while otherwise matching the attempt's commitment
exactly (account, network, controller, configVersion, target/source
identity, attemptId, delay). Reusing an initiation-domain approval or proof
as cancellation evidence fails structural equality on `action` alone
(`WRONG_DOMAIN`).

There is no branch, in any mode, where ordinary admin authorization alone
satisfies cancellation: protected recovery cannot be defeated merely by
possessing the credential it is meant to replace. `cancelAttempt` takes no
admin-evidence parameter at all — the enrolled recovery condition is the
only accepted input.

The same domain-separation mechanism is reused for protected-profile
reconfiguration (`action: "reconfigure"`), so a stolen admin key cannot
downgrade or disable protection using evidence collected for some other
purpose.

## 5. Configuration versioning

`RecoveryConfig.version` increments by exactly 1 on every successful
`enroll` call. An attempt freezes the enrollment parameters it evaluates
evidence against (`FrozenRecoveryParams`: mode, guardian set, verifier,
delay, expiry, version) at `beginAttempt` time, not at evidence-check time —
so a later enrollment change cannot reinterpret an attempt already in
flight (this is required property 9, "configuration consistency" — see
`contracts/recovery-controller/src/lib.rs`'s numbered "Required properties"
list, which this reference model's properties mirror). Whether an
enrollment change is even *permitted* while an attempt is live is itself
part of the pending-activity/policy-write-conflict gate — see §10.

`revokedCredentialIds` is part of `RecoveryConfig` but is **not** reset by
`enroll`; it is carried forward across every version bump — see §7, whose
replacement rules are what make required property 10 ("continued
recoverability": an old baseline must not restore a revoked credential on a
later recovery) hold across cycles, not just within one.

## 6. Target-document construction

```
lost-key target   = current approved document (a defined source snapshot) with designated credentials replaced
compromise target = enrolled baseline document                            with designated credentials replaced
```

- **Source, lost-key:** the account's live document at the moment
  `beginAttempt` is called — captured into the attempt (`sourceSnapshotDoc`)
  so later live-document changes cannot silently retarget an in-flight
  attempt. What happens to *those later changes* is governed by the
  policy-write-conflict policy — see §10.
- **Source, compromise:** the enrolled baseline document, **not** the live
  document — this is what discards anything an attacker planted after the
  baseline was approved (required property 7, "compromise postcondition" —
  see `contracts/recovery-controller/src/lib.rs`'s "Required properties"
  list).
- **Replacement:** each `CredentialReplacement { role, oldCredentialId,
  newCredentialId }` must name a role the current enrollment designates as
  replaceable (`NOT_REPLACEABLE` otherwise), and the new credential must not
  be a previously revoked one (`REVOKED_CREDENTIAL_REVIVED`).
- **Fixed for the attempt's lifetime:** the target document and its hash are
  computed once, at `beginAttempt`, and never recomputed. Substituting
  credentials requires a new proposal.

## 7. Baseline replacement rules

1. Every role named in a replacement must currently hold the exact
   `oldCredentialId` claimed, or the replacement is rejected
   (`STALE_REPLACEMENT`) rather than silently applied to the wrong entry.
2. After replacement, the *old* credential id must not be reachable under
   **any** role in the resulting document — not just the one nominally
   replaced (`RESIDUAL_OLD_CREDENTIAL`). This is checked structurally by
   scanning the constructed target document, not asserted by convention.
3. A completed attempt's replaced credential ids are added to
   `revokedCredentialIds` permanently. Both `beginAttempt` (as a
   `newCredentialId`) and `enroll` (anywhere in a new baseline's signers)
   reject reintroducing a revoked id (`REVOKED_CREDENTIAL_REVIVED`) — this
   is what makes required property 10 ("an old baseline must not restore
   revoked credentials on a later recovery") hold across cycles, not just
   within one.

## 8. Repeated-recovery behavior

- **No silent supersede.** `beginAttempt` rejects outright
  (`ATTEMPT_ALREADY_ACTIVE`) if a non-terminal attempt already exists.
  Nido's pre-existing `initiate_recovery` (the earlier, already-deployed M1
  zk-recovery flow) silently supersedes a stale pending recovery; this
  reference model deliberately does **not** carry that behavior forward,
  because silently replacing a live attempt would let a new initiation act
  as an uncancelled cancellation — bypassing the cancellation-evidence
  requirement in §4. This is a deliberate design decision for this
  reference model, not a constraint inherited from the earlier flow; flag
  it explicitly if a later implementation needs the earlier flow's
  superseding behavior for compatibility.
- **After completion:** the attempt is terminal (`completed`) forever; a
  second `completeAttempt` call — same transaction, same ledger, or after
  expiry — fails (`NOT_READY` / `NO_ACTIVE_ATTEMPT`), because consumption is
  keyed off attempt *state*, not a ledger-scoped flag. This is a direct fix
  for a gap in the earlier zk-recovery prototype's completion mechanism,
  where a `CompletionGrant` flag was set but never consumed by the
  completion it granted — see the regression test in
  `adversarial.test.ts` that reproduces the flawed check side-by-side with
  the corrected one, and `docs/recovery/stage2-findings.md`'s
  call-ordering analysis for the fuller picture.
- **After cancellation:** any reserved ZK nullifier is released (not spent)
  and a fresh attempt may be started; it still requires the full enrolled
  evidence from scratch (no carried-over partial quorum).
- **After expiry:** identical release behavior to cancellation. Expiry
  applies to both `collecting-evidence` (stalled evidence gathering — the
  reference model's answer to "guardian non-response," reusing
  `expirySeconds` measured from attempt creation; this specific reuse is
  CONFIGURABLE, not mandated) and `authorized-pending` (the standard delay
  window).
- **Nullifiers:** `reservedNullifiers` and `spentNullifiers` are tracked at
  the account level, independent of any single attempt, so spent-forever
  vs. released-on-cancel/expiry semantics survive across attempts.

## 9. Proposal-commitment fields

The reference model's `ProposalCommitment` carries exactly the fields
below, with the encoding left open as engineering work for the
implementation stage:

| Commitment field | Model field |
| --- | --- |
| Network and account identity | `network`, `account` |
| Controller/protocol identity and action | `controllerId`, `action` (`"lost-key" \| "compromise" \| "cancel" \| "reconfigure"`) |
| Recovery-configuration version and baseline/source identity | `configVersion`, `baselineOrSourceId` |
| Target document hash | `targetDocHash` |
| Attempt nonce/identity and applicable timing terms | `attemptId`, `delaySeconds` |

Two evidence types reference a commitment: `GuardianApproval { guardian,
commitment }` and `ZkProof { nullifier, commitment, verified }`. Every
evidence-accepting transition checks the supplied commitment for exact
structural equality against the expected one (attempt's own commitment for
initiation, the attempt's commitment with `action` overridden to `"cancel"`
for cancellation) — this is what "all evidence refers to the same account,
action, configuration, and intended document" (required property 2,
"attempt integrity") reduces to at the model level.

**Explicitly not specified here:** the byte layout, hashing/signing scheme,
and how a real guardian or ZK adapter actually produces a `commitment`-bound
approval or proof — this is left as engineering work for the implementation
stage. The model only specifies which fields must bind and that they must
match exactly.

## 10. Pending-activity and policy-write-conflict policy (OPEN — not decided by this document)

This project has deliberately left the choice between `freeze` and
`continue` open: no default has been selected, and a production release
must resolve this gate before shipping. This spec and the reference model
**do not** select a default. Two axes are modeled as required,
non-defaulted parameters — every call site (including every test) must
state its choice, and there is no code path that falls back to one branch
when a value is unrecognized (`model.ts`'s `ordinaryExecute`/
`ordinaryPolicyWrite` switches have no `default:` case; the adversarial
suite proves this by passing an invalid value and observing `undefined`,
not a silently-chosen outcome — see the test "has no evaluable branch for an
unrecognized policy value").

| Parameter | Candidates | Governs |
| --- | --- | --- |
| `pendingActivityPolicy` | `freeze` \| `continue` \| **`restrict`** (left symbolic, deliberately unimplemented) | Ordinary account-authorized execution once an attempt reaches authorized-pending. |
| `policyWriteConflictPolicy` | `block` \| `invalidate-attempt` \| **`other`** (symbolic placeholder) | Ordinary, non-recovery document writes that conflict with a live *lost-key* attempt's source snapshot (§6). |

`restrict` and `other` are not implemented as real capability boundaries —
`restrict` would require an explicit capability boundary and more
validation than this reference model defines. Both throw a distinct
`UNRESOLVED_POLICY_BRANCH` error rather than aliasing to one of the other
branches, so no caller can mistake "not yet specified" for "resolved to the
conservative option."

Guardian non-response never becomes an implicit bypass under any branch —
required guardians do not become optional through timeout. This holds
independent of which policy branch above is selected, since none of the
three affects evidence *requirements*, only ordinary activity and
policy-write conflicts.

## 11. Adversarial validation checklist

Every item in this project's minimum adversarial-validation checklist that
is expressible at this abstraction level has at least one test in
`packages/recovery-spec/src/adversarial.test.ts`, tagged in the `describe`
title:

| Checklist item | Tag | Test(s) |
| --- | --- | --- |
| Repeated completion (same tx/ledger, after expiry) | AGREED | "single completion" describe block |
| Ordinary admin using recovery-only mutation authority | AGREED | "ordinary admin cannot exercise recovery-only mutation authority" |
| Changed target keys/fields/action/network/account/configuration after approval | AGREED | "attempt integrity" (parameterized over 7 fields) |
| Combined-mode proof and guardian approvals referring to different proposals | AGREED | "combined-mode proof and guardian approvals must refer to the same proposal" |
| Cancellation with initiation evidence / admin alone / missing factor | AGREED | "cancellation domain" (3 tests) |
| Guardian non-response without automatic bypass | AGREED | "guardian non-response has no automatic bypass" |
| Compiler/install failure after authorization — rollback check | AGREED | "atomicity of completion" |
| Rule teardown that panics in `uninstall` | **OUT OF SCOPE** | Requires the real OZ `Policy`/contract integration exercised in `docs/recovery/stage2-findings.md` and `docs/recovery/stage3-measurements.md`; not expressible over the abstract state machine. |
| Attacker-added signer removal (compromise) vs. preservation limits (lost-key) | AGREED | "compromise vs lost-key postconditions" |
| Every occurrence of an old credential removed; no later revival | AGREED | "revoked credentials are never revived" (2 tests) |
| Baseline update / profile downgrade / verifier change under current authorization | AGREED | "protected-profile changes require the current recovery condition" |
| Competing policy updates and recovery attempts under each candidate policy (§10) | **UNRESOLVED** | "pendingActivityPolicy has no default" (4 tests), "policyWriteConflictPolicy has no default" (4 tests) |
| Expired/archived controller data, durable replay, recovery without old admin credential | AGREED | "nullifier replay" (2 tests), "recovery never requires the old admin credential" |
| Rust/client canonicalization agreement, unchanged hashes without recovery | **OUT OF SCOPE** | Requires a real cross-language canonicalization suite — genuinely future work this project has not built yet; the toy `hashDoc` here is not a canonicalization candidate. |

Two additional properties not literally in the checklist above but
load-bearing for the reference model's own correctness are also tested:
"no silent supersede of a live attempt" (AGREED, derived from required
properties 8–9 — see `contracts/recovery-controller/src/lib.rs`'s numbered
list — and §8 of this doc) and the hard constraint that guardians-only
enrollment must never require or accept ZK evidence (AGREED).

## 12. Non-goals

This spec makes no claim beyond the following: no production
implementation, no security audit, the pre-existing `circuits/zk_recovery`/
`contracts/zk-recovery` module remains an experimental prototype, not an
approved upstream primitive, the reference model does not assume any real
Noir/UltraHonk circuit already binds a document hash, and no default has
been chosen anywhere in this deliverable for the pending-activity/
policy-write-conflict gate (§10).

## 13. Where the code lives

- `packages/recovery-spec/src/types.ts` — domain types, including both §10
  parameter enums.
- `packages/recovery-spec/src/model.ts` — the transition functions.
- `packages/recovery-spec/src/lifecycle.test.ts` — happy-path walk-throughs
  per mode.
- `packages/recovery-spec/src/adversarial.test.ts` — the checklist in §11.
- `npm test -w @nidohq/recovery-spec` (or `cd packages/recovery-spec && npm
  test`) runs the suite; `npm run typecheck -w @nidohq/recovery-spec` type-
  checks it.
