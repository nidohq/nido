//! Stage the smart-account wasm and expose its path to the crate.
//!
//! The factory embeds the smart-account contract wasm (via `include_bytes!` in
//! `src/contract.rs`) so it can derive the deploy hash at runtime instead of
//! hardcoding it. The wasm is produced by `just build-contracts` at
//! `target/wasm32v1-none/contract/g2c_smart_account.wasm`.
//!
//! This script copies that wasm to a stable staging location —
//!   <workspace-target>/stellar/<STELLAR_NETWORK or "local">/smart_account_0_1_0.wasm
//! (the path `stellar_build::get_target_dir` would resolve) — and exports
//! `STELLAR_ACCOUNT_WASM` pointing at it, so the embed path lives in exactly
//! one place. `src/contract.rs` then `include_bytes!`es that path and derives
//! the deploy hash as `sha256` of the bytes at runtime. (An earlier design
//! used `stellar_registry::import_contract_client!`, which is why the staged
//! filename follows that macro's naming convention; the macro itself is no
//! longer used — see the `mod smart_account` doc in `src/contract.rs`.)
//!
//! Build scripts complete before the crate they belong to is compiled, so the
//! file and env var are in place by the time the source is built.

use std::path::{Path, PathBuf};

/// Version label for the staged-wasm filename, following the
/// `import_contract_client!` convention that maps `smart-account@0.1.0` to the
/// file stem `smart_account_0_1_0`. This is only a staging-path label; the
/// deploy hash is derived from the embedded bytes, not this string.
const ACCOUNT_VERSION: &str = "0.1.0";

fn main() {
    let target_dir = workspace_target_dir();

    let built_wasm = target_dir
        .join("wasm32v1-none")
        .join("contract")
        .join("g2c_smart_account.wasm");

    // Mirror `stellar_build`: network dir defaults to "local".
    let network = std::env::var("STELLAR_NETWORK").unwrap_or_else(|_| "local".to_owned());
    let stellar_dir = target_dir.join("stellar").join(&network);
    let staged = stellar_dir.join(format!(
        "smart_account_{}.wasm",
        ACCOUNT_VERSION.replace('.', "_")
    ));

    println!("cargo:rerun-if-env-changed=STELLAR_NETWORK");
    println!("cargo:rerun-if-changed={}", built_wasm.display());

    let embed_path = if built_wasm.exists() {
        std::fs::create_dir_all(&stellar_dir)
            .unwrap_or_else(|e| panic!("create_dir_all {}: {e}", stellar_dir.display()));
        std::fs::copy(&built_wasm, &staged).unwrap_or_else(|e| {
            panic!("copy {} -> {}: {e}", built_wasm.display(), staged.display())
        });
        staged
    } else if staged.exists() {
        // No freshly-built wasm this run; fall back to a copy a previous build
        // (or the registry-download path) staged. This can embed STALE bytes,
        // so make it loud — a developer who forgot `just build-contracts` after
        // editing the smart-account would otherwise silently ship the old wasm.
        println!(
            "cargo:warning=factory: embedding PREVIOUSLY-STAGED smart-account wasm \
             ({}); freshly-built {} not found. Run `just build-contracts` to embed \
             the current bytes.",
            staged.display(),
            built_wasm.display()
        );
        staged
    } else {
        panic!(
            "smart-account wasm not found.\n\
             Expected built wasm at: {}\n\
             or a staged copy at:    {}\n\
             Run `just build-contracts` (or `stellar contract build`) first so the \
             factory can embed the smart-account wasm.",
            built_wasm.display(),
            staged.display()
        );
    };

    // `include_bytes!(env!("STELLAR_ACCOUNT_WASM"))` reads this.
    println!(
        "cargo:rustc-env=STELLAR_ACCOUNT_WASM={}",
        embed_path.display()
    );
}

/// Resolve the Cargo target directory (the `target/` containing build outputs).
/// `OUT_DIR` is `<target>/<profile>/build/<pkg>-<hash>/out`; walk up to the
/// `target` dir that holds `wasm32v1-none`.
fn workspace_target_dir() -> PathBuf {
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR not set"));
    out_dir
        .ancestors()
        .find(|p| p.join("wasm32v1-none").is_dir() || p.file_name() == Some("target".as_ref()))
        .map_or_else(
            // Conventional fallback: OUT_DIR/../../../..
            || out_dir.join("..").join("..").join("..").join(".."),
            Path::to_path_buf,
        )
}
