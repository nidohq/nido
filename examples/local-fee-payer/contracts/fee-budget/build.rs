// The contract's wasm gets a 64 KiB stack instead of rustc's 1 MiB default.
// Every cross-contract call instantiates a fresh VM and is charged its whole
// initial linear memory, so the default stack alone made a recovery
// completion at the document caps exceed the network's memory limit
// (docs/recovery/budgets.md, "Wasm stack").
fn main() {
    if std::env::var("CARGO_CFG_TARGET_FAMILY").as_deref() == Ok("wasm") {
        println!("cargo:rustc-link-arg-cdylib=-zstack-size=65536");
    }
}
