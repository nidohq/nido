/**
 * Semantic validation of a parsed PolicyDoc: a TS port of perch-ir's
 * `validate()` (`vendor/perch/crates/perch-ir/src/validate.rs`).
 *
 * The on-chain compiler runs `perch_ir::validate` before lowering, so a
 * document it refuses is never installable. perch's TS package ships the
 * schema but not this pass, so `lowerDoc` runs this one first and refuses
 * exactly what the Rust validator refuses — otherwise an SDK consumer could
 * build an install plan the chain then rejects.
 *
 * Like the Rust pass it collects every violation rather than stopping at the
 * first. Each error carries `kind`, the name of the matching Rust
 * `ValidationError` variant; `validate.test.ts` replays a corpus of documents
 * whose Rust verdicts are pinned by the integration-tests crate
 * (`validate_differential.rs`) and requires the same kinds, so a drift on
 * either side fails a test.
 */

import type { PolicyDoc, Rule } from '@stellar-registry/perch';
import { ACK_SENTINEL } from '@stellar-registry/perch';

/** perch-ir's `MAX_SIGNER_KEY_LEN`: the largest decoded signer key, in bytes. */
export const MAX_SIGNER_KEY_LEN = 256;

const I128_MAX = 2n ** 127n - 1n;
/** The BN254 scalar field modulus as 64 lowercase hex characters; fixed-width
 *  lowercase hex compares in the same order as the number. */
const BN254_SCALAR_MODULUS_HEX = '30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001';

/** One semantic violation. `kind` is the perch-ir `ValidationError` variant. */
export interface DocValidationError {
  kind: string;
  message: string;
}

type Recovery = NonNullable<PolicyDoc['recovery']>;
type ZkFields = Extract<Recovery['mode'], { type: 'zk-only' }>;
type GuardianFields = Extract<Recovery['mode'], { type: 'guardian-only' }>;

/** CRC16-XModem checksum check over a 56-char base32 strkey (perch-ir's
 *  `strkey_checksum_ok`). */
