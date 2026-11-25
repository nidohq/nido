# Contributing to Nido

Build, test, and architecture notes are in [README.md](./README.md) and
[AGENTS.md](./AGENTS.md). This file covers how a change is described.

## Pull requests and commits

Nido merges by squash. The squash commit takes the **PR title as its
subject** and the **PR description as its message**, so both become
permanent history on `main`. Write them for someone running `git log` in a
year, not for this week's reviewer.

### Title

`type(scope): imperative summary`, lower-case after the colon, no full stop,
72 characters at most ([Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)).
Add `!` before the colon for a breaking change.

Types, by what the change does:

| Type | Use it for |
| --- | --- |
| `feat` | Something new a user, dApp, or integrator can do: a wallet screen, an SDK call, a contract entry point |
| `fix` | Wrong behaviour made right: a rejected signature, a wrong balance, a broken page |
| `perf` | The same behaviour, faster or cheaper: fewer contract instructions, lower fees, a smaller bundle |
| `refactor` | Code restructured with no change in behaviour |
| `revert` | An earlier commit undone; name its SHA in the body |
| `test` | Tests only: `crates/integration-tests`, unit tests, ZK fixtures that tests replay |
| `docs` | Documentation only: `docs/`, READMEs, code comments |
| `build` | How the code is built: the `justfile`, Cargo and npm manifests, wasm builds |
| `ci` | GitHub Actions workflows and their scripts |
| `chore` | Upkeep nobody sees, such as dependency bumps (`chore(deps)`) and Perch re-pins (`chore(perch)`) |
| `style` | Formatting only (`cargo fmt`, Prettier); no code changes |

Scopes, by the part of Nido the change is in. A scope is optional; separate
two with a comma only when a change truly spans both:

| Scope | Covers |
| --- | --- |
| `frontend` | The site in `packages/frontend`: pages, components, styling |
| `wallet` | Wallet features a user works with (accounts, sending, signing, recovery, fees), wherever the code lives |
| `passkey-sdk` | `packages/passkey-sdk`, the TypeScript SDK the frontend and dApps call |
| `factory` | `contracts/factory`, which deploys Perch accounts |
| `contracts` | Nido's other contracts under `contracts/`: policies, the name registry, status message |
| `relayer` | `infra/relayer`, the relayer that pays transaction fees, and its channels plugin |
| `perch` | The Perch stack as Nido uses it: the `vendor/perch` pin, Perch infra caches, policy docs |
| `infra` | The other services under `infra/` (resolver, invite, demo service, Redis) and deployment config |
| `examples` | `examples/`, the sample dApps |
| `docs` | `docs/` and the top-level Markdown files |
| `deps` | Dependency bumps, npm or Cargo, usually as `chore(deps)` |

The scope list lives in [`.github/review-conventions.json`](./.github/review-conventions.json).
Use a draft PR rather than "WIP" or "DO NOT MERGE" in the title.

### Description

GitHub opens a PR with the default template. Pick a variant when the change
fits one better, with `gh pr create --template <file>` or by adding
`?template=<file>` to the compare URL:

| Template | Use it for |
| --- | --- |
| [default](./.github/pull_request_template.md) | Most changes |
| [`contract.md`](./.github/PULL_REQUEST_TEMPLATE/contract.md) | `contracts/`, signing, recovery, `packages/passkey-sdk/src/perch/`, `infra/relayer/`, or a [security invariant](./docs/SECURITY_INVARIANTS.md) |
| [`wallet.md`](./.github/PULL_REQUEST_TEMPLATE/wallet.md) | Wallet and dApp UI: preview link, network, what to try, screenshots |
| [`mechanical.md`](./.github/PULL_REQUEST_TEMPLATE/mechanical.md) | Re-pins, regenerated bindings, lockfiles, vendored or moved code |
| [`stack.md`](./.github/PULL_REQUEST_TEMPLATE/stack.md) | One PR in a stack |
| [`docs.md`](./.github/PULL_REQUEST_TEMPLATE/docs.md) | Documentation only |

The sections every template shares, and what each must contain:

- **Why:** the problem and why this approach. Link the issue here.
- **What changes:** what a user, dApp, or integrator sees differently, not
  a file list; then what deliberately does not change.
