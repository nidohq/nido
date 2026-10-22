# Deployments (testnet)

What the wallet in this tree targets on testnet, with the provenance needed to
check it. Deployments that current code or existing accounts still reach, but
that the wallet does not target, are in the
[compatibility appendix](#compatibility-appendix). Every other retired
deployment is in this file's git history (`git log -p -- DEPLOYED.md`).

## Perch's stack

Perch deploys its stack; Nido deploys none of it. The record is Perch's
manifest,
[`deployments/testnet.json`](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/deployments/testnet.json)
(`vendor/perch/deployments/testnet.json`), at the Perch commit Nido pins: for
every contract its version, wasm sha256, and content address under the
manifest's registry, plus the Perch commit and toolchain that built them and
the ledger they were deployed at. Perch's
[`scripts/verify-deployment.sh`](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/scripts/verify-deployment.sh)
(`vendor/perch/scripts/verify-deployment.sh`) checks the manifest against the
chain by hash and address.

The wallet's deployment, `perch.TESTNET`
(`packages/passkey-sdk/src/perch/deployment.ts`), is that manifest plus Nido's
factory; `packages/passkey-sdk/src/perch/deployment.test.ts` checks it field by
field, taking Nido's factory address from this record (SECURITY_INVARIANTS W6). Wasm hashes and versions are in the manifest.

| Manifest field (`PerchDeployment`) | Contract | Address or value |
| --- | --- | --- |
| `network` | | `Test SDF Network ; September 2015` |
| `factory` | `nido-factory` (Nido's, [below](#nidos-factory)) | `CDDIW3F63PB6ZKMJN7CCGJSCYXTAVAVEEYNS36K2YFEJH7GQ3ADVZSVS` |
| `webauthnVerifier` | `perch-webauthn-verifier` | `CDEV5YPS5IITPLQPYTKJGWBNZ2YZ7FQZIJNSHUMJRBE4QWYK2IVK4EJT` |
| `statelessRegistry` | Perch's registry instance | `CDZGU4AIND6QRCGAN72I7DCS2EKRZ76JSKYY7KKJR4CG5IR2AMFIBZTM` |
| `docCompiler` | `perch-doc-compiler` | `CAYCPM5O6SGGAZOCCAUJ27CZZ7SMHU4VYSA25ZHDMGKILP4Z5RGF467E` |
| `interpreter` | `perch-interpreter` | `CBOGVUQWY5G7BP7OWEJX3Z5PSZLYJXHM54A7OEMXQQ7ZO4GHHM4WCEAP` |
| `spendingLimit` | `perch-spending-limit` | `CAG3IDO3FXE2HQVQHRGRBKWGL2IPAA2V6B3UMHES4ZUNS7OEV646HYV5` |
| `recoveryController` | `perch-recovery` | `CBOFO5KWQKCZ7LBS4LDIYXA6LGZSUSA6JKOHHBBL64KQNZLPGDJ252FT` |
| `zkPool` | `perch-zk-pool` | `CASXCXSBIG6ECB3LO4LCEW6SZIFHZDTJ3PFOZJK5JI56VKXLSZY6J67P` |
| `zkAdapter` | `perch-zk-adapter` | `CDWVAUSTU2DHBBWANQKGSHCXFK5C46WMUEMWRBOV2LBVXQGK4PGIFBQS` |
| `circuitId` | | `9e39c41f4f35aad43e64b255dfe3ba13f10e8c9d36d6f56fce23c2d97c0a0b4a` |
| `treeDepth` | | `32` |
| `accountWasmHash` | `perch-account` (installed, not deployed) | `2c976bfd98678f3b6fcf5514420a81ef5e5b9fc1c5b6c60ec6f2dd64448479d5` |

The manifest also lists Perch's own factory (`perch-account-factory`), which
Nido does not use: its addresses commit to the admin signers, but a Nido
passkey's RP ID is the account's own subdomain, so the address has to exist
before the passkey.

## Nido's factory

The record is
[`packages/passkey-sdk/src/perch/factory.testnet.json`](packages/passkey-sdk/src/perch/factory.testnet.json),
written by `scripts/deploy-factory.sh` from what it read back: the address, its
wasm sha256, the account wasm hash it deploys, its pinned WebAuthn verifier, its
manager, its admin, and the Nido and Perch commits and toolchain that
built it.
`just check-factory` (run in CI) checks the record against the factory's
instance storage and its `account_wasm_hash`, and that hash against the
manifest's `perch-account`; `deployment.test.ts` checks the record's account
and verifier against the manifest's `perch-account` and
`perch-webauthn-verifier`.

| Field | Value |
| --- | --- |
| Address | `CDDIW3F63PB6ZKMJN7CCGJSCYXTAVAVEEYNS36K2YFEJH7GQ3ADVZSVS` (`perch.TESTNET.factory`) |
| Wasm sha256 | `02482b9ae2feaa25e7ec836be8dd839b0c3bc035d1d5a595585ab6582ea44995` |
| Deploys | Perch account `2c976bfd98678f3b6fcf5514420a81ef5e5b9fc1c5b6c60ec6f2dd64448479d5` (the manifest's `perch-account`, Perch `c135aca`) |
| Verifier pin | `CDEV5YPS5IITPLQPYTKJGWBNZ2YZ7FQZIJNSHUMJRBE4QWYK2IVK4EJT` (the manifest's `perch-webauthn-verifier`) |
| Interface | `create_account(setup_pk, key, setup_sig)`, which checks the setup key's signature over the passkey and derives the address from the setup key; `get_c_address(setup_pk)`; `upgrade` / `pin_verifier` / `set_manager` / `set_admin`, each immediate and announced. Constructor `(admin, verifier, manager)`. |
| Change delay | None in the factory: the delay belongs to the admin smart account (RUNBOOKS §3). |
| Admin | `GAWIDMB5EIWL4DLYSWG2BADMYMSXESPQC4P2FJ4VMHEHSI2ZLDP76B6K`, a single throwaway testnet key |
| Manager | None |
| Deployed | 2026-10-22 by `scripts/deploy-factory.sh` (Nido `951ad2e8`, Perch `6af7622`) |
| Registry name | None |

**Previous factories.** `CAE33LHBXQGBI6QLDHBUOSCLPUD267NRJXANHO65PQ6PU2BMGHOKF6QV` (wasm `218ed001…`, deploys the 603f7d5 account `d99d56fc…`, verifier pin `CDRYDB7O…`, admin `GDR4OGZX…`, deployed 2026-10-21) has the same interface and remains on chain; accounts it minted keep working on the earlier Perch stack. `CBJRCUECFC2FSJBSVOVYHWC73A2SN7LIKSLWJBQUNEOWPE4PXG33M54H` (wasm `c858f314…`, deploys the 845c49a account `d3d4c28a…`, verifier pin `CAL7IEAJ…`, admin `GA2MQ7MB…`, deployed 2026-10-12) remains on chain. It has the old interface, `create_account(salt, key)` with a caller-chosen salt, which the wallet in this tree no longer calls. Accounts it minted keep working; new accounts come from the factory above.

## Nido contracts in use

| Name | Address | Notes |
|---|---|---|
| Factory | `CDDIW3F63PB6ZKMJN7CCGJSCYXTAVAVEEYNS36K2YFEJH7GQ3ADVZSVS` | **Setup-key factory (2026-10-22)**, see [Nido's factory](#nidos-factory). `create_account(setup_pk, key, setup_sig)` deploys doc-only Perch accounts by the account wasm hash pinned from the manifest (`2c976bfd…`, reported by `account_wasm_hash`), with Perch's WebAuthn verifier `CDEV5YPS…` pinned at construction and no manager. Admin `GAWIDMB5EIWL4DLYSWG2BADMYMSXESPQC4P2FJ4VMHEHSI2ZLDP76B6K`, a throwaway testnet deploy key, NOT a human-held key (testnet only; mainnet must hand the factory to the admin smart account that enforces the change delay, MAINNET_READINESS B1). Not registry-registered: `perch.TESTNET.factory` in `packages/passkey-sdk/src/perch/deployment.ts` is the source of truth. Previous factories `CAE33LHBXQGBI6QLDHBUOSCLPUD267NRJXANHO65PQ6PU2BMGHOKF6QV` (2026-10-21, 603f7d5 account), `CBJRCUECFC2FSJBSVOVYHWC73A2SN7LIKSLWJBQUNEOWPE4PXG33M54H` (2026-10-12, salt interface, 845c49a account) and `CCJFOM6UGOH7JSAX22C3FAECG5657HKIUYDBTCMUMILKDA6LOA2J2EGG` (pre-redeploy Perch account) remain on chain. |
| WebAuthn verifier | `CDEV5YPS5IITPLQPYTKJGWBNZ2YZ7FQZIJNSHUMJRBE4QWYK2IVK4EJT` | Perch's redeployed WebAuthn verifier (`perch-webauthn-verifier` in `vendor/perch/deployments/testnet.json`). Constructorless, no admin. Implements `canonicalize_key` / `batch_canonicalize_key`; the factory pins it and passkey signers name it. Previous verifiers `CDRYDB7O2JFLF7FAIIQUQK4BKQT3N6ACFFGZQ7AHKMX52RIWTHBHJY6K` (Perch 603f7d5), `CAL7IEAJO7S3SJI4EXESMUNPOEYW6QNR3PQTO7AVHD75YGURSZ5CW27Z` (Perch 845c49a), and Nido's former `CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY`. |
| Multisig policy | `CCSDKJYOFCPTCCGQZPF73RJNHFC7TPO532Q36N3M2VBYZFWQOTDB7J7G` | Registered as `unverified/multisig-policy`. Built against soroban-sdk 26 + OZ stellar-contracts main — accepts v0.7 `ContextRule` (with `signer_ids`/`policy_ids`). |
| Spending-limit policy | `CCJMCPGADKMVKYOIZXMV7UWH62XYDAIT6GJRNJPQSZ2CHPOF4K2AU2QC` | Registered as `unverified/spending-limit-policy`. Built against soroban-sdk 26 + OZ stellar-contracts rev `637c53a` — wraps `policies::spending_limit` (rolling window, meters SAC `transfer`). |
| Stellar Registry (unverified) | `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S` | The registry the factory queries via `Self::resolve(env, name)`. |
| Name registry | `CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX` | Human-readable account names. Independent of the policy-builder set. |
| Status Message demo | `CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV` | Hardcoded in `packages/frontend/src/pages/status-message/index.astro`. Predates the policy-builder work. |
| Recovery controller (v2) | `CBYSWPHNWAHYUBZO5TBTO5MCW2ZC45F2C3L4JSUZXYQFNMHTOBOCCHZU` | `contracts/recovery-controller`, deployed 2026-09-14. Shared, constructorless controller — guardian-only/ZK-only/combined recovery against one proposal-commitment model, completing via the account's existing `apply_doc`. **v2 adds `reconfigure`/`config_hash`** (lets an account enrolled in one evidence factor add the other, converging on `Combined`, without the "no reconfigure entry point" limit v1 shipped with). Constructorless design means there is no admin/upgrade entry point at all — adding `reconfigure` to the source could not update v1 in place, so v2 is a genuinely new, separately-deployed address ("explicit upgrade = a new immutable artifact, not a rewrite", the same philosophy already documented for the verifier below, exercised here for the first time on the controller itself). Not registry-resolvable yet (crate doc comment's "Known limits") — hardcoded as `RECOVERY_CONTROLLER_TESTNET_ID` in `packages/passkey-sdk/src/recoveryStage3/deployment.ts`, which `packages/passkey-sdk/src/policyBlocks/multisigRecovery.ts` (the friend/guardian recovery UI's `buildInstall`), `packages/frontend/src/pages/security/index.astro`'s `runZkEnrollment` (ZK enrollment), and `packages/frontend/src/lib/policyChainFetch.ts` (`fetchPolicyState`'s Stage-3 branch) all import. Interface verified via `stellar contract info interface` (`reconfigure`/`config_hash` both present) before being recorded here. **Superseded:** `CDXVWS4FLZKI65NX2CXBUTKEUGSIQN4SMU2OLKSSJNWPT62A4OKFHXDW` (v1 — no `reconfigure`/`config_hash`). v1 is NOT orphan-free: this repo's own `security-recovery-install.testnet.spec.ts` probe enrolled a throwaway test account (`CCVXSIAVMOI4APBONN6CDHBONC7CYOJUM7VGVGCG7CJXRIIQCZN3M222`) against v1 before v2 existed — not a real user's account, left orphaned deliberately. |
| Recovery verifier | `CCQZ774YVDHRQSXT6KQLTBQ2TAIZYE3XW2Y6MJ7CDZKHTD47CLZUNRCV` | `contracts/recovery-verifier`. Constructorless UltraHonk verifier, VK baked in at compile time. Only needed for `ZkOnly`/`Combined` mode enrollment — the friend/guardian recovery UI only drives `GuardianOnly`, so nothing currently references this address at runtime; recorded here for completeness/future use. `RECOVERY_VERIFIER_TESTNET_ID` in the same `deployment.ts`. |

## Perch canonical deployment (testnet)

Contracts of the perch policy layer (<https://github.com/stellar-registry/perch>).
These are **not nido-owned deploys**: they come from perch's content-addressed
"stateless" subregistry, which deploys each contract with
`salt = sha256(wasm)`. Every address below is therefore derivable offline from
the registry id plus the pinned wasm hash — the SDK does exactly that
(`perchTestnetAddresses()` in `packages/passkey-sdk/src/policyDoc/deployment.ts`,
pins asserted in `deployment.test.ts`) instead of hardcoding addresses at call
sites. The full redeployed stack (verifier, recovery controller, ZK pool/adapter,
spending-limit, account wasm hash, and Perch's own factory) is recorded in
`vendor/perch/deployments/testnet.json` and surfaced to the wallet through
`perch.TESTNET` (`packages/passkey-sdk/src/perch/deployment.ts`, checked field
by field against that manifest in `perch/deployment.test.ts`). The addresses
below are the subset the content-addressed derivation re-derives; they match the
manifest. Pinned against perch rev `845c49a` (perch-interpreter 0.1.3).

| Name | Address | Notes |
|---|---|---|
| Perch stateless registry | `CAR2DSSOBJB76GGD6MAAKWUK36Y7I7O3NDWTN7HTIRV5I3XZ27U3ZBVZ` | The deployer the redeployed stack is content-addressed under (the manifest's `registry.id`); content-addresses every instance below. Previous registry `CDX2DMYMMEYU6FGN3HPJ2GQSSL5EZHIAMEJD4SPF55FZE5LEUBPPPDA7`. |
| Perch doc-compiler 0.3.2 | `CCYSZHRHY7GKT2OYXF6JW332GA2BL6ZKPAWIV6RVC5JW2RNPHQPSW5ZI` | Stateless `compile_doc`; wasm `ccea12cd…`. The smart account cross-calls it from `apply_doc`; refuses a non-canonical external-signer key. Previous `CDWBJPDMBORIZERIFVMTGJFND6ZTAQJIVDNYST4SV33YBQP47BPKOHR6`. |
| Perch interpreter 0.1.3 | `CA5JLPEVA3E5X7YEDVABMEM3TML33ZS3I6WL5NDBFIZZAXFYNZPBBWTO` | OZ `Policy` evaluating perch constraint programs. Wasm `2254f17d…`. Bindings: `@stellar-registry/perch-interpreter` (npm, upstream-published). Previous `CDR2OTZIZYTAHEHHH5MBOL6RKLWKIEN5KLPIVOG7FVBVTFET552NTWL2`. |

## Deploying

See [docs/RUNBOOKS.md](docs/RUNBOOKS.md) §2. Record every deployment here:
address, wasm hash, deployer, commit, and `stellar-cli` version.

## Compatibility appendix

Deployments the wallet does not target but that something current still
reaches. The factory and verifier below run code that is not in this tree and
must not be deployed to mainnet; whether the pre-Perch policies reach mainnet
is MAINNET_READINESS D6. Accounts minted by an older factory are not
migrated: they keep the account code and verifier they were minted with until
their owners move to a new account.

| Name | Address | What still reaches it, and why it matters |
| --- | --- | --- |
| Factory (doc-only) | `CCJFOM6UGOH7JSAX22C3FAECG5657HKIUYDBTCMUMILKDA6LOA2J2EGG` | Embeds Nido's former smart account (wasm `fe3b1878…`). Still the registry's `factory` name and the SDK's `factory` fallback; the wallet uses it only when built without a Perch deployment (`fetchFactoryAddress`). Repointing the name is a separate, deliberate step (RUNBOOKS §2.2). |
| WebAuthn verifier (Nido's former) | `CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY` | Admin-upgradeable; its source is not in this tree. Registered as `verifier` and the SDK's `verifier` fallback. Every account a pre-Perch Nido factory minted names it, so its admin key remains a trust anchor for those accounts (THREAT_MODEL 7). The wallet falls back to it only when it cannot read an account's admin rule and has no Perch deployment (`fetchVerifierAddress`). |
| Multisig policy (pre-Perch) | `CCSDKJYOFCPTCCGQZPF73RJNHFC7TPO532Q36N3M2VBYZFWQOTDB7J7G` | `contracts/multisig-policy`. A Perch document can't attach it, so only accounts minted by pre-Perch factories can carry it. |
| Spending-limit policy (pre-Perch) | `CCJMCPGADKMVKYOIZXMV7UWH62XYDAIT6GJRNJPQSZ2CHPOF4K2AU2QC` | `contracts/spending-limit-policy`. A Perch document can't attach it. The wallet resolves the registry's `spending-limit-policy` to show the cap of a rule that carries it (`fetchSpendingLimit`), and to decompile documents when built without a Perch deployment. |

### Perch policy layer (0.2.1 era)

Perch contracts from an earlier content-addressed stateless registry, each
deployed with `salt = sha256(wasm)`, so each address derives offline from the
registry id and the wasm hash. The SDK derives them (`perchTestnetAddresses()`
in `packages/passkey-sdk/src/policyDoc/deployment.ts`, pinned in
`deployment.test.ts`); the wallet uses the derived interpreter address only
when built without a Perch deployment (`interpreterAddress()` in
`packages/frontend/src/lib/policy/docPolicyFetch.ts`). Current accounts do not
pin them.

| Name | Address | Notes |
| --- | --- | --- |
| Perch stateless registry | `CDX2DMYMMEYU6FGN3HPJ2GQSSL5EZHIAMEJD4SPF55FZE5LEUBPPPDA7` | Doc-compiler 0.2.1 generation. |
| Perch doc compiler 0.2.1 | `CDWBJPDMBORIZERIFVMTGJFND6ZTAQJIVDNYST4SV33YBQP47BPKOHR6` | Wasm `35f248f0…`. |
| Perch interpreter | `CDR2OTZIZYTAHEHHH5MBOL6RKLWKIEN5KLPIVOG7FVBVTFET552NTWL2` | Wasm `f63cae53…`. |
