<!--
This body becomes the squash commit's message on main, word for word. Delete
every comment like this one before you mark the PR ready, and keep review
back-and-forth in PR comments, never in the body (CONTRIBUTING.md).
Title: `type(scope): imperative summary`, 72 characters at most. It becomes the
commit subject. Any section may be answered "None." Do not delete a heading.
Other shapes: gh pr create --template contract.md | wallet.md | mechanical.md | stack.md | docs.md
-->

## Why

<!-- The problem in a reader's terms, and why this approach. Closes #N / Refs #N.
Name known shortcomings. One short paragraph. -->

## What changes

<!-- Behaviour, not a file list: what a user, dApp or integrator sees differently.
Then one line on what deliberately does NOT change. -->

## How to review

<!-- Start at: `path::symbol`.
Risky: the 1-3 places where a bug would hurt, and why.
Skim: what is mechanical, moved or generated (and the command that made it). -->

## Evidence

<!-- What ran, where, and the result, with counts: `npm test -w @nidohq/passkey-sdk` 214 passed.
Name a test that FAILS without this change. Name what was NOT tested and why. -->

## Decisions for review

<!-- Choices a reviewer could reasonably make differently: the alternative and why
it was rejected. Ask the specific question you want answered. "None." is fine. -->

## After merge

<!-- Deploy, re-pin, migration or follow-up steps, and who owns each. "Nothing." -->
