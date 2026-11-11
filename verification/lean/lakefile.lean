import Lake
open Lake DSL

require aeneas from git "https://github.com/AeneasVerif/aeneas.git" @ "0d21a9ec7bbbb110110cacc14464a47fd71c8705" / "backends/lean"

package «GAccountCore» where

@[default_target]
lean_lib «GAccountCore» where
  globs := #[.andSubmodules `GAccountCore]
