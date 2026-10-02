# Threat Model

Companion to [AUDIT_SCOPE.md](./AUDIT_SCOPE.md) and
[SECURITY_INVARIANTS.md](./SECURITY_INVARIANTS.md). States what Nido protects,
against whom, and what it explicitly assumes it can trust.

## Assets

| Asset | Where | Impact if compromised |
|---|---|---|
| User funds (XLM + tokens) | Smart Account C-address | Direct theft. |
| Passkey (P-256 private key) | User's authenticator (never leaves device) | Full account control. |
| Recovery enrollment secret | Client-derived; commitment in the Merkle pool | Ability to initiate account recovery (rotate the signer after timelock). |
| `G_temp` ephemeral funding key | Onboarding only, then discarded | Theft of pre-migration funds; account hijack during deployment. |
| Relayer sponsor keys | Relayer host | Drain of the fee-sponsor budget; tx censorship. |
| Registry name → address mapping | Stellar Registry | Mis-resolution of verifier / recovery controller for newly created accounts. |
| Enrolled guardian keys (`RecoveryConfig.guardians`) | Each guardian's own wallet/key | A colluding quorum (`>= guardian_threshold`) can authorize a `GuardianOnly`/`Combined` recovery attempt, or (`Profile::Protected`) a config `reconfigure` — comparable blast radius to a stolen passkey for accounts enrolled in that mode. |
| Recovery config commitment (`RecoveryConfig`, incl. `baseline_doc_hash`, `replaceable`) | `contracts/recovery-controller` storage, per account | Governs who can recover an account and which credentials a successful recovery may replace. `reconfigure` can only ever ADD a missing evidence factor — `baseline_doc_hash`/`replaceable`/timing fields can never change post-enrollment by any path, legitimate or not. |

## Adversaries & the attacks in scope

1. **Malicious dApp / phishing site.** Crafts signing requests, spoofs the origin
   display, or tries to exfiltrate a signature over a payload the user didn't
   understand. *Mitigations:* per-subdomain WebAuthn RP-ID isolation; the challenge
   binds the exact tx payload; callback/return-URL validation (**hardening in
   progress for the legacy query-param sign path** — see SECURITY_INVARIANTS I7).
2. **Browser-resident attacker (XSS / malicious extension).** Tries to run script in
   the wallet origin to read stored credential material or hijack a ceremony.
   *Mitigations:* strict CSP + security headers (**being added**); private key never
   leaves the authenticator.
3. **Passkey thief (stolen device / cloned credential).** Has the passkey but not the
   recovery secret. *Mitigations:* they cannot forge a recovery proof; the in-account
   guard + `cancel_recovery`/`burn_nullifier` require BOTH account auth AND a fresh
   ZK proof of secret knowledge, so a passkey alone cannot grief recovery.
4. **Recovery-secret holder / griefer.** Knows a leaked enrollment secret (or a public
   nullifier). *Mitigations:* recovery is **timelocked** (14d mainnet) so the owner
   can notice and `cancel`; rate-limited (3 / 90d); cancel cap + cooldown bound
   grief; nullifier binding + `auth_hash` recomputation prevent cross-account reuse.
5. **Compromised relayer.** *Mitigations:* it only sponsors/submits; it cannot forge
   account auth (all verification is on-chain). Worst case is censorship + sponsor-
   budget drain. **Key custody must move to KMS/HSM before mainnet** (blocker A4).
6. **Compromised / repointed Stellar Registry.** Could point new accounts at a
   malicious verifier or recovery controller. *Mitigations (planned):* factory pins
   expected addresses and reverts on mismatch (B2); registry key under multisig.
7. **Supply-chain attacker.** Swaps a dependency or the vendored verifier. *Mitigations:*
   pinned deps, vendored-verifier checksum guard, toolchain version pins (see
   SUPPLY_CHAIN.md). Residual risk: OZ pinned to an untagged main commit.
8. **Malicious/mistaken admin (post-B1 upgradability).** Once `upgrade()` exists, the
   admin key is a new trust anchor. *Mitigations:* multisig admin + upgrade timelock
   so users can exit before a bad upgrade lands.
9. **Colluding guardian quorum (M2 `GuardianOnly`/`Combined` accounts).** `>= guardian_threshold`
   guardians sign a malicious `begin_attempt` + `submit_guardian_approval` sequence, or
   (Protected profile) a malicious `reconfigure`. *Mitigations:* `delay_secs` timelock
   before completion gives the owner a window to react (e.g.
   `initiate_recovery_rule_removal`, itself guarded by the same live-pending check);
   `Combined` mode requires the quorum AND a valid ZK proof together (`&&`, never
   `||` — SECURITY_INVARIANTS RC5); cancellation uses its own domain-separated
   `CancelTally`, distinct from initiation evidence. *Residual risk:* no guardian-set
   rotation exists post-enrollment (`reconfigure` only adds a missing factor, never
   swaps/rotates guardians) — see nidohq/nido#221-adjacent gaps.
10. **Invoker-auth confusion on `enroll`/`reconfigure` (nidohq/nido#217).** The
    controller's `enroll`/`reconfigure` require only `account.require_auth()`, with
    no way yet to distinguish a genuine `apply_doc`-driven cross-call from an
    external caller separately holding valid auth for the same account and invoking
    the controller directly. *Mitigations (partial):* `apply_doc`'s own checks
    (`RecoveryControllerMismatch`, `RecoveryConfigWithoutWiring` —
    `contracts/smart-account/src/doc.rs`) bind the DOC-DRIVEN path; a direct,
    out-of-band cross-call to the controller has no equivalent binding today. Open,
    tracked, not closed.

## Trusted parties / assumptions

- The **Stellar network** (consensus, RPC, host crypto functions incl. secp256r1 and
  BN254 point validation) behaves correctly.
- **OpenZeppelin `stellar-accounts`** at the pinned rev correctly implements
  `do_check_auth`, context-rule enforcement, and nonce replay protection.
- The user's **authenticator** keeps the P-256 private key non-exportable.
- The **WebAuthn RP-ID / DNS** binding is honored by the browser (per-subdomain
  passkey isolation depends on it).
- After B1, the **admin multisig** signers are honest-majority and the upgrade
  timelock is respected.
- For accounts enrolled in `GuardianOnly`/`Combined` mode, the **currently-enrolled
  guardian set** is a trust anchor: a quorum of them is trusted not to collude on a
  malicious recovery attempt, and (for `Profile::Protected`) not to collude on a
  malicious `reconfigure`.

## Out of scope

- Physical device theft *with* the user's biometric/PIN.
- Nation-state / rubber-hose attacks.
- Stellar consensus-layer or host-function bugs.
- Compromise of the user's browser vendor or OS.
- Loss of BOTH the passkey and the recovery secret (unrecoverable by design).
- The M2 guardian-quorum/ZK recovery system's deliberately-deferred gaps (invoker-auth
  wiring, approximate timelock, reconfigure/completion interaction, guardian-rotation,
  etc.) are tracked as open issues, not silent gaps — see MAINNET_READINESS.md §G for
  the full, numbered list.
