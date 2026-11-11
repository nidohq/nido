# C01Authority -- Overview

## Executive Summary

Campaign C01Authority targets the pure authority kernel of the Nido `g-account-core` crate
(`src/authority.rs`): six functions (`validate`, `authorization_weight`, `can_authorize`,
`rotate`, `roles_distinct`, `contains_key`) governing signer validation, weight
accumulation, authorization decisions, and key rotation for self-directed Stellar
G-accounts. 41 theorem statements were written covering validation, authorization,
rotation success/rejection, coalition preservation, recovery, and unrecoverability.
**All 41 theorems are tainted** (`sorry`-bodied): the Lean project builds, but no
property has been proved. Zero properties of the implementation have been verified.
Both measurement anchors (`authorization_weight`, `can_authorize`) are **ungrounded**:
no established bridge ties the projected quantities in the properties back to the real
translated functions. The pre-proof spec-judge screen found 0 defects in the
statements.

## Overview Table

| Category | Count | Theorems |
|---|---|---|
| Implementation-verified (headline) | **0** | -- |
| Verified modulo trusted base | 0 | -- |
| Surface-only (names type/constant, runs no function) | 0 | -- |
| Abstract-only (no translated reference) | 0 | -- |
| **Tainted** (`sorry` / unestablished) | **41** | All 41 theorems |
| Refuted | 0 | -- |

### Grounding

| Anchor | Status |
|---|---|
| `authorization_weight` | **Ungrounded** -- no established bridge |
| `can_authorize` | **Ungrounded** -- no established bridge |

### Pre-proof spec-judge screen

`spec_judge.defects`: **none** (0 defects). All 41 statements passed the schema
conformance gate before proving was attempted.

### Statement drift

All 41 theorems are **stable** (no unaccounted drift between FORMALISE and PROVE
stages).
