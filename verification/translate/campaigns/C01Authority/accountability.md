# C01Authority Translation Accountability

## Strategy
IN-PLACE on `g-account-core` crate (zero external dependencies, all types local).

## Charon invocation
```
cd /workspace/repo/crates/g-account-core && \
charon cargo --preset=aeneas \
  --start-from crate::authority \
  -- -p g-account-core --release
```

No `--opaque` or `--exclude` flags were needed. The crate has no external
dependencies beyond std. `--start-from crate::authority` scoped the extraction
to the authority module. `--release` compiles under the deployed profile.

## Aeneas invocation
```
aeneas -backend lean -dest /workspace/out/lean \
  /workspace/repo/crates/g-account-core/g_account_core.llbc
```
Single-file output: `GAccountCore.lean`. No `-split-files`.

## Post-generation cleanup
Stripped all `core::fmt::Debug` surface from `GAccountCore.lean` via a Python
filter pass (30 blocks, 373 lines deleted). This removed:
- The `core.option.Option.Insts.CoreFmtDebug.fmt` axiom and its wrapper def
- 14 type-level `.fmt` method defs (`authority.Key.Insts.CoreFmtDebug.fmt`,
  `authority.AccountKind.Insts.CoreFmtDebug.fmt`, etc.)
- 14 corresponding trait-instance defs (`authority.Key.Insts.CoreFmtDebug`,
  `authority.AccountKind.Insts.CoreFmtDebug`, etc.)

Rationale: Debug impls are non-value rendering surface. No target function
calls any Debug impl and no inferred property depends on Debug formatting.
Using `--exclude core::fmt::Debug::*` in Charon crashed Aeneas
(`Not_found` in `simplify_panics.is_from_str`), so post-generation stripping
was used instead.

## Overflow posture
- **Deployed profile**: `[profile.release] overflow-checks = true` in
  `crates/g-account-core/Cargo.toml`
- **Charon compile**: `--release` → reads `[profile.release]` with
  `overflow-checks = true`
- **Model posture**: FALLIBLE (checked) — matches deployment
- **Confirmation**: The only arithmetic in targets is `weight += s.weight as u16`
  (max value 4, cannot overflow u16) and loop index `i += 1`. Both are emitted as
  checked operations in the Lean, consistent with `overflow-checks = true`.

## Source edits
NONE. No source modifications were made. The crate translated cleanly as-is.

## Axioms in generated Lean
One axiom remains after cleanup:
- `core.option.Option.Insts.CoreCmpPartialEqOption.eq` — PartialEq impl for
  `Option<T>`. Only referenced by the derived `PartialEq` for `Operation`
  (`authority.Operation.Insts.CoreCmpPartialEqOperation.eq`). No target function
  compares entire `Operation` structs — `rotate` uses `is_some` (pattern match)
  for `source` and `OperationBody`'s concrete `PartialEq` for `body`.

**This axiom is NOT transitively reachable from any target function.**

## Target functions — all 6 as real `def`s
| Target | Line | Status |
|--------|------|--------|
| `authority.contains_key` | 862 | `def` with body |
| `authority.roles_distinct` | 869 | `def` with body |
| `authority.validate` | 1181 | `def` with body |
| `authority.authorization_weight` | 1276 | `def` with body |
| `authority.can_authorize` | 1293 | `def` with body |
| `authority.rotate` | 1707 | `def` with body |

## Lean compilation
`lake build` and `lake env lean GAccountCore.lean` both exit 0. No errors.

## Decision
Translation from scratch (no prior translation existed). The generated
`GAccountCore.lean` is the complete shared translation for this crate,
with Debug surface stripped post-generation.
