/**
 * Version of the canonical form implemented here, as defined by `CANONICAL.md`.
 * A format identifier, not part of the hash preimage — see the Rust
 * `CANON_VERSION` for the full rationale. Any change to the canonicalization
 * rules must bump this in lockstep with perch-ir.
 */
export declare const CANON_VERSION = 1;
/** Serialize a policy document to its canonical JSON form. */
export declare function canonicalJson(doc: unknown): string;
/** Lowercase-hex SHA-256 of the canonical JSON bytes — the document's identity. */
export declare function docHash(doc: unknown): string;
//# sourceMappingURL=canonical.d.ts.map