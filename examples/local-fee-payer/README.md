# Wallet-owned local fee signing

This first review layer supplies the HD/PRF vault, exact-envelope signing
boundary, keyless WASI/Cedar checker, native Perch signing vectors, and
adversarial tests. The dapp UI and on-chain funding example follow in the
stack. No production Nido path changes in this layer.

Run `npm ci`, `npm run build:runtime` (Rust 1.97.1 + wasm32-wasip1), and
`npm test` here. `proof/SigningBoundary.lean` is an abstract state model; it
does not prove correspondence to the Rust/JavaScript implementation or
secure key custody. Keys remain protected only while the wallet host and
browser boundary satisfy the documented trust assumptions.
