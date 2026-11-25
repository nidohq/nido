<!--
One member of a stack of PRs. This body becomes the squash commit's message on main:
delete every comment before you mark the PR ready, and keep the Stack section
accurate at merge time (it stays in history).
-->

## Stack

<!-- Tools that write the stack list (gh stack, Graphite) can replace the first line. -->
Part **k of n** of <issue link>. Base: `<branch>` (<PR URL>). Next: <PR URL>.

**Reviewed here:** <the concern this member owns>.
**Reviewed elsewhere:** <what shows in this diff but belongs to another member; link it>.
**Depends on:** <what from earlier members this relies on>.

## Why

## What changes

## How to review

<!-- After a rebase: `git range-diff <old-base>..<old-head> <base>..<head>`. -->

## Evidence

<!-- Builds and passes tests at THIS member's head, not only at the top of the stack. -->

## Decisions for review

## After merge

<!-- Merge order: after <PR URL>; retarget the next member's base to main once this lands. -->
