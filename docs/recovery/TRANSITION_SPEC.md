# Perch/Nido recovery — Stage 1 transition specification

**Status:** Design reference. This is the transition specification for
Perch/Nido account recovery, per
`firstmate/data/perch-zk-recovery-scout-p5/follow-up.md` §8 ("Specify the
transition before freezing the API"). This document and the executable
reference model in `packages/recovery-spec/` capture the state machine and
its invariants; the contracts and circuits implementing it live under
`contracts/recovery-controller`, `contracts/recovery-verifier`, and
`circuits/zk_recovery_doc` (see AGENTS.md's "Account recovery" section for
the full layer breakdown).

**Source of truth:** `firstmate/data/perch-zk-recovery-scout-p5/follow-up.md`
("the follow-up") is authoritative wherever it disagrees with the earlier
survey (`report.md`). This spec cites follow-up.md section numbers
throughout; read that document for full context before changing this one.

**Executable companion:** every rule below has a corresponding transition
function in `packages/recovery-spec/src/model.ts` and at least one test in
`packages/recovery-spec/src/{lifecycle,adversarial}.test.ts`. Where this
document says a behavior is AGREED, CONFIGURABLE, or UNRESOLVED, the code
tags the same behavior the same way — see §9.

## 1. What this spec is not

- Not a byte encoding. follow-up.md §5.3 explicitly leaves the
  proposal-commitment encoding as engineering work; this spec and the
  reference model represent commitments as plain structured records compared
  by field equality, not as a hash/signature preimage.
- Not a document schema. The reference model uses a minimal toy document
  (`{ docHash, signers: Record<role, credentialId> }`) — enough to make
  target-document construction and baseline-replacement rules executable.
  Perch's real `PolicyDoc` schema is unrelated and unaffected.
- Not a decision on §7. See §8 below — the pending-activity policy is
  recorded as an open gate with every candidate modeled, not resolved.

## 2. States

| State | Meaning | follow-up.md |
| --- | --- | --- |
| **Enrollment / configuration** | `RecoveryConfig` is set (mode, profile, guardian set and/or verifier, baseline, replaceable roles, delay/expiry, the two §7 policy parameters). No attempt is in progress. | §2, §4.1, §5.5 |
| **Evidence collection** (`collecting-evidence`) | An attempt exists; a target document and its commitment are fixed; evidence (guardian approvals and/or a ZK proof) accumulates until the enrolled mode's requirement is met. | §6 (lifecycle), §2 decision table row "Guardian non-response" |
| **Authorized pending** (`authorized-pending`) | The mode's full initiation evidence is satisfied. The delay clock starts here (`initiatedAt`, `executableAfter = initiatedAt + delaySeconds`, `expiresAt = executableAfter + expirySeconds`). | §2.1, §5.3 |
| **Ready after delay** | Not a stored state — a derived predicate `now ∈ [executableAfter, expiresAt)` over an authorized-pending attempt (follow-up.md §6: "readiness may be derived from time rather than stored as another state"). | §6 |
| **Terminal: completed** | The target document is installed, its commitment becomes the live commitment, and the attempt is consumed. | §5.3, §6 property 5 |
| **Terminal: cancelled** | The attempt is withdrawn using cancellation-domain evidence bound to this attempt. | §2.2 |
| **Terminal: expired** | The delay/evidence window elapsed without completion. No factor requirement is relaxed for the next attempt. | §2 "Guardian non-response" |
| **Terminal: invalidated** | Reachable only when `policyWriteConflictPolicy = "invalidate-attempt"` (§8) and a conflicting ordinary write or enrollment change is applied. Not reachable under any other configuration. | §7, §4.2 |

A single account has at most one non-terminal attempt at a time (see §7,
"no silent supersede"). Terminal attempts are retained in an append-only
history, not discarded, so replay/nullifier state and audit trail survive.

## 3. Transitions and authorization evidence per mode

Every account enrolls exactly one of three authentication modes. The table
gives what evidence each transition requires, per mode. "—" means the
factor is not part of that mode and the reference model actively rejects
supplying it (guardians-only must never require or accept ZK evidence, and
vice versa — see the hard constraint in §7 of this doc).

| Transition | guardians-only | ZK-only | combined |
| --- | --- | --- | --- |
| **Begin attempt** (`beginAttempt`) | No evidence yet — fixes the target document, commitment, and frozen enrollment snapshot. | same | same |
| **Reach authorized-pending** | Guardian quorum (`threshold`-of-`guardians`), each approval's commitment structurally equal to the attempt's own commitment. | One verified ZK proof over the same commitment; its nullifier not already reserved or spent. | Both of the above — independently checked against the *same* commitment (§3 below covers the "different proposals" attack). |
| **Cancel** (§4) | Guardian quorum over the *cancellation*-domain commitment for this attempt. | Verified proof over the cancellation-domain commitment. | Both. |
| **Complete** | No new evidence — the attempt already carries fully-checked initiation evidence; completion re-checks only timing (`executableAfter ≤ now < expiresAt`) and installs the target document. | same | same |
| **Reconfigure while `profile = "protected"`** | Admin **plus** guardian quorum over a `reconfigure`-domain commitment, evaluated against the *currently* enrolled guardian set (not the incoming one). | Admin **plus** a verified `reconfigure`-domain proof, evaluated against the *currently* enrolled verifier. | Admin plus both. |

Guardians-only enrollment that also declares a verifier is rejected
(`ZK_NOT_OPT_IN`) — this is a hard constraint from the brief, not a follow-up
decision, but it is enforced identically to every other rule here.
`profile = "loss"` reconfiguration requires only ordinary admin
authorization (follow-up.md §2.1: "ordinary admin can change or disable
recovery").

## 4. Cancellation domains (follow-up.md §2.2)

Cancellation is **not** initiation evidence replayed. Every proposal
commitment carries an `action` field, and cancellation evidence must carry
`action: "cancel"` while otherwise matching the attempt's commitment
exactly (account, network, controller, configVersion, target/source
identity, attemptId, delay). Reusing an initiation-domain approval or proof
as cancellation evidence fails structural equality on `action` alone
(`WRONG_DOMAIN`).

There is no branch, in any mode, where ordinary admin authorization alone
satisfies cancellation (follow-up.md §2 "Admin veto": *"Protected recovery
cannot be defeated merely by possessing the credential it is meant to
replace"*). `cancelAttempt` takes no admin-evidence parameter at all — the
enrolled recovery condition is the only accepted input.

The same domain-separation mechanism is reused for protected-profile
reconfiguration (`action: "reconfigure"`), so a stolen admin key cannot
downgrade or disable protection using evidence collected for some other
purpose (follow-up.md §4.3, §2.1).

## 5. Configuration versioning

`RecoveryConfig.version` increments by exactly 1 on every successful
`enroll` call. An attempt freezes the enrollment parameters it evaluates
evidence against (`FrozenRecoveryParams`: mode, guardian set, verifier,
delay, expiry, version) at `beginAttempt` time, not at evidence-check time —
so a later enrollment change cannot reinterpret an attempt already in
flight (follow-up.md §6 property 9, "configuration consistency"). Whether an
enrollment change is even *permitted* while an attempt is live is itself
part of the §7 gate — see §8.

`revokedCredentialIds` is part of `RecoveryConfig` but is **not** reset by
`enroll`; it is carried forward across every version bump (§7 in this doc /
follow-up.md §6 property 10).

## 6. Target-document construction (follow-up.md §4.1–§4.2)

```
lost-key target   = current approved document (a defined source snapshot) with designated credentials replaced
compromise target = enrolled baseline document                            with designated credentials replaced
```

- **Source, lost-key:** the account's live document at the moment
  `beginAttempt` is called — captured into the attempt (`sourceSnapshotDoc`)
  so later live-document changes cannot silently retarget an in-flight
  attempt. What happens to *those later changes* is the §7-adjacent conflict
  policy (§8).
- **Source, compromise:** the enrolled baseline document, **not** the live
  document — this is what discards anything an attacker planted after the
  baseline was approved (required property #7, "compromise postcondition").
- **Replacement:** each `CredentialReplacement { role, oldCredentialId,
  newCredentialId }` must name a role the current enrollment designates as
  replaceable (`NOT_REPLACEABLE` otherwise), and the new credential must not
  be a previously revoked one (`REVOKED_CREDENTIAL_REVIVED`).
- **Fixed for the attempt's lifetime:** the target document and its hash are
  computed once, at `beginAttempt`, and never recomputed. Substituting
  credentials requires a new proposal (follow-up.md §4.2).

## 7. Baseline replacement rules (follow-up.md §4.1)

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
   is what makes required property #10 ("an old baseline must not restore
   revoked credentials on a later recovery") hold across cycles, not just
   within one.

## 8. Repeated-recovery behavior

- **No silent supersede.** `beginAttempt` rejects outright
  (`ATTEMPT_ALREADY_ACTIVE`) if a non-terminal attempt already exists.
  Nido's current `initiate_recovery` silently supersedes a stale pending
  recovery (report.md §2.1); this reference model deliberately does **not**
  carry that behavior forward, because silently replacing a live attempt
  would let a new initiation act as an uncancelled cancellation — bypassing
  the cancellation-evidence requirement in §4. This is a Stage 1 reference-
  model design decision, not a follow-up.md-mandated rule; flag it
  explicitly if Stage 2/3 need nido's superseding behavior for compatibility.
- **After completion:** the attempt is terminal (`completed`) forever; a
  second `completeAttempt` call — same transaction, same ledger, or after
  expiry — fails (`NOT_READY` / `NO_ACTIVE_ATTEMPT`), because consumption is
  keyed off attempt *state*, not a ledger-scoped flag. This is a direct fix
  for the gap follow-up.md §3.1 identifies in nido's spike (`CompletionGrant`
  is set but never consumed) — see the regression test in
  `adversarial.test.ts` that reproduces the flawed check side-by-side with
  the corrected one.
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

## 9. Proposal-commitment fields (follow-up.md §5.3)

The reference model's `ProposalCommitment` carries exactly the fields §5.3
lists, with the encoding left open as instructed:

| §5.3 field | Model field |
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
action, configuration, and intended document" (required property #2)
reduces to at the model level.

**Explicitly not specified here** (per §5.3, "the precise encoding remains
engineering work"): the byte layout, hashing/signing scheme, and how a real
guardian or ZK adapter actually produces a `commitment`-bound approval or
proof. The model only specifies which fields must bind and that they must
match exactly.

## 10. The Section 7 gate (OPEN — not decided by this document)

follow-up.md §7 is explicit: *"No freeze or continue default selected"* and
*"a production release must resolve this gate."* This spec and the reference
model **do not** select a default. Two axes are modeled as required,
non-defaulted parameters — every call site (including every test) must
state its choice, and there is no code path that falls back to one branch
when a value is unrecognized (`model.ts`'s `ordinaryExecute`/
`ordinaryPolicyWrite` switches have no `default:` case; the adversarial
suite proves this by passing an invalid value and observing `undefined`,
not a silently-chosen outcome — see the test "has no evaluable branch for an
unrecognized policy value").

| Parameter | Candidates | Governs |
| --- | --- | --- |
| `pendingActivityPolicy` | `freeze` \| `continue` \| **`restrict`** (left symbolic per the brief) | Ordinary account-authorized execution once an attempt reaches authorized-pending. |
| `policyWriteConflictPolicy` | `block` \| `invalidate-attempt` \| **`other`** (symbolic placeholder) | Ordinary, non-recovery document writes that conflict with a live *lost-key* attempt's source snapshot (§6). |

`restrict` and `other` are not implemented as real capability boundaries —
follow-up.md §7 says `restrict` "requires an explicit capability boundary
and more validation," which Stage 1 does not attempt to define. Both throw
a distinct `UNRESOLVED_POLICY_BRANCH` error rather than aliasing to one of
the other branches, so no caller can mistake "not yet specified" for
"resolved to the conservative option."

Guardian non-response never becomes an implicit bypass under any branch
(follow-up.md §2, "required guardians do not become optional through
timeout") — this holds independent of which §7 branch is selected, since
none of the three affects evidence *requirements*, only ordinary activity
and policy-write conflicts.

## 11. Adversarial validation checklist (follow-up.md §8)

Every item from "Minimum adversarial validation" that is expressible at
this abstraction level has at least one test in
`packages/recovery-spec/src/adversarial.test.ts`, tagged in the `describe`
title:

| §8 item | Tag | Test(s) |
| --- | --- | --- |
| Repeated completion (same tx/ledger, after expiry) | AGREED | "single completion" describe block |
| Ordinary admin using recovery-only mutation authority | AGREED | "ordinary admin cannot exercise recovery-only mutation authority" |
| Changed target keys/fields/action/network/account/configuration after approval | AGREED | "attempt integrity" (parameterized over 7 fields) |
| Combined-mode proof and guardian approvals referring to different proposals | AGREED | "combined-mode proof and guardian approvals must refer to the same proposal" |
| Cancellation with initiation evidence / admin alone / missing factor | AGREED | "cancellation domain" (3 tests) |
| Guardian non-response without automatic bypass | AGREED | "guardian non-response has no automatic bypass" |
| Compiler/install failure after authorization — rollback check | AGREED | "atomicity of completion" |
| Rule teardown that panics in `uninstall` | **OUT OF SCOPE** | Requires the real OZ `Policy`/contract integration (Stage 2/3); not expressible over the abstract state machine. |
| Attacker-added signer removal (compromise) vs. preservation limits (lost-key) | AGREED | "compromise vs lost-key postconditions" |
| Every occurrence of an old credential removed; no later revival | AGREED | "revoked credentials are never revived" (2 tests) |
| Baseline update / profile downgrade / verifier change under current authorization | AGREED | "protected-profile changes require the current recovery condition" |
| Competing policy updates and recovery attempts under each candidate §7 policy | **UNRESOLVED** | "pendingActivityPolicy has no default" (4 tests), "policyWriteConflictPolicy has no default" (4 tests) |
| Expired/archived controller data, durable replay, recovery without old admin credential | AGREED | "nullifier replay" (2 tests), "recovery never requires the old admin credential" |
| Rust/client canonicalization agreement, unchanged hashes without recovery | **OUT OF SCOPE** | Requires a real cross-language canonicalization suite (Stage 4, follow-up.md §5.5); the toy `hashDoc` here is not a canonicalization candidate. |

Two additional properties not literally in the §8 list but load-bearing for
the reference model's own correctness are also tested: "no silent supersede
of a live attempt" (AGREED, derived from §6 properties 8–9, see §8 of this
doc) and the guardians-only-must-not-require-ZK hard constraint from the
brief (AGREED).

## 12. Non-goals restated (follow-up.md §9)

This spec makes no claim beyond what follow-up.md §9 already disclaims:
no production implementation, no security audit, nido's spike grant remains
unapproved as an upstream primitive, the reference model does not assume
any real Noir/UltraHonk circuit already binds a document hash, and no §7
default has been chosen anywhere in this deliverable.

## 13. Where the code lives

- `packages/recovery-spec/src/types.ts` — domain types, including both §7
  parameter enums.
- `packages/recovery-spec/src/model.ts` — the transition functions.
- `packages/recovery-spec/src/lifecycle.test.ts` — happy-path walk-throughs
  per mode.
- `packages/recovery-spec/src/adversarial.test.ts` — the checklist in §11.
- `npm test -w @nidohq/recovery-spec` (or `cd packages/recovery-spec && npm
  test`) runs the suite; `npm run typecheck -w @nidohq/recovery-spec` type-
  checks it.
