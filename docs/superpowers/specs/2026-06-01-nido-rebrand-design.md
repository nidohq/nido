# Nido — Brand Identity Spec

**Date:** 2026-06-01
**Status:** Approved (brainstorm) — pending implementation plan
**Supersedes:** the `g2c` working name ("G-address to C-address")

> This is a **brand/identity** spec — the strategy, name, and visual+verbal system. It does **not** cover the code rename/migration; that becomes its own implementation plan (see [Out of Scope](#out-of-scope)).

---

## 1. Why rebrand

`g2c` names an internal mechanic (Stellar G-address → Soroban C-address). A non-crypto user has no idea what a G-address, a C-address, or Soroban is — and shouldn't need to. The product is also growing past "wallet": passkey accounts today, programmable **policies** (limits, approvals, recovery, session keys) now, and **zk proofs** (private, verifiable claims) ahead. The brand must read as a consumer product, not a crypto tool, and must have room for identity + proofs, not just money.

## 2. Positioning

**The slot we own:**

> **Your account for the new internet — pay, prove who you are, and log in anywhere — that just feels like a normal app.**

The breadth of an *account* (money + identity + access), delivered with the surface of a *normal app*. The crypto disappears.

**It IS (to the user):**
- One account for money, identity, and access
- Prove things about yourself without oversharing (zk)
- Rules & recovery built in
- Feels like signing in with Face ID

**It is NOT:**
- "A crypto wallet"
- Chains, gas, addresses, tokens
- Seed phrases & browser extensions
- Anything that says "Soroban / Stellar"

## 3. Name — **Nido**

"Nido" = *nest* (Spanish/Italian). A warm, protective place that holds everything that's yours. Short, speakable, globally friendly, and a clean break from crypto signaling.

**Personality:** **Warm + bold** — "a friend who's got your back." Trustworthy enough for money, confident enough to feel like a movement. Reference lane: Cash App / Monzo / Duolingo.

**Availability (verified 2026-06-01 via RDAP + GitHub):**
- Domains: `nido.com`/`.app`/`.money` are taken. **Available: `nido.io`, `nido.co`, `nido.finance`.** Primary recommendation: **`nido.co`** (short, clean), with `nido.io`/`nido.finance` as supporting acquisitions.
- GitHub org: `nido` taken → **claim `nidohq`** (available).
- Known tradeoff (accepted): "Nido" is a common dictionary word and Nestlé's milk brand. No prominent *fintech* collision. SEO/trademark strategy must lean hard on the "nest/account" meaning. **Run a proper trademark search in the relevant classes before any public launch.**

## 4. Logo — The Nest Ring

Two concentric woven (dashed) rings cradling a solid dot at the center.

- **Meaning:** woven rings = the nest; the center dot = *you*, protected. Reads simultaneously as a nest and a protective halo.
- **Construction:** outer ring coral, inner ring honey, both dashed with rounded caps (the "woven twig" feel); center dot teal. On a cream field.
- **App icon:** the ring+dot mark on cream (or coral) — strong, recognizable at small sizes.
- **Refinement needed:** current SVG is a sketch. Production needs proper optical balance of dash rhythm, stroke weights, and ring spacing, plus a single-color (monochrome) variant.

## 5. Color — "Warm Nest"

| Role | Name | Hex |
|---|---|---|
| Primary | Coral | `#F25C2A` |
| Warm secondary | Honey | `#F5A623` |
| Accent ("you" dot) | Teal | `#0E9AA8` |
| Ink (text) | Espresso | `#2A1A12` |
| Surface | Cream | `#FFF8F0` |

The warm core (coral + honey) carries the nest. A single cool **teal** — the protected dot at the heart of the mark — is the bold pop that keeps the palette from going sleepy. Text is **espresso, not black**, for warmth.

## 6. Typography

- **Display / wordmark:** **Fraunces** (800 / 600) — warm, characterful serif. Premium and human, deliberately distant from typical crypto/fintech sans.
- **Body / UI:** **Hanken Grotesk** (400 / 600 / 700) — clean, friendly, highly readable.

Wordmark sets "Nido" in Fraunces espresso, mark to the left.

## 7. Voice — "a friend who's got your back"

Warm + bold. Plain words, real confidence, zero crypto jargon.

**Principles:**
1. **Say it plainly.** No *address, gas, chain, sign, seed*. If a 12-year-old wouldn't get it, cut it.
2. **Confident, not corporate.** Short sentences. We've got it handled — and we say so.
3. **Warm, never cutesy.** Friendly enough to trust with money. A little spark, never silly.
4. **Don't name the boogeyman.** "No seed phrases" only lands if you already know the pain — so it *is* jargon, and it plants fear. Sell the relief in the user's terms, not the crypto problem they never knew they had.

**Lexicon — jargon → Nido:**

| The crypto way | The Nido way |
|---|---|
| Sign transaction with passkey | Confirm with Face ID |
| Deploy smart account (C-address) | Create your Nido |
| Insufficient gas for transaction | You're covered — no fees to think about |
| Add signer / configure context rule | Add a trusted friend · Set a spending limit |
| Social recovery via M-of-N multisig | Lose your phone? Friends can let you back in. |
| Generate zero-knowledge proof | Prove it's you — without sharing the details |
| "No seed phrases to lose!" | Nothing to memorize. Nothing to write down. |

**Naming convention:** the user's account is **"your Nido."** Verb for onboarding: **"Create your Nido."**

**Homepage hero (canonical, in-voice):**

> Nido. A safe place for everything you own — money, identity, and access. Set up in seconds with just your face. Nothing to memorize, and no way to get locked out.

## 8. Where the brand applies (implementation surfaces)

User-facing first; internal/technical names can lag.

- **Frontend** — `frontend/account` and `frontend/dapp`: wordmark, palette, type, all UI copy → Nido voice.
- **README & public docs** — reposition from "migrate G→C" to the Nido positioning; keep a technical "how it works" section but de-jargoned at the top.
- **`packages/`** — public-facing npm package names/descriptions (e.g. the SDK) may adopt `nido-*`; contract-binding internals can stay technical.
- **Domains / handles** — acquire `nido.co` (+ `.io`/`.finance`), create the `nidohq` GitHub org.

## 9. Out of scope (separate plans)

- **Code/identifier rename** (`g2c-*` crates, contract names, deployed contract IDs, `mysoroban.xyz`): a mechanical migration with its own risk profile — separate implementation plan.
- **Production logo asset** finalization (vector refinement, icon grid, monochrome/inverse variants, favicon set).
- **Trademark clearance** in the relevant classes before public launch.
- **zk-proof product copy** beyond the lexicon entry above (define when that feature lands).

## 10. Decisions log (so we don't relitigate)

- Scope = **full identity** (name + messaging + visual).
- Positioning = fusion of "account for the new internet" + "crypto that finally feels normal."
- Personality = warm + bold.
- Name = **Nido**, chosen over Keyp and Halo despite Keyp scoring best on raw availability — Nido's warmth and meaning won; crowded namespace accepted.
- Logo = Nest Ring; Color = Warm Nest; Type = Fraunces + Hanken Grotesk; Voice = "friend who's got your back."
