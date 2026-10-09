# Threat Model (STRIDE)

Companion to [AUDIT_SCOPE.md](./AUDIT_SCOPE.md) and [SECURITY_INVARIANTS.md](./SECURITY_INVARIANTS.md). Re-categorizes [THREAT_MODEL.md](./THREAT_MODEL.md)'s assets/adversaries under STRIDE for audit intake; invariant IDs (R1, Z3, W3, ...) refer to SECURITY_INVARIANTS.md as in the source doc. No new analysis — same content, regrouped.

## Assets in scope

| Asset | Where it lives | If compromised |
| --- | --- | --- |
| Funds | The user's `perch-account` | Theft. |
| Passkey private key | The user's authenticator; never leaves it | Full control under `Loss`; ordinary activity under `Protected`. |
| Recovery kit (ZK secret) | A JSON file the user downloads | The ZK factor: alone under `ZkOnly`, half of `Combined`. |
| Guardian accounts | Each guardian's own Nido or G wallet | One guardian's share of the quorum. |
| Setup key (salt) | URL fragment, a `nido_setup_<account>` cookie, `nido:pending` storage | Whoever uses it first owns the address it derives. |
| Factory admin key | Nido operators | The account code and the verifier new accounts get. |
| Relayer keys | Fly.io host | Sponsor budget; censorship; claiming accounts being set up. |
| The wallet's deployment (`perch.TESTNET` / `PUBLIC_PERCH_DEPLOYMENT`) | Baked into the wallet at build time | Which factory, controller, pool, adapter, verifier the wallet tells users to trust. |

## Spoofing (impersonating a user, address, or trusted component)

- **Phishing link to a guardian** — asks a guardian to approve an attempt that replaces the owner's passkey with the attacker's, i.e. impersonating a legitimate recovery request. *Mitigation:* the guardian page refuses to show an Approve button for a link without the replacement set, one whose set doesn't hash to what the attempt bound, or one checked by any verifier other than the deployment's (W3); it shows the new key's ending for out-of-band confirmation with the guardian's friend. The chain itself cannot tell whose passkey a replacement is — Perch's spec deliberately puts that check on the human guardian, not the protocol. *Status:* Mitigated — the check is deliberately human and off-chain, by design, not a gap.
- **Setup-key thief** — reads the salt before the owner deploys and calls `create_account(salt, their_key)` first, i.e. impersonating the rightful creator of an address that doesn't exist yet. *Mitigation:* a second `create_account` with the same salt fails (F2), so the exposure is a pre-deploy race, not a post-deploy takeover. Residual: the relayer sees every salt too (ties to the relayer entry below). *Status:* Partial — race window closed, but relayer visibility into every salt remains (see Elevation of Privilege, relayer entry).
- **Wrong deployment** — a wallet build pointed at an attacker's factory/controller would be trusting a spoofed identity for "the real Nido deployment." *Mitigations:* the committed `perch.TESTNET` is checked field-by-field against Perch's manifest (`deployment.test.ts`); Perch's `verify-deployment.sh` checks that manifest against the chain by hash and content address. Residual risk: a `PUBLIC_PERCH_DEPLOYMENT` override bypasses the first check. *Status:* Partial — the committed manifest is checked, but the override path is not.

## Tampering (altering code, data, or an in-flight request)

- **Phishing link to a guardian** (as above) — the replacement-set tampering itself, not just the impersonation framing. *Mitigation:* see the Spoofing entry above. *Status:* Mitigated.
- **Script in the wallet origin (XSS / malicious extension / compromised CDN)** — can't read the passkey, but can swap the recovery kit before download or ask the authenticator to sign whatever the page builds. *Mitigations:* per-account origins; CSP (currently report-only — MAINNET_READINESS E1); every script bundled at build time. A substituted Barretenberg reference string (fetched from `crs.aztec.network`) makes proofs fail to verify rather than silently succeed, which caps this to a DoS outcome for that specific vector rather than a forged proof. *Status:* Partial — CSP is not yet enforcing.
- **Malicious or compromised factory admin** — can upgrade the factory to embed different account code, or repoint the verifier pin to one that accepts anything. *Mitigations:* only affects accounts created afterward; an existing account's code changes only through its own seven-day upgrade path (U1), and its verifier only through its own `apply_doc`. The admin itself must sit behind a multisig with a visible upgrade delay (MAINNET_READINESS B1) — not yet true today. *Status:* Partial / open gap — multisig + delay on the admin key is not yet in place.
- **Supply-chain attacker** — swaps a dependency, the Perch submodule, or the proving toolchain. *Mitigations:* see [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md) in full; not re-derived here. *Status:* see SUPPLY_CHAIN.md.

## Repudiation (denying having taken an action)

Not a significant category protocol-side: every account action is an on-chain Soroban transaction with on-chain `do_check_auth` verification, which is inherently non-repudiable.

- **Guardian out-of-band confirmation.** The one place a dispute could realistically arise: the "confirm the new key's ending with your friend by phone/text" step (Spoofing, above) is deliberately a human, off-chain check, so a guardian could later claim they never actually confirmed. *Mitigation:* none — intentionally left to the human, since the chain can't tell whose passkey a replacement is. *Status:* Accepted by design, not a gap to fix.

## Information Disclosure (exposing data to unauthorized parties)

- **Script in the wallet origin (XSS / malicious extension / compromised CDN)** — can read the setup keys sitting in `nido:pending` before an account exists. *Mitigations:* same as under Tampering above (per-account origins, CSP hardening in progress, build-time bundling). *Status:* Partial — same as the Tampering entry.
- **Setup-key thief** — the salt travels in a URL fragment and a cookie reaching Nido's subdomains/worker/Pages logs if they record cookies; this is the disclosure precondition for the Spoofing entry above, not a separate attack. *Mitigation:* see the Spoofing entry above. *Status:* Partial — same as the Spoofing entry.

