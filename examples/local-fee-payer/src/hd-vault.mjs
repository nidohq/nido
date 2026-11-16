import { generateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Keypair } from '@stellar/stellar-sdk';
import { b64, unb64, concat, utf8 } from './webauthn.mjs';

export const U_PATH = "m/44'/148'/0'";
export const FEE_PATH = "m/44'/148'/1'";
export const newMnemonic = () => generateMnemonic(wordlist, 256);

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

// SEP-5 / SLIP-0010: Ed25519 supports hardened derivation only.
export async function deriveStellarSeed(seed, accountIndex) {
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex >= 0x80000000) throw Error('Invalid HD account index');
  let material = await hmac(utf8('ed25519 seed'), seed);
  for (const index of [44, 148, accountIndex]) {
    const encoded = new Uint8Array(4); new DataView(encoded.buffer).setUint32(0, index + 0x80000000, false);
    const next = await hmac(material.slice(32), concat(new Uint8Array([0]), material.slice(0, 32), encoded));
    material.fill(0); material = next;
  }
  const result = material.slice(0, 32); material.fill(0); return result;
}

export async function derivePublicAccounts(mnemonic) {
  const seed = await mnemonicToSeed(mnemonic);
  const u = await deriveStellarSeed(seed, 0); const f = await deriveStellarSeed(seed, 1);
  try { return { u: Keypair.fromRawEd25519Seed(u).publicKey(), fee: Keypair.fromRawEd25519Seed(f).publicKey() }; }
  finally { seed.fill(0); u.fill(0); f.fill(0); }
}

export async function withFeeKey(mnemonic, action) {
  return withDerivedKey(mnemonic, 1, action);
}
// Wallet-internal capability. Never exposed over postMessage or the bootstrap API.
export async function withAccessKey(mnemonic, action) {
  return withDerivedKey(mnemonic, 0, action);
}
async function withDerivedKey(mnemonic, index, action) {
  const seed = await mnemonicToSeed(mnemonic); const derived = await deriveStellarSeed(seed, index);
  // RFC 8410 PKCS#8 Ed25519 seed wrapper. The imported key cannot be exported.
  const prefix = new Uint8Array([0x30,0x2e,0x02,0x01,0,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
  const encoded = concat(prefix, derived);
  try {
    const publicKey = Keypair.fromRawEd25519Seed(derived).publicKey();
    const privateKey = await crypto.subtle.importKey('pkcs8', encoded, 'Ed25519', false, ['sign']);
    return await action({ publicKey, privateKey });
  } finally { seed.fill(0); derived.fill(0); encoded.fill(0); }
  // Best effort only: JavaScript strings, library copies and GC cannot be reliably zeroized.
}

async function wrappingKey(prf) {
  if (!(prf instanceof Uint8Array) || prf.length !== 32) throw Error('A 32-byte passkey PRF result is required; no fallback');
  return crypto.subtle.importKey('raw', prf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function sealMnemonic(mnemonic, prf, binding) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = utf8(mnemonic);
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(binding) }, await wrappingKey(prf), plaintext);
    return { iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
  } finally { plaintext.fill(0); }
}
export async function openMnemonic(record, prf, binding) {
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(record.iv), additionalData: utf8(binding) }, await wrappingKey(prf), unb64(record.ciphertext)));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(plaintext); }
  finally { plaintext.fill(0); }
}
