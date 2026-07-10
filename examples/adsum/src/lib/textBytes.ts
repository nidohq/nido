/**
 * Byte-length helpers for the petition title/body inputs. The `petitions`
 * contract caps `title` and `body` by UTF-8 byte length (Soroban `Bytes`/
 * `String` are measured in bytes, not JS UTF-16 code units), so the UI needs
 * a byte counter to enforce the same caps client-side before submitting.
 */

/** Contract-enforced cap on `Petition.title`, in UTF-8 bytes. */
export const TITLE_MAX_BYTES = 100

/** Contract-enforced cap on `Petition.body`, in UTF-8 bytes. */
export const BODY_MAX_BYTES = 2000

/** Number of bytes `s` occupies when encoded as UTF-8. */
export function utf8ByteLength(s: string): number {
	return new TextEncoder().encode(s).length
}