## Denial of Service (degrading or blocking legitimate use)

- **Griefer** — opens recovery attempts without evidence, submits stale evidence, or replays proofs. *Mitigations:* opening an attempt is permissionless and blocks nothing until its condition is met (R1); a proof binds one specific statement — account, controller, network, epoch, action, attempt (R2); nullifiers can only ever be burned by an actual completion, never reserved or burned by anyone else (Z3). *Status:* Mitigated.
- **Compromised relayer (general case)** — can refuse or delay transactions and spend its own sponsor budget, but cannot forge authorization, since every transaction it submits already carries the account's own signed auth entries; it sponsors any call with valid auth, not only Nido's. Worst case here is censorship and sponsor-budget drain, not fund loss. *Mitigation:* none beyond the auth-forgery boundary itself — impact is bounded by design. *Status:* Accepted — bounded to censorship/budget drain.
- **Storage expiry** — recovery state lives in persistent storage; an expired entry is archived, never silently reset (T1), but a recovery transaction that must restore everything at once can exceed the write limit (T2), and nobody is specifically paid to renew it. *Mitigation:* archival-not-reset (T1); renewal is possible, just not incentivized or automated. *Status:* Partial.

## Elevation of Privilege (acting with authority the attacker shouldn't have)

- **Passkey thief.** Under `Loss`, the thief *is* the owner by design — full control, including changing recovery and draining funds (accepted: `Loss` assumes the key is lost, not stolen). *Mitigation:* under `Protected`, they can spend outside an authorized window but cannot change recovery, upgrade the account, or block a recovery without the enrolled condition (R5, R6, U2); once an attempt is authorized the account authorizes nothing but its completion (R4); without an enrolled baseline, any document change the thief makes invalidates a collecting attempt — compromise-recovery-from-baseline is the actual defense (R8). *Status:* Accepted by design under `Loss`; Partial under `Protected` — requiring a baseline is still open product work (#220).
- **Colluding guardians or a ZK-secret thief.** Cryptographically indistinguishable from the owner's own factor (Perch spec §2). *Mitigation:* under `Loss` the owner's veto is never capped (R6); `Combined` mode requires both factors together, and every attempt waits out a delay — the owner's window to notice and veto. *Status:* Mitigated.
- **The passkey verifier, as a single point of trust.** Any verifier that accepts any signature authorizes anything. *Mitigation:* accounts minted by the current factory name Perch's WebAuthn verifier, which has no admin and no upgrade path. *Status:* Mitigated for new accounts; Partial for legacy ones — accounts minted by older factories still name Nido's former, admin-upgradeable verifier, so that admin key remains a live trust anchor until the account moves to a new one (DEPLOYED.md, "Retired").
- **Malicious or compromised factory admin** (cross-listed with Tampering above) — the elevation framing: this key, once `upgrade()` exists, becomes a new trust anchor over account code and verifier pinning. *Mitigation:* see the Tampering entry above. *Status:* Partial / open gap — same as Tampering.
- **Compromised relayer — the account-setup exception.** This is the sharpest finding in the whole file and deserves its own line: `create_account(salt, key)` is permissionless, and the address derives from the salt alone (a Nido passkey's RP ID *is* that address, so the address must exist before the passkey does). The relayer sees the setup transaction, salt included, before it lands — a compromised relayer can submit `create_account(salt, its_own_key)` first and own the address the user's passkey was actually made for; the user's own call then just fails as a reused salt (F2). *Mitigation:* **none shipped yet** — the wallet doesn't check the new account's admin key before trusting it or moving testnet funding into it. *Status:* Open gap, tracked in #245 (candidate fixes: a wallet check of the admin key, or a factory commitment to the key before the salt is revealed).
- **The ZK verifier.** Proofs use Barretenberg's zero-knowledge flavor (`UltraKeccakZKFlavor`); the adapter refuses any other flavor. *Mitigation:* the verifier is NethermindEth's audited UltraHonk verifier plus Perch's own delta for that flavor (one new file, visibility-only changes elsewhere) — not a from-scratch implementation. *Status:* Open gap — **the delta itself is not yet audited**; Perch lists its audit as a release criterion (`vendor/perch/docs/zk/README.md`). Until then, a bug in the delta could in principle let a forged proof pass as the ZK factor, which is an elevation-of-privilege exposure, not just a correctness bug.

## Trusted parties / assumptions

- The Stellar network: consensus, RPC, and the host's secp256r1, SHA-256, BN254, and Poseidon2 functions.
- The host's CAP-0071 delegated-auth and invoker-auth behavior, as pinned by Perch's own tests (`cap-0071.md`).
- The OZ `stellar-accounts` fork at the pinned revision: `do_check_auth`, context rules, nonces.
- Perch's controller, pool, adapter, compiler, and policies behave as their source says — none has an admin or upgrade entry point, so this is trust in code at a content-addressed address, not in a party.
- The user's authenticator keeps the private key non-exportable, and the browser enforces the RP ID.
- Nido's operators, through the factory admin key, until it sits behind a multisig and delay.

## Out of scope

- Losing both the passkey and every recovery factor.
- A thief who holds the passkey and every factor of the enrolled condition.
- Device theft together with the device's unlock.
- Stellar consensus or host-function bugs; browser or OS compromise.
- Hiding which accounts use ZK recovery (Perch epic #99 non-goal).
