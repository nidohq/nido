/**
 * Address formatting helpers for Stellar C-addresses (and G-addresses).
 *
 * Centralizes the truncation logic that was previously duplicated ad-hoc across
 * components (e.g. `addr.slice(0, 6) + '…' + addr.slice(-6)`). New code should
 * import from here; existing call sites are migrated opportunistically.
 */

/**
 * Truncate a long address to `head`…`tail` form.
 *
 * @param addr  full address string (C… / G… / contract id)
 * @param head  characters to keep at the start (default 4)
 * @param tail  characters to keep at the end (default 4)
 * @returns truncated string, or the original if it is already short enough
 *
 * @example shortAddr("CABC…XYZ", 4, 4) -> "CABC…WXYZ"
 */
export function shortAddr(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  // Keep short strings intact; only truncate when there is something to hide.
  return addr.length > head + tail + 1
    ? `${addr.slice(0, head)}…${addr.slice(-tail)}`
    : addr;
}

const CONTRACT_VERSION_BYTE = 2 << 3;

/**
 * True iff `s` is a valid contract StrKey (`C…`): 56 base32 characters that
 * decode to the contract version byte, 32 bytes of id, and a matching
 * CRC16-XModem checksum. Self-contained (no `Buffer`), so it gives the same
 * answer in every page whether or not the SDK's polyfill has loaded.
 */
export function isContractStrKey(s: string): boolean {
  if (s.length !== 56) return false;
  const data = new Uint8Array(35);
  let buf = 0;
  let bits = 0;
  let out = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let v: number;
    if (c >= 65 && c <= 90) v = c - 65;
    else if (c >= 50 && c <= 55) v = c - 50 + 26;
    else return false;
    buf = ((buf << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      data[out++] = (buf >> bits) & 0xff;
    }
  }
  if (out !== 35 || data[0] !== CONTRACT_VERSION_BYTE) return false;
  let crc = 0;
  for (let i = 0; i < 33; i++) {
    crc ^= data[i]! << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc === (data[33]! | (data[34]! << 8));
}
