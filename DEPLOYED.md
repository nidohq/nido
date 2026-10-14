# Deployments (testnet)

What the wallet in this tree targets on testnet, with the provenance needed to
check it. Deployments that current code or existing accounts still reach, but
that the wallet does not target, are in the
[compatibility appendix](#compatibility-appendix). Every other retired
deployment is in this file's git history (`git log -p -- DEPLOYED.md`).

## Perch's stack

Perch deploys its stack; Nido deploys none of it. The record is Perch's
manifest,
[`deployments/testnet.json`](https://github.com/stellar-registry/perch/blob/391477ff22edd64a2da326eb9a92a92813b8e65d/deployments/testnet.json)
(`vendor/perch/deployments/testnet.json`), at the Perch commit Nido pins: for
every contract its version, wasm sha256, and content address under the
manifest's registry, plus the Perch commit and toolchain that built them and
the ledger they were deployed at. Perch's
[`scripts/verify-deployment.sh`](https://github.com/stellar-registry/perch/blob/391477ff22edd64a2da326eb9a92a92813b8e65d/scripts/verify-deployment.sh)
(`vendor/perch/scripts/verify-deployment.sh`) checks the manifest against the
chain by hash and address.

The wallet's deployment, `perch.TESTNET`
(`packages/passkey-sdk/src/perch/deployment.ts`), is that manifest plus Nido's
factory; `packages/passkey-sdk/src/perch/deployment.test.ts` checks it field by
field, taking Nido's factory address from this record (SECURITY_INVARIANTS W6). Wasm hashes and versions are in the manifest.

| Manifest field (`PerchDeployment`) | Contract | Address or value |
| --- | --- | --- |
| `network` | | `Test SDF Network ; September 2015` |
| `factory` | `nido-factory` (Nido's, [below](#nidos-factory)) | `CBFDM3GWAYW4BFGRGDS45OKLU6BWPEKMOY6U6T3JD5E35FDDWITS4VOE` |
| `webauthnVerifier` | `perch-webauthn-verifier` | `CBCCINHRMS3COAV5RHTCUASZLOEC52FCOBR3HMU4FKWJTAHWZTVFTHHY` |
| `statelessRegistry` | Perch's registry instance | `CCUC5RDRGRFFC5VGG7HCB3OMNNSYDFAQOSA7SBGYUM2GDXAJBUWI5TFQ` |
| `docCompiler` | `perch-doc-compiler` | `CDHZT7NLQDPMWCUDNUVCYC2EAMGRFWABQO5WDSRJGDQVIDHOWQB2FANB` |
| `interpreter` | `perch-interpreter` | `CAI6RPWAJ7Z6MP3HLGMTD3W4P4DTD6BEKPFV7XF6VANC2H7XYAQHIXHP` |
| `spendingLimit` | `perch-spending-limit` | `CCVXXCAKMROSWAH6QKZ2PUMMH3QUUEUERJQ3CI4XMAWVOMTKKJHYSMTF` |
| `recoveryController` | `perch-recovery` | `CDIGZVWVXJT2PVDIAUKLX62LW7DNJBC6SZUSR6SLQ6MNICGCGZ6EEXPR` |
| `zkPool` | `perch-zk-pool` | `CB46EOGM6FSSHO2TNKFWZF5AOIDROPNE6QW75XBKETX5IS757B25WK2Y` |
| `zkAdapter` | `perch-zk-adapter` | `CBGN355IPW63XPNOSG4O3EZD46ASBXCM5W55PQHEZXJYAFZXN23BNAWC` |
| `circuitId` | | `9e39c41f4f35aad43e64b255dfe3ba13f10e8c9d36d6f56fce23c2d97c0a0b4a` |
| `treeDepth` | | `32` |
| `accountWasmHash` | `perch-account` (installed, not deployed) | `bbb30174bbd85a2956a2f6146a156769621254011a6bdcac707cf787ce7bcd52` |

The manifest also lists Perch's own factory (`perch-account-factory`), which
Nido does not use: its addresses commit to the admin signers, but a Nido
passkey's RP ID is the account's own subdomain, so the address has to exist
before the passkey.

## Nido's factory

| Field | Value |
| --- | --- |
| Address | `CBFDM3GWAYW4BFGRGDS45OKLU6BWPEKMOY6U6T3JD5E35FDDWITS4VOE` |
| Wasm sha256 | `4a16b51b268814d2b92a9801e48684adba112bc8a5225ae32ce7d88a4f95665f` |
| Built from | Nido commit `42738a3f47082971bbdc6d5162cc80170f06bf5a`, `just build-contracts`, rustc 1.96.0, `stellar-cli` 27.0.0 (the `stellar-scaffold-cli` version is not recorded) |
| Embeds | The manifest's `perch-account` (`accountWasmHash` above) |
| Verifier pin | The manifest's `perch-webauthn-verifier` (`set_registry_pins`) |
| Admin | `GBPLRG4TQSCCJEVO7IZZXTRXWMQBSUJWWX6SZTSVPGSXVEX3PVOTBHP5`, a single throwaway testnet key |
| Deployed | 2026-10-09 by `scripts/deploy-factory.sh` (`stellar-cli` 27.0.0), which read back the pin and the account hash the factory deploys |
| Registry name | None |

## Nido contracts in use

| Name | Address | Notes |
| --- | --- | --- |
| Name registry | `CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX` | Account names. Read by `infra/nido-resolver` and by the wallet, which resolves it as `name-registry` through the Stellar Registry with this address as the fallback. |
| Status message (demo) | `CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV` | Used by the example dApp. |

## External contracts

| Name | Address | Notes |
| --- | --- | --- |
| Stellar Registry (unverified) | `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S` | External (AhaLabs). The wallet resolves `name-registry`, `status-message`, and `spending-limit-policy` through it at runtime (`packages/passkey-sdk/src/registry.ts`, with hardcoded fallbacks for some names). The factory's `REGISTRY` constant, consulted only for an unpinned verifier; the factory above is pinned. |

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
