/** Build a WebAuthn-shaped assertion the on-chain verifier accepts, using a
 *  raw P-256 private key (no authenticator involvement).
 *
 *  Mirrors `build_contract_assertion` in `crates/integration-tests/src/lib.rs`.
 *  The on-chain verifier (`stellar_accounts::verifiers::webauthn`) enforces:
 *  - `digest == SHA-256(authenticatorData || SHA-256(clientDataJSON))`
 *  - challenge in clientDataJSON equals base64url(signature_payload)
 *
 *  The signature is RFC-6979 deterministic with low-S normalization (Stellar
 *  contract auth requires low-S).
 */
export interface SyntheticAssertion {
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
    signature: Uint8Array;
}
export declare function buildSyntheticAssertion(privateKeyD: Uint8Array, payload32: Uint8Array): Promise<SyntheticAssertion>;
//# sourceMappingURL=syntheticAssertion.d.ts.map