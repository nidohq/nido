# Local fee wallet and Perch funding lab

The dapp sends an intent. A separate wallet origin owns a passkey-encrypted HD
seed, builds the transaction, and runs Perch/WebAuthn and Cedar checks in a
keyless WASI guest before signing with local U and F keys. An immutable
Perch fee-budget component tops up only the registered F within a lifetime cap.

The testnet preview integrates this fee path into Nido's normal account creation
and `/fees/` wallet page. It reuses the existing C and passkey; the standalone
local-chain lab remains a separate fixture. Root Perch pins, factory and
relayer settings remain those of Nido #356. This does not replace every Nido
transaction's submitter or implement the permanent-G product mode.

## Architecture slides

The [HTML deck](../../packages/frontend/public/local-fees/index.html) explains
the transaction path, infrastructure footprint and exact proof scope. It is
included in the [aggregate PR preview](https://365.test.nido.fyi/local-fees/)
at `/local-fees/`, and in this lab at
`http://localhost:5198/architecture.html` (also included in `npm run build`).
Both serve the same self-contained HTML source. Arrow keys navigate; Evidence
opens the source references and assumptions; Print / PDF prints all slides.

The deck also explains the proposed **permanent G** mode: G remains the asset
address, U is replaceable access, C receives token allowances and applies Perch
spending policy, and F pays native fees separately. The reviewed authority
kernel supports key rotation and recovery without changing the account
reference. Permanent-G onboarding and allowance integration are not implemented
by this fee lab. U's threshold authority still permits direct G spending;
"approve-only G" is not an established ledger restriction.

## Try the PR preview on testnet

Open **https://365.test.nido.fyi/fee-demo/testnet.html** and continue in Nido.
Choose an existing Nido or create one with its normal account flow. The wallet
then enables local fees on the **same C account and account domain**. There is
no popup, second C, or separate demo passkey. Use test XLM only.

Account creation requests the optional WebAuthn PRF extension. Local fee
activation uses the existing passkey's PRF to encrypt a fresh HD seed; if that
provider does not support PRF, activation stops without saving an unencrypted
key. Ordinary Nido remains usable. Virtual-authenticator tests do not establish
physical device/provider compatibility, and a browser may still show its own
passkey prompt.

The dapp can only navigate to the fixed wallet intent. The wallet selects its C
from its checksummed hostname, loads its normal Nido credential, verifies the
pinned native account code and current owner rule, constructs the transaction,
and performs enforcing simulation. WASI derives the exact RP ID and origin from
C and the build-pinned PR suffix; a different C's origin is refused. All code
served on the Nido account origin remains part of the trusted wallet host.

Friendbot funds test-only U. During enrollment U creates F with 1.05 test XLM
(including reserve), deploys the executor/budget, and grants a 0.15 XLM lifetime
refill allowance. **It does not deploy or replace C. U is the demo treasury**,
not a permanent asset G or a C treasury. F is unused during setup. Routine
refill/action signatures pass through exact-XDR WASI/Cedar checks.

Press **Approve action**. If F is low, approve the separate refill prompt and
then the action prompt. The wallet displays settled transactions, F's balance,
the persistent spent counter and remaining cap. Repeat to observe another
automatic top-up. Automatic means detection and preparation; each refill still
requires C's passkey approval.

Interrupted enrollment retains the encrypted vault and deterministic addresses.
Retry reuses the same budget and original spent counter, including after a
page reload. Expired/archived state or changed code is refused; no replacement
budget is silently deployed. Clearing browser storage loses this demo's local
vault; a fresh seed creates an independent F/budget for the existing C, not continuation
of the old cap. Initial F funding and other deposits are outside the refill cap.

Public funding/executor hashes and deployment receipts are in `public/testnet/deployment.json`. Nido C
and its verifier use the parent deployment, pinned in `src/nido-account.mjs`.
The historical fixture registry is an isolated overlay
on the exact `perch-source.json` pin; the funding WASM is byte-identical to the
local proof-bearing artifact. Public RPC/Friendbot availability, contract/state
TTL and testnet resets remain operational dependencies. A bounded retry handles
explicit RPC preflight-queue congestion; auth failures and submissions are not
automatically retried.

The preview enables `PUBLIC_NIDO_LOCAL_FEES=1`; ordinary builds do not expose
fee navigation or request the PRF extension. Mainnet cannot enable this testnet path.

CI builds the origin-bound runtime and copies the static lab into the normal
frontend preview. To reproduce this build (Node 24, Rust 1.97.1 + wasm32-wasip1):

```sh
npm ci
FEE_PREVIEW_NUMBER=365 FEE_PREVIEW_OUT=/tmp/nido-fee-preview npm run build:preview
FEE_RUNTIME_DIR=/tmp/nido-fee-preview/runtime node --test test/local-budget-wasi.test.mjs
# Uses real testnet funds/transactions and a fresh virtual passkey:
PLAYWRIGHT_PATH=/absolute/path/to/playwright node test/nido-wallet-browser-check.cjs
# Also test ordinary Nido creation with a provider that has no PRF:
FEE_DISABLE_PRF=1 PLAYWRIGHT_PATH=/absolute/path/to/playwright node test/nido-wallet-browser-check.cjs
```

`build:preview` restores the local runtime artifacts after building. CI performs
no contract deployment and holds no wallet keys. `npm run deploy:testnet` is a
separate explicit maintainer operation: it creates a fresh test-only deployer
in ignored `.testnet-cache` and publishes a new public deployment manifest.
Do not run it to recover an individual enrollment or to reset a budget.

## Run

Requires Node >=22.12, Rust 1.96.0 with wasm32v1-none for contracts, Rust
1.97.1 with wasm32-wasip1 for the wallet runtime, Stellar CLI 27, and Docker.
The Rust-to-Lean proof additionally needs the exact cached image identified
in Perch's proof script; it never downloads tools or calls a paid API.

From this directory:

```sh
npm ci
npm run build:runtime
npm run build:contract
# Separate fake-funds chain; leave other local chains alone.
docker run --rm --name nido-fee-stack-review -p 127.0.0.1:8022:8000 stellar/quickstart:v678-b1525.1-testing --local --enable rpc
```

After the local node is synced, enable protocol 29 (the image starts at 28):

```sh
docker exec nido-fee-stack-review stellar-core http-command 'upgrades?mode=set&upgradetime=2026-01-01T00:00:00Z&protocolversion=29'
```

Wait for RPC `getNetwork` to report protocol 29. In separate terminals, run `npm run local:budget`, `npm run dev`, and
`npm run wallet`. Open http://localhost:5198/#onchain-budget. The wallet opens
at http://wallet.localhost:5199; local RPC is on 8022 and bootstrap on 5200.
These ports differ from the earlier prototype and do not replace it.

`build:contract` materializes the exact Perch commit under ignored `.perch-src`.
Before its branch is published, set `NIDO_FEE_PERCH_DIR` to a local checkout
containing that commit. Only the generated copy receives a **local verifier
registry path overlay**. The account still enforces native Perch's verified
verifier code-hash/address check. The overlay and local registry are not a
production registry configuration. No other checkout is edited.

## Transaction path

1. The dapp requests the fixed teaching action; it cannot provide signing bytes.
2. The wallet reads its registered budget and F's real balance.
3. When F is low, it builds `C.execute(executor, refill, [])`, obtains C's
   enrolled passkey assertion, and enforce-simulates native Perch rule 0.
4. The keyless WASI guest checks the exact envelope, C/U/F, executor, action,
   nonce/expiry shape, P256 assertion, wallet RP/origin/UV, and Cedar fee cap.
5. Only after that decision does the wallet decrypt its seed and add U's inner
   and F's outer fee-bump signatures. It confirms the refill before the action.
6. `C.execute(executor, touch, [])` increments the on-chain teaching counter.

The executor requires C before invoking the funding component. The component
requires its fixed executor, rereads F's token balance, computes the refill,
updates lifetime spent, and transfers only to F from the treasury allowance.
`checks` is the number of successful settlements, not an attestation count.

The treasury consents to immutable controller, executor, token, F, cap, low
mark, target and expiry. It may pause irreversibly. There is no reset, recipient
change or upgrade endpoint. Re-enrollment with the same public tuple reuses its
budget; a source/artifact change requires an explicit migration. The fake-funds
bootstrap uses the public standalone genesis key and is not a production
enrollment service. It never accepts a wallet secret.

## Perch policy versus settlement

Perch dev evaluates document rules natively, without OZ policy hooks. The
testnet wallet resolves the current owner rule on the existing Nido account.
Only the isolated local-chain fixture uses owner rule 0 in a fixed shell.
A dedicated grant can instead be scoped to the fixed
executor's `refill`, with an exact authorization root and expiry. See the
pinned Perch `docs/fee-budget.md` recipe. Dedicated grant creation is a follow-up;
the implemented route uses native owner authorization. No new JSON policy field
is claimed.

The persistent funding cap belongs to the reusable Perch component, so replacing
rules or renewing a token allowance cannot reset it. Turnkey can authorize the
treasury's allowance without holding F or signing ordinary fee envelopes.

## What is proved, tested, and trusted

- **Proved:** the actual extracted Rust refill planner always chooses registered
  F and a positive amount within the immutable remaining budget. Its committed
  trace keeps exact cumulative spending within cap. Standard Lean axioms only.
- **Tested:** SAC recipient/allowance accounting, failed-transfer rollback,
  expiry/pause/auth rejection; adversarial WASI checks, HD/PRF wallet behavior,
  native Perch signing vectors; real local-ledger passkey authorization.
- **Trusted:** wallet host and delivery, browser/WebAuthn/PRF, extraction/compiler,
  Soroban atomicity, native SAC and correctly reviewed deployment configuration.
  The browser, WASI guest and contracts as a whole are not formally verified.

The original authority-kernel campaign proves a different, bounded component.
It does not prove this wallet. F's native key can sign outside this pipeline if
its seed or trusted wallet host is compromised. The dapp cannot reach that key
through the isolated wallet interface. The explicit raw-key bypass demonstration
on the comparison panel illustrates the weaker same-origin design.

Initial F funding, other deposits and different budget deployments are outside
this lifetime refill cap. A contract allowance is token funding, not a native
network-fee allowance. F must already have enough XLM to submit a refill.

## Validation

```sh
npm test
npm run build
npm run test:contract
npm run proof:refill
PLAYWRIGHT_PATH=/absolute/path/to/playwright node test/budget-browser-check.cjs
```

The browser check uses a virtual PRF-capable authenticator and actual local
ledger execution, not physical hardware. It rejects a wrong rule and a direct
executor call outside the owner rule. Results/screenshots go under ignored
`qa/`. `proof/SigningBoundary.lean` is a separate abstract model; `npm run proof`
requires Lean and does not establish correspondence to the browser code.
