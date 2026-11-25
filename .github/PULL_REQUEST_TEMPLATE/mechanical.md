<!--
Mechanical PR: a Perch re-pin, regenerated bindings, lockfile or dependency bump,
moved or vendored code, deploy records. This body becomes the squash commit's
message on main: delete every comment before you mark the PR ready.
-->

## Why

<!-- What prompted it: the upstream release, the advisory, the issue. One line is fine. -->

## What was generated, moved or vendored

<!-- One line per artifact: path glob -> producing command and tool version(s), and
the input (pinned sha, manifest, upstream tag). -->

## Reproduce

<!-- Exact commands from a clean checkout of the base, e.g.
`scripts/repin-perch.sh <sha> --network testnet`. Expected result: an empty `git diff`. -->

## Hand edits

<!-- Every line NOT produced by the commands above (file:line), and why. These are the
only lines to review closely. "None." -->

## Provenance

<!-- How the content is checked against its source: `just check-vendor-drift`, a
checksum, a test. For vendored code: upstream URL and tag/sha, license, local delta. -->

## After merge

<!-- Factory redeploy, DEPLOYED.md, a matching mainnet re-pin, and who owns each. "Nothing." -->
