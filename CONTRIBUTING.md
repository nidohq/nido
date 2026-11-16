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

- **Types:** `feat`, `fix`, `perf`, `refactor`, `revert`, `test`, `docs`,
  `build`, `ci`, `chore`, `style`.
- **Scopes** (optional; comma-separate if a change truly spans two):
  `frontend`, `passkey-sdk`, `factory`, `relayer`, `perch`, `infra`, `docs`,
  `deps`.

The lists live in [`.github/pr-checks.json`](./.github/pr-checks.json).
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
format, then `Why:` (required for `feat`, `fix`, `perf`, `refactor` and
`revert`), `What changes:`, and an `Evidence:` line, then trailers:

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

Check messages locally before pushing:

```sh
npx @commitlint/cli@21.2.3 --from origin/main    # this branch's commits
node scripts/pr-lint/check-pr.mjs --title "fix(factory): ..." --body-file body.md --base origin/main
```

### What CI checks

[`.github/workflows/pr-description.yml`](./.github/workflows/pr-description.yml)
runs on every PR open, push, and edit. It checks the title format, leftover
comments, process headings, missing or empty template sections, the contract
sections when a security-relevant path changes, invariant IDs that
SECURITY_INVARIANTS.md does not define, and each commit message.

The checks **warn only**: findings show as annotations and in the job
summary, and the check passes. Setting `"blocking": true` in
[`.github/pr-checks.json`](./.github/pr-checks.json) makes them fail (for
the description, only once the PR is ready for review).

### Generated files

[`.gitattributes`](./.gitattributes) marks lockfiles, ZK proof fixtures, and
the contract bindings' generated sources `linguist-generated`, so GitHub
collapses them in the diff. If you edit one of those files by hand, list the
edit under the mechanical template's `## Hand edits`. Never mark a
hand-written source file as generated: a collapsed file escapes review.

### Shared and Nido-specific pieces

The checking is split so the generic part can move to a shared repository:

- **Generic:** `scripts/pr-lint/core.mjs`, `scripts/pr-lint/check-pr.mjs`,
  `scripts/pr-lint/core.test.mjs`, `commitlint.config.mjs`,
  `.github/workflows/pr-description.yml`, and the generic keys of
  `.github/pr-checks.json` (`blocking`, `types`, `scopes`,
  `headerMaxLength`, `whyTypes`, `helpUrl`, `rules`).
- **Nido-specific:** the templates under `.github/`, `.gitmessage`,
  `.gitattributes`, `scripts/pr-lint/nido-rules.mjs` and its test, and the
  `repo` block of `.github/pr-checks.json`.