- **How to review:** where to start (`path::symbol`), the one to three risky
  places, and what to skim (with the command that generated it).
- **Evidence:** commands and results with counts, a test that fails without
  the change, and what was not tested. In the contract template, name the
  evidence kind from [SECURITY_INVARIANTS.md](./docs/SECURITY_INVARIANTS.md#evidence-kinds).
- **Decisions for review:** the choices a reviewer could make differently,
  as questions.
- **After merge:** deploys, re-pins, follow-ups, and who owns each.

Because the description is the commit message:

- Delete every `<!-- -->` comment before marking the PR ready.
- Answer a section that does not apply with "None." rather than deleting it.
- Keep the description true at merge time. Review back-and-forth, agent
  prompts (`## Intent`), pipeline output (`## Pipeline`), and dated review
  logs go in PR comments, never in the description.

### Commits

Commits are reviewed while the PR is open, so they follow the same structure
in miniature. Enable the template once per clone:

```sh
git config commit.template .gitmessage
```

[`.gitmessage`](./.gitmessage) gives the shape: a subject in the title's
format, then a body with a `Why:` paragraph (every commit type; one line is
enough for a small change), `What changes:` and `Evidence:` where they add
something, then trailers. In a `chore(deps)` bump, the `Why:` is where
context such as a security advisory goes.

Trailers:

- `Refs: #123` for issues.
- `Security: F2, W3` with [invariant IDs](./docs/SECURITY_INVARIANTS.md), or
  `Security: none`.
- `BREAKING-CHANGE: <what breaks and how to migrate>` with `!` in the
  subject. Write it in upper case: Conventional Commits tooling treats
  `BREAKING-CHANGE` and `BREAKING CHANGE` as the only spellings.

Give each commit one kind of risk: a move or rename, a behaviour-preserving
refactor, a behaviour change with its tests, regenerated output (name the
command), docs. Fold fixups into the commit they fix before asking for
review (`git commit --fixup=<sha>`, then `git rebase -i --autosquash`).

Check messages locally before pushing, with the same shared checker CI runs:

```sh
rc="npx --yes github:bitswell-hq/review-conventions#v1"
$rc commits --base origin/main                      # this branch's commits
$rc body --body-file body.md --base origin/main     # a description
$rc title --title "fix(factory): ..."
```

### What CI checks

[`.github/workflows/review-conventions.yml`](./.github/workflows/review-conventions.yml)
runs on every PR open, push, and edit. It calls the shared
[bitswell-hq/review-conventions](https://github.com/bitswell-hq/review-conventions)
workflow, whose README lists every rule:

- the title format;
- leftover comments, process headings, and missing or empty template
  sections;
- each commit message.

Nido adds five rules in
[`.github/review-conventions.json`](./.github/review-conventions.json):

- `contract-sections`: the contract sections when a security-relevant path
  changes (not for mechanical PRs such as re-pins);
- `invariant-ids`: the invariant IDs a description cites must exist in
  SECURITY_INVARIANTS.md;
- `evidence-kind`: an evidence kind in `## Invariants`;
- `security-trailer`: valid IDs in a commit's `Security:` trailer;
- `security-trailer-missing`: a commit that changes a security-relevant path
  carries a `Security:` trailer (IDs, or `none`). It reads the commit's
  files, so it is code:
  [`scripts/review-conventions-rules.mjs`](./scripts/review-conventions-rules.mjs).

The checks **warn only**: findings show as annotations and in the job
summary, and the check passes. Changing `mode: warn` to `mode: block` in the
workflow makes any finding fail, except on a draft PR.

### Generated files

[`.gitattributes`](./.gitattributes) marks lockfiles, ZK proof fixtures, and
the contract bindings' generated sources `linguist-generated`, so GitHub
collapses them in the diff. If you edit one of those files by hand, list the
edit under the mechanical template's `## Hand edits`. Never mark a
hand-written source file as generated: a collapsed file escapes review.

### Where the rules live

The checker is shared with other repositories, so Nido does not change it
here. A generic rule that is missing or wrong is fixed in
bitswell-hq/review-conventions. Nido owns its templates under `.github/`,
`.gitmessage`, `.gitattributes`, the scopes and rules in
`.github/review-conventions.json`, and `scripts/review-conventions-rules.mjs`.
