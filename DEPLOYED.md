# Deployments (testnet)

Three groups: the Perch release and Nido factory the wallet in this tree
targets, the Nido contracts still in use, and the contracts this tree retired.

## Perch release and Nido's factory

Perch deployed its whole #99 stack on 2026-10-07 (ledger 5,077,086), built
from the stack's top (Perch commit aa5a78f: the release with its consumer
interface, stellar-registry/perch#110; caps 8 signers × 11 rules × 8192
bytes). The deployment record is `fm/perch-epic99-deploy-p8` at 836fdc9
(stellar-registry/perch#112), which records it in
[`vendor/perch/deployments/testnet.json`](vendor/perch/deployments/testnet.json):
every contract by wasm hash and content address under its registry, with the
commit and toolchain that built it. The SDK's `perch.TESTNET` is that
manifest plus Nido's factory; `packages/passkey-sdk/src/perch/deployment.test.ts`
checks it field by field.

| Manifest field (`PerchDeployment`) | Contract | Address or value |
| --- | --- | --- |
| `network` | | `Test SDF Network ; September 2015` |
| `factory` | `nido-factory` (Nido's) | `CAMN56JY2WLIS5H23AL5SJ5YTQUEOFCGR6YRLQDWVIXXJHRM7QD64TBH` |
| `webauthnVerifier` | `perch-webauthn-verifier` 0.1.0 | `CA2GRIVA5M6QTWEH3TQDBREFIKRKZHQYZJFPWXLATGTVS4NFLEKHLFMH` |
| `statelessRegistry` | Perch's registry instance | `CB4D5F5N3MYMGWOKN5DUEI4LMJ34GBO5WJKTXNOXPNKAEWRCQSQLBEJL` |
| `docCompiler` | `perch-doc-compiler` 0.3.0 | `CDFB7XC4HDQCCMNTV2PWWM33W35UOHEJ2UNXW2QNB3SHPT456KZRY74A` |
| `interpreter` | `perch-interpreter` 0.1.2 | `CBH2R7E5PKLEQ7OMNYK6BHDWFZM7TJUAONFVFUO4ECACIBORNIGCHXLD` |
| `spendingLimit` | `perch-spending-limit` 0.1.1 | `CAWDTYQ2FMSQCMTRG7DT25UCSTSSSH7QWPX6YJJZWM6KU52ZIHUJSODY` |
| `recoveryController` | `perch-recovery` 0.1.0 | `CAM67FBUSDD7DLDYU6I4KEYFFTYDVH2PTCY6JG7VCLXCFCW3JICGVYVN` |
| `zkPool` | `perch-zk-pool` 0.1.0 | `CAZF7RWHUP3F2CT3XOXGBGXQRFQEKGMUEAOGDULKMEOKMW6IHFD6KTBH` |
| `zkAdapter` | `perch-zk-adapter` 0.1.0 | `CBHPOMMRFZBV5347EOFRJD476TMGS2L4QC5KKCYLLERIYLUMCXVFVBVX` |
| `circuitId` | | `9e39c41f4f35aad43e64b255dfe3ba13f10e8c9d36d6f56fce23c2d97c0a0b4a` |
| `treeDepth` | | `32` |
| `accountWasmHash` | `perch-account` 0.3.0 (installed, not deployed) | `238ec4b6d6d7c80eea9386affd153dbeb253b5e561d7e0d95c8cd7f4dc76f4ba` |

**Nido's factory** was deployed by `scripts/deploy-factory.sh` on 2026-10-07
with a throwaway testnet admin (`GASYOK3SOMRE4OK5GJNFD2H6HNF2ZISK332HHQQGNGW663ZIGSV5IG3S`,
`stellar-cli` 27.0.0). Wasm `150a5937…`, built from this tree (#231); it
embeds the manifest's account wasm and pins Perch's verifier, and the script
read both back. It is not registered under any registry name. Perch's own
factory (`perch-account-factory`, in the manifest) doesn't fit Nido:
its addresses commit to the admin signers, but a Nido passkey's RP ID is the
account's own subdomain, so the address has to exist before the passkey.

Accounts minted by older factories are not migrated (epic #99: fresh
deployments only).

## Nido contracts in use

| Name | Address | Notes |
| --- | --- | --- |
| Name registry | `CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX` | Account names; read by `infra/nido-resolver`. |
| Status message (demo) | `CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV` | Used by the example dApp. |
| Stellar Registry (unverified) | `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S` | External (AhaLabs). The factory's `REGISTRY` constant (a fallback once the verifier is pinned); the wallet falls back to it only without a Perch deployment. |
| Multisig policy | `CCSDKJYOFCPTCCGQZPF73RJNHFC7TPO532Q36N3M2VBYZFWQOTDB7J7G` | Pre-Perch. A Perch document can't attach it. |
| Spending-limit policy | `CCJMCPGADKMVKYOIZXMV7UWH62XYDAIT6GJRNJPQSZ2CHPOF4K2AU2QC` | Pre-Perch. A Perch document can't attach it. |

### Perch policy layer (0.2.1 era)

Perch contracts from its content-addressed stateless subregistry, deployed
with `salt = sha256(wasm)`, so each address derives offline from the registry
id and the wasm hash. The SDK's policy-document layer derives them
(`perchTestnetAddresses()` in `packages/passkey-sdk/src/policyDoc/deployment.ts`,
pinned in `deployment.test.ts`); the wallet prefers the manifest's addresses
when it has one. They are not what the release's account pins (above).

| Name | Address | Notes |
| --- | --- | --- |
| Perch stateless registry | `CDX2DMYMMEYU6FGN3HPJ2GQSSL5EZHIAMEJD4SPF55FZE5LEUBPPPDA7` | Doc-compiler 0.2.1 generation. |
| Perch doc compiler 0.2.1 | `CDWBJPDMBORIZERIFVMTGJFND6ZTAQJIVDNYST4SV33YBQP47BPKOHR6` | Wasm `35f248f0…`. |
| Perch interpreter | `CDR2OTZIZYTAHEHHH5MBOL6RKLWKIEN5KLPIVOG7FVBVTFET552NTWL2` | Wasm `f63cae53…`. |

## Retired

These run code this tree removed. They stay on chain and none may be
deployed to mainnet. The doc-only factory below is still what the registry's
`factory` name and the SDK's fallback in `packages/passkey-sdk/src/registry.ts`
resolve to; the wallet uses it only when built without a Perch deployment.
Repointing the name is a separate, deliberate step (RUNBOOKS §2.2).

| Name | Address | What it ran |
| --- | --- | --- |
| Factory (doc-only) | `CCJFOM6UGOH7JSAX22C3FAECG5657HKIUYDBTCMUMILKDA6LOA2J2EGG` | Embeds Nido's former smart account (wasm `fe3b1878…`). Still registered as `factory` and the SDK's registry fallback. |
| Factory (previous) | `CBQKB6GYPO7P2CGDKN7KYLEFEBBN6FY5NXZJ7HNR43ZK2DDOU5N7NCV5` | Pre-doc smart account (`00825acd…`). |
| Nido factory (Perch's 17f2c9c deployment, Oct 7) | `CCCY6PPRD7ZYNZDH7QMZZ4U57J5WBNJG4ZUQKJ4NYTPJIP35AWA4BKT6` | Embedded the 17f2c9c release's account (`7743becf…`) and pinned that deployment's verifier (`CCN63JUG…`, registry `CBU7P2S7…`). Superseded the same day by the redeploy above. Perch keeps that history at `fm/perch-epic99-release-p8-archive-17f2c9c`. |
| Nido factory (Perch's Oct 3 deployment) | `CB6SVLYMOSG6SJN4F5SDE7IHTDTXY26PJCALD3L55D72CGIJUUPMHLRQ` | Embedded the Oct 3 release's account (`5f22b0a7…`) and pinned that deployment's verifier (`CDQOXV6N…`, registry `CDOTZIJU…`). Superseded by the redeploy above. |
| WebAuthn verifier (Nido's) | `CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY` | `contracts/webauthn-verifier` (removed), admin-upgradeable. Registered as `unverified/verifier`; every account an older factory minted names it. |
| Recovery controller v2 | `CBYSWPHNWAHYUBZO5TBTO5MCW2ZC45F2C3L4JSUZXYQFNMHTOBOCCHZU` | `contracts/recovery-controller` (removed). |
| Recovery controller v1 | `CDXVWS4FLZKI65NX2CXBUTKEUGSIQN4SMU2OLKSSJNWPT62A4OKFHXDW` | Same, without `reconfigure`. |
| Recovery verifier | `CCQZ774YVDHRQSXT6KQLTBQ2TAIZYE3XW2Y6MJ7CDZKHTD47CLZUNRCV` | `contracts/recovery-verifier` (removed). |
| ZK recovery pool (M1) | `CAUZ6WFUTTZCJQNNL5D3BNZSG7FYYGX46BDJE6G2XVVCGN76RKE5ESAR` | `contracts/zk-recovery` (removed), testnet parameters. |
| ZK verifier (M1) | `CDMNKDMPSBUUOHCP6QKFLRP76TLYFCYBM7SICE77BQGFJTRL7MXOSIRD` | `contracts/zk-verifier` (removed). |
| `zk-recovery` (M4) | `CB2PYUHYSWFTZAX3ARYZ4ZP4VJNLYJQMP7T7JE5RRZMOPLPAHSGBZS37` | Registered as `zk-recovery`. |
| `zk-verifier` (M4) | `CAD36MGYPRX6HBSWSQ33SOI2DBRSQ4WZW3TL56PZZNRPHO4PMCH5QFEP` | Registered as `zk-verifier`. |
| `factory-v2-preview` | `CA2NQS3V6XCNA4FZDPQ4JLSQ65CRWMHHLYQEZ5YQ7MYQX2G5USZ4GWBL` | PR-preview genesis-insert factory. |
| `pool-v2-preview` | `CDXT3DCXYFNZNKBST7VZMN5RJWH24HQXO3WLENQEP7YMPAEZJTQNMEKS` | Its pool. |
| Factory (funder-based) | `CDQDNOT4RWQKAIJIZYJE5HK7DMIVTYBJ4QXHIERNOZPPYMUNBT2JZ2SK` | Pre-v0.7. |
| Factory (old) | `CDDMELYHOSD6M2T53F5DUYCXDS3VVOQ72E4KZMMZP37GQWII2WRKM2CC` | Pre-v0.7. |
| Verifier (old) | `CD6IG543VWP4RRNAKJTX25GJEQ3QAR5WPMP44MCENF433IPDFQTIJRTG` | Pre-`batch_canonicalize_key`. |
| Multisig policy (old) | `CCJVJVNUXLD6MZDLSQMRWYAV4EKHE7IPOM5UJEPZAQUCL4Q5JMZFEUQA` | OZ v0.6 rule shape. |

Their measurements, parameters, and deploy notes are in this file's git
history (`git log -p -- DEPLOYED.md`).

## Deploying

See [docs/RUNBOOKS.md](docs/RUNBOOKS.md) §2. Record every deployment here:
address, wasm hash, deployer, commit, and `stellar-cli` version.