function strkeyChecksumOk(s: string): boolean {
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
  if (out !== 35) return false;
  const want = data[33]! | (data[34]! << 8);
  let crc = 0;
  for (let i = 0; i < 33; i++) {
    crc ^= data[i]! << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc === want;
}

/** Length 56, base32 alphabet, a leading letter from `leads`, valid checksum. */
function isStrkeyShape(s: string, leads: string): boolean {
  return s.length === 56 && leads.includes(s[0]!) && /^[A-Z2-7]+$/.test(s) && strkeyChecksumOk(s);
}

const isContractAddress = (s: string) => isStrkeyShape(s, 'C');
const isAddress = (s: string) => isStrkeyShape(s, 'CG');
/** A valid Soroban `Symbol`: 1–32 chars from `[a-zA-Z0-9_]`. */
const isValidSymbol = (s: string) => /^[a-zA-Z0-9_]{1,32}$/.test(s);
/** Decodable by the Rust `hex` crate: even length, either case. */
const isHex = (s: string) => /^(?:[0-9a-fA-F]{2})*$/.test(s);
/** 64 lowercase hex characters (a SHA-256 digest). */
const isSha256Hex = (s: string) => /^[0-9a-f]{64}$/.test(s);

/** Whether `limit` parses as a positive `i128` under Rust's `str::parse`. */
function isPositiveI128(limit: string): boolean {
  if (!/^\+?[0-9]+$/.test(limit)) return false;
  const v = BigInt(limit);
  return v > 0n && v <= I128_MAX;
}

/**
 * Validate a document, collecting every violation (empty when valid). Mirrors
 * perch-ir's `validate()` check for check.
 */
export function validateDoc(doc: PolicyDoc): DocValidationError[] {
  const errors: DocValidationError[] = [];
  const push = (kind: string, message: string) => errors.push({ kind, message });

  const version = (doc as { version: number }).version;
  if (version !== 1) {
    push('UnsupportedVersion', `unsupported document version ${version} (expected 1)`);
  }

  const seenSignerIds = new Set<string>();
  // Keyed on verifier + lowercased key hex so the same physical key under two
  // ids is caught regardless of hex case; maps to the first id seen.
  const seenKeyMaterial = new Map<string, string>();
  const seenDelegated = new Map<string, string>();
  doc.signers.forEach((signer, position) => {
    if (signer.id === '') {
      push('EmptySignerId', `signer at position ${position}: id is empty`);
    } else if (seenSignerIds.has(signer.id)) {
      push('DuplicateSignerId', `duplicate signer id "${signer.id}"`);
    } else {
      seenSignerIds.add(signer.id);
    }
    if ('address' in signer) {
      if (!isAddress(signer.address)) {
        push(
          'InvalidDelegatedAddress',
          `signer "${signer.id}": delegated address "${signer.address}" is not a G- or C-address strkey`,
        );
      }
      const first = seenDelegated.get(signer.address);
      if (first !== undefined) {
        push(
          'DuplicateSignerKey',
          `signer "${signer.id}" is the same delegated address as "${first}" (same physical key under two ids)`,
        );
      } else {
        seenDelegated.set(signer.address, signer.id);
      }
    } else {
      if (!isHex(signer.key)) {
        push('InvalidSignerKeyHex', `signer "${signer.id}": key is not valid hex`);
      } else {
        const len = signer.key.length / 2;
        if (len === 0 || len > MAX_SIGNER_KEY_LEN) {
          push(
            'SignerKeyLength',
            `signer "${signer.id}": decoded key length ${len} outside 1..=${MAX_SIGNER_KEY_LEN} bytes`,
          );
        }
        const material = `${signer.verifier}\0${signer.key.toLowerCase()}`;
        const first = seenKeyMaterial.get(material);
        if (first !== undefined) {
          push(
            'DuplicateSignerKey',
            `signer "${signer.id}" shares verifier and key material with "${first}" (same physical key under two ids)`,
          );
        } else {
          seenKeyMaterial.set(material, signer.id);
        }
      }
      if (!isContractAddress(signer.verifier)) {
        push(
          'InvalidVerifierAddress',
          `signer "${signer.id}": verifier "${signer.verifier}" is not a C-address strkey`,
        );
      }
    }
  });

  // All declared ids (duplicates included) are valid reference targets.
  const declared = new Set(doc.signers.map((s) => s.id));

  const seenRuleNames = new Set<string>();
  doc.rules.forEach((rule, position) => {
    if (rule.name === '') {
      push('EmptyRuleName', `rule at position ${position}: name is empty`);
    } else if (seenRuleNames.has(rule.name)) {
      push('DuplicateRuleName', `duplicate rule name "${rule.name}"`);
    } else {
      seenRuleNames.add(rule.name);
    }
    validateRule(rule, declared, push);
  });

  if (doc.recovery !== undefined) {
    validateRecovery(doc.recovery, declared, push);
    const mode = doc.recovery.mode;
    if (mode.type !== 'guardian-only') {
      for (const rule of doc.rules) {
        if (
          rule.scope.type === 'contract' &&
          (rule.scope.address === mode.adapter || rule.scope.address === mode.pool)
        ) {
          push(
            'RuleScopedToRecoveryContract',
            `rule "${rule.name}": scoped to the document's own ZK adapter or pool "${rule.scope.address}"`,
          );
        }
      }
    }
  }

  return errors;
}

type Push = (kind: string, message: string) => void;

function validatePrincipalSigners(rule: string, signers: string[], declared: Set<string>, push: Push) {
  if (signers.length === 0) {
    push('EmptyPrincipalSigners', `rule "${rule}": principals list must be non-empty`);
  }
  const seen = new Set<string>();
  for (const id of signers) {
    if (seen.has(id)) {
      push('DuplicatePrincipalSigner', `rule "${rule}": principals list repeats signer "${id}"`);
    }
    seen.add(id);
    if (!declared.has(id)) {
      push('UnknownSignerRef', `rule "${rule}": references undeclared signer id "${id}"`);
    }
  }
}

function validateRule(rule: Rule, declared: Set<string>, push: Push) {
  const r = rule.name;

  if (rule.scope.type === 'contract' && !isContractAddress(rule.scope.address)) {
    push(
      'InvalidContractAddress',
      `rule "${r}": contract scope address "${rule.scope.address}" is not a C-address strkey`,
    );
  }

  const p = rule.principals;
  if (p.type === 'all') {
    validatePrincipalSigners(r, p.signers, declared, push);
  } else if (p.type === 'threshold') {
    validatePrincipalSigners(r, p.signers, declared, push);
    if (p.m === 0 || p.m > p.signers.length) {
      push(
        'InvalidThreshold',
        `rule "${r}": threshold m=${p.m} must be an integer in 1..${p.signers.length}`,
      );
    }
  } else {
    if (p.ack !== ACK_SENTINEL) {
      push('WrongAckSentinel', `rule "${r}": self-authenticating ack must be exactly "${ACK_SENTINEL}"`);
    }
    if (!isContractAddress(p.policy)) {
      push('InvalidPolicyAddress', `rule "${r}": policy "${p.policy}" is not a C-address strkey`);
    }
    if (!isHex(p['install-param-hex'])) {
      push('InvalidInstallParamHex', `rule "${r}": install-param-hex is not valid hex`);
    }
  }

  if (rule.functions !== undefined) {
    if (rule.functions.length === 0) {
      push('EmptyFunctions', `rule "${r}": functions list is present but empty (omit it for all functions)`);
    }
    const seen = new Set<string>();
    for (const fn of rule.functions) {
      if (fn === '') {
        push('EmptyFunctionName', `rule "${r}": functions list contains an empty name`);
      } else if (!isValidSymbol(fn)) {
        push('InvalidFunctionName', `rule "${r}": function "${fn}" is not a valid Soroban Symbol`);
      }
      if (seen.has(fn)) {
        push('DuplicateFunction', `rule "${r}": duplicate function "${fn}"`);
      }
      seen.add(fn);
    }
  }

  if (rule.args !== undefined) {
    if (rule.args.length === 0) {
      push('EmptyArgs', `rule "${r}": args list is present but empty (omit it for unconstrained)`);
    }
    const seen = new Set<number>();
    for (const { index, pred } of rule.args) {
      if (seen.has(index)) {
        push('DuplicateArgIndex', `rule "${r}": duplicate arg constraint for index ${index}`);
      }
      seen.add(index);
      if (pred.type === 'string-in') {
        if (pred.values.length === 0) {
          push('EmptyStringInValues', `rule "${r}": string-in at arg ${index} has an empty values list`);
        }
        const values = new Set<string>();
        for (const v of pred.values) {
          if (values.has(v)) {
            push('DuplicateStringInValue', `rule "${r}": string-in at arg ${index} repeats value "${v}"`);
          }
          values.add(v);
        }
      } else if (pred.type === 'address-eq' && !isAddress(pred.address)) {
        push(
          'InvalidArgAddress',
          `rule "${r}": address-eq at arg ${index}: "${pred.address}" is not a C- or G-address strkey`,
        );
      }
    }
  }

  if (rule['not-after-ledger'] === 0) {
    push('ZeroNotAfterLedger', `rule "${r}": not-after-ledger must be >= 1, got 0 (omit it for no expiry)`);
  }

  const cap = rule.cap;
  if (cap !== undefined) {
    if (!isPositiveI128(cap.limit)) {
      push(
        'InvalidCapLimit',
        /^\+?[0-9]+$/.test(cap.limit)
          ? `rule "${r}": cap.limit ${cap.limit} out of range (positive i128 required)`
          : `rule "${r}": cap.limit "${cap.limit}" is not a positive decimal integer`,
      );
    }
    if (cap['period-ledgers'] === 0) {
      push('ZeroCapPeriod', `rule "${r}": cap.period-ledgers must be non-zero`);
    }
    // OZ spending_limit meters the rule's scope contract, so a capped rule
    // must be contract-scoped and an explicit token must equal that scope.
    if (rule.scope.type === 'contract') {
      if (cap.token !== undefined && !isContractAddress(cap.token)) {
        push('InvalidCapToken', `rule "${r}": cap token "${cap.token}" is not a C-address`);
      } else if (cap.token !== undefined && cap.token !== rule.scope.address) {
        push(
          'CapTokenMismatch',
          `rule "${r}": cap.token ${cap.token} differs from the rule's contract scope ${rule.scope.address} — it would silently meter a different contract`,
        );
      }
    } else {
      push('CapWithoutToken', `rule "${r}": a cap needs a contract scope (no token to meter on self-admin)`);
    }
  }
}

function validateRecovery(r: Recovery, declared: Set<string>, push: Push) {
  if (r.replaceable.length === 0) {
    push('EmptyRecoveryReplaceable', 'recovery: replaceable is empty (nothing for recovery to restore)');
  }
  const seen = new Set<string>();
  for (const id of r.replaceable) {
    if (seen.has(id)) {
      push('DuplicateRecoveryReplaceable', `recovery: replaceable repeats signer "${id}"`);
    }
    seen.add(id);
    if (!declared.has(id)) {
      push('UnknownRecoveryReplaceableRef', `recovery: replaceable references undeclared signer "${id}"`);
    }
  }
  if (r['delay-ledgers'] === 0) push('ZeroRecoveryDelayLedgers', 'recovery: delay-ledgers is 0');
  if (r['expiry-ledgers'] === 0) push('ZeroRecoveryExpiryLedgers', 'recovery: expiry-ledgers is 0');
  if (r['max-cancels'] === 0) push('ZeroRecoveryMaxCancels', 'recovery: max-cancels is 0');
  if (!isContractAddress(r.controller)) {
    push('InvalidRecoveryController', `recovery: controller "${r.controller}" is not a C-address strkey`);
  }
  if (r.baseline !== undefined && !isSha256Hex(r.baseline['doc-hash'])) {
    push(
      'InvalidBaselineDocHash',
      `recovery: baseline doc-hash "${r.baseline['doc-hash']}" is not 64 lowercase hex characters`,
    );
  }
  const mode = r.mode;
  if (mode.type === 'guardian-only' || mode.type === 'combined') validateGuardianSet(mode, push);
  if (mode.type === 'zk-only' || mode.type === 'combined') validateZkFactor(mode, push);
}

function validateGuardianSet(g: Pick<GuardianFields, 'guardians' | 'quorum'>, push: Push) {
  if (g.guardians.length === 0) push('EmptyGuardianSet', 'recovery: guardian set is empty');
  const seen = new Set<string>();
  for (const addr of g.guardians) {
    if (seen.has(addr)) push('DuplicateGuardian', `recovery: duplicate guardian "${addr}"`);
    seen.add(addr);
    if (!isAddress(addr)) {
      push('InvalidGuardianAddress', `recovery: guardian "${addr}" is not a C- or G-address strkey`);
    }
  }
  if (g.quorum === 0 || g.quorum > g.guardians.length) {
    push(
      'InvalidGuardianQuorum',
      `recovery: guardian quorum=${g.quorum} out of range 1..=${g.guardians.length} (guardian count)`,
    );
  }
}

function validateZkFactor(z: Omit<ZkFields, 'type'>, push: Push) {
  if (!isContractAddress(z.adapter)) {
    push('InvalidRecoveryAdapter', `recovery: adapter "${z.adapter}" is not a C-address strkey`);
  }
  if (!isSha256Hex(z['circuit-id'])) {
    push('InvalidCircuitId', `recovery: circuit-id "${z['circuit-id']}" is not 64 lowercase hex characters`);
  }
  if (!isContractAddress(z.pool)) {
    push('InvalidRecoveryPool', `recovery: pool "${z.pool}" is not a C-address strkey`);
  }
  if (!isSha256Hex(z['enrollment-id'])) {
    push(
      'InvalidEnrollmentId',
      `recovery: enrollment-id "${z['enrollment-id']}" is not 64 lowercase hex characters`,
    );
  }
  if (!isSha256Hex(z.commitment) || z.commitment >= BN254_SCALAR_MODULUS_HEX) {
    push(
      'InvalidCommitment',
      `recovery: commitment "${z.commitment}" is not a canonical BN254 field element in 64 lowercase hex characters`,
    );
  }
}
