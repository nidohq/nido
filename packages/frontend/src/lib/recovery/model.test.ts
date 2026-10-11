import { describe, expect, it } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import {
  adminSignerIds,
  attemptLinkProblem,
  changeNeeds,
  changeSubject,
  changeToRequest,
  condition,
  decodeGuardianRequest,
  encodeGuardianRequest,
  findOwnAttempt,
  foreignVerifiers,
  hex,
  ownAttemptProblem,
  parseRecoveryKit,
  passkeyCheckCode,
  recoveryChangeRows,
  replacementsFromWire,
  replacementsToWire,
  summarizeRecovery,
  type AttemptReader,
  type OwnRecovery,
  type RecoveryMode,
  type RecoveryProfile,
  type WireReplacements,
} from './model';

const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const NETWORK = 'Test SDF Network ; September 2015';
const KEY = '04' + 'ab'.repeat(64);

const deployment: perch.PerchDeployment = {
  network: NETWORK,
  factory: contract(1),
  webauthnVerifier: contract(2),
  statelessRegistry: contract(3),
  docCompiler: contract(4),
  interpreter: contract(5),
  spendingLimit: contract(6),
  recoveryController: contract(7),
  zkPool: contract(8),
  zkAdapter: contract(9),
  circuitId: 'c1'.repeat(32),
  treeDepth: 32,
  accountWasmHash: 'aa'.repeat(32),
};

function baseDoc(): PolicyDoc {
  return buildPolicyDoc({
    network: NETWORK,
    signers: [{ id: 'admin', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: KEY }],
    permissions: [{ name: 'admin', on: 'self-admin', by: ['admin'] }],
  });
}

const zk = { enrollmentId: new Uint8Array(32).fill(5), commitment: new Uint8Array(32).fill(1) };
const guardians = [contract(20), contract(21), contract(22)];

function withChoice(
  profile: RecoveryProfile,
  mode: RecoveryMode,
  quorum = 2,
  more: Partial<perch.RecoveryChoice> = {},
): PolicyDoc {
  const doc = baseDoc();
  return perch.withRecovery(
    doc,
    perch.recoverySpec(deployment, {
      profile,
      mode,
      guardians: mode === 'zk-only' ? undefined : guardians,
      quorum: mode === 'zk-only' ? undefined : quorum,
      zk: mode === 'guardian-only' ? undefined : zk,
      replaceable: adminSignerIds(doc),
      ...more,
    }),
  );
}

describe('summarizeRecovery', () => {
  it('reads nothing from a document without recovery', () => {
    expect(summarizeRecovery(baseDoc())).toBeUndefined();
    expect(summarizeRecovery(undefined)).toBeUndefined();
  });

  for (const profile of ['loss', 'protected'] as const) {
    for (const mode of ['guardian-only', 'zk-only', 'combined'] as const) {
      it(`reads ${profile} / ${mode} and its condition`, () => {
        const s = summarizeRecovery(withChoice(profile, mode))!;
        expect(s.profile).toBe(profile);
        expect(s.mode).toBe(mode);
        expect(s.controller).toBe(deployment.recoveryController);
        expect(s.replaceable).toEqual(['admin']);
        expect(s.guardians).toEqual(mode === 'zk-only' ? [] : guardians);
        expect(Boolean(s.zk)).toBe(mode !== 'guardian-only');
        expect(condition(s)).toEqual({
          guardians: mode === 'zk-only' ? 0 : 2,
          zk: mode !== 'guardian-only',
        });
      });
    }
  }
});

describe('changeNeeds', () => {
  it('asks nothing of a loss account or an unchanged recovery member', () => {
    const loss = withChoice('loss', 'guardian-only');
    expect(changeNeeds(loss, withChoice('loss', 'combined'))).toBeUndefined();
    const prot = withChoice('protected', 'guardian-only');
    expect(changeNeeds(prot, withChoice('protected', 'guardian-only'))).toBeUndefined();
    expect(changeNeeds(undefined, prot)).toBeUndefined();
  });

  it('asks the enrolled condition for a protected reconfiguration, and for removal', () => {
    const prot = withChoice('protected', 'combined');
    const next = withChoice('protected', 'combined', 3);
    const set = changeNeeds(prot, next)!;
    expect(set.change.kind).toBe('reconfigure-set');
    expect(set.condition).toEqual({ guardians: 2, zk: true });
    if (set.change.kind === 'reconfigure-set') {
      expect(hex(set.change.configHash)).toBe(hex(perch.configHash(next)!));
    }
    // Switching to loss is judged by the condition enrolled now.
    expect(changeNeeds(prot, withChoice('loss', 'combined'))?.condition).toEqual({ guardians: 2, zk: true });
    expect(changeNeeds(prot, baseDoc())?.change).toEqual({ kind: 'reconfigure-remove' });
  });
});

describe('guardian requests', () => {
  const account = contract(30);

  it('round-trips an attempt request with its replacements', () => {
    const set: perch.ReplacementSet = {
      signers: [{ signerId: 'admin', credential: { kind: 'external', verifier: contract(2), key: new Uint8Array(65).fill(4) } }],
      zkEnrollment: { id: new Uint8Array(32).fill(6), commitment: new Uint8Array(32).fill(2) },
    };
    const request = {
      kind: 'attempt' as const,
      account,
      attemptId: '3',
      domain: 'initiate' as const,
      replacements: replacementsToWire(set),
    };
    const decoded = decodeGuardianRequest('#' + encodeGuardianRequest(request));
    expect(decoded).toEqual(request);
    // The guardian page recomputes the hash the attempt bound.
    if (decoded.kind === 'attempt' && decoded.replacements) {
      expect(hex(perch.replacementSetHash(replacementsFromWire(decoded.replacements)))).toBe(
        hex(perch.replacementSetHash(set)),
      );
    }
  });

  it('flags replacement credentials checked by another verifier', () => {
    const wire = replacementsToWire({
      signers: [
        { signerId: 'admin', credential: { kind: 'external', verifier: deployment.webauthnVerifier, key: new Uint8Array(65).fill(4) } },
        { signerId: 'device', credential: { kind: 'external', verifier: contract(40), key: new Uint8Array(65).fill(4) } },
      ],
    });
    expect(foreignVerifiers(wire, deployment.webauthnVerifier)).toEqual([contract(40)]);
    expect(foreignVerifiers({ signers: [wire.signers[0]!] }, deployment.webauthnVerifier)).toEqual([]);
  });

  it('refuses an attempt link without, or with another, replacement set', () => {
    const set: perch.ReplacementSet = {
      signers: [{ signerId: 'admin', credential: { kind: 'external', verifier: deployment.webauthnVerifier, key: new Uint8Array(65).fill(4) } }],
    };
    const bound = perch.replacementSetHash(set);
    const verifier = deployment.webauthnVerifier;
    expect(attemptLinkProblem(replacementsToWire(set), bound, verifier)).toBeUndefined();
    expect(attemptLinkProblem(undefined, bound, verifier)).toMatch(/does not say/);
    const other = { signers: [{ ...set.signers[0]!, credential: { kind: 'external' as const, verifier, key: new Uint8Array(65).fill(5) } }] };
    expect(attemptLinkProblem(replacementsToWire(other), bound, verifier)).toMatch(/does not match/);
    // The same key behind a verifier that accepts anything: the hash matches
    // what the attacker bound, so only the verifier check catches it.
    const forged = { signers: [{ ...set.signers[0]!, credential: { kind: 'external' as const, verifier: contract(40), key: new Uint8Array(65).fill(4) } }] };
    expect(attemptLinkProblem(replacementsToWire(forged), perch.replacementSetHash(forged), verifier)).toMatch(/unknown contract/);
  });

  it('round-trips change requests and their SDK subjects', () => {
    const subjects: perch.ChangeSubject[] = [
      { kind: 'reconfigure-set', configHash: new Uint8Array(32).fill(9) },
      { kind: 'reconfigure-remove' },
      { kind: 'upgrade', requestId: 7n, wasmHash: new Uint8Array(32).fill(3) },
    ];
    for (const subject of subjects) {
      const request = { kind: 'change' as const, account, change: changeToRequest(subject), validUntil: 1234 };
      const decoded = decodeGuardianRequest(encodeGuardianRequest(request));
      expect(decoded.kind === 'change' && changeSubject(decoded.change)).toEqual(subject);
    }
  });

  it('refuses malformed requests', () => {
    const bad = [
      { kind: 'attempt', account: 'GABC', attemptId: '1', domain: 'initiate' },
      { kind: 'attempt', account, attemptId: '-1', domain: 'initiate' },
      { kind: 'attempt', account, attemptId: '1', domain: 'steal' },
      { kind: 'change', account, change: { kind: 'reconfigure-set', configHash: 'zz' }, validUntil: 5 },
      { kind: 'change', account, change: { kind: 'reconfigure-remove' }, validUntil: 0 },
      { kind: 'other', account },
    ];
    for (const r of bad) {
      expect(() => decodeGuardianRequest(encodeGuardianRequest(r as never))).toThrow();
    }
  });
});

describe('passkey check codes', () => {
  const verifier = deployment.webauthnVerifier;
  const wire = (key: string): WireReplacements => ({ signers: [{ signerId: 'admin', verifier, key }] });
  const bound = (w: WireReplacements) => perch.replacementSetHash(perch.sortReplacements(replacementsFromWire(w)));

  it('is SHA-256 of the whole key, 100 bits in grouped Crockford base 32', () => {
    // Computed independently: sha256("nido/passkey-check/v1" || key), top
    // 100 bits, Crockford alphabet.
    expect(passkeyCheckCode(KEY)).toBe('MWE1-P1MQ-BV7F-DYZE-K9H2');
    expect(passkeyCheckCode(KEY)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
  });

  it('changes with every byte of the key, the last ones included', () => {
    const codes = new Set<string>([passkeyCheckCode(KEY)]);
    for (const i of [0, 1, 32, 59, 64]) {
      const bytes = KEY.match(/../g)!;
      bytes[i] = bytes[i] === '00' ? '01' : '00';
      codes.add(passkeyCheckCode(bytes.join('')));
    }
    expect(codes.size).toBe(6);
  });

  it('does not show a friend’s code for another key that copies the friend’s trailing bytes', () => {
    // The friend's genuine new passkey, and another point followed by a
    // "credential id" that copies the friend's last six bytes.
    const friend = '04' + '11'.repeat(58) + 'deadbeef1234';
    const other = '04' + '22'.repeat(64) + 'deadbeef1234';
    expect(other.slice(-12)).toBe(friend.slice(-12));
    expect(passkeyCheckCode(other)).not.toBe(passkeyCheckCode(friend));
    // The link check refuses the suffixed key even though the attempt bound
    // exactly those bytes.
    expect(attemptLinkProblem(wire(other), bound(wire(other)), verifier)).toMatch(/not in the form/);
    // A suffix padded out to any length is refused the same way.
    const padded = '04' + 'b2'.repeat(64) + '00'.repeat(10) + 'deadbeefcafe';
    expect(attemptLinkProblem(wire(padded), bound(wire(padded)), verifier)).toMatch(/not in the form/);
    expect(attemptLinkProblem(wire(friend), bound(wire(friend)), verifier)).toBeUndefined();
  });

  it('refuses a key that is not an uncompressed point', () => {
    const compressed = '02' + 'ab'.repeat(32);
    expect(attemptLinkProblem(wire(compressed), bound(wire(compressed)), verifier)).toMatch(/not in the form/);
    const wrongPrefix = '05' + 'ab'.repeat(64);
    expect(attemptLinkProblem(wire(wrongPrefix), bound(wire(wrongPrefix)), verifier)).toMatch(/not in the form/);
  });
});

describe('own recovery attempts', () => {
  const account = contract(30);
  const verifier = deployment.webauthnVerifier;
  const set = (fill: number): WireReplacements => ({
    signers: [{ signerId: 'admin', verifier, key: '04' + hex(new Uint8Array(64).fill(fill)) }],
  });
  const mine: OwnRecovery = { action: 'lost-key', replacements: set(0x11) };
  const theirs: OwnRecovery = { action: 'lost-key', replacements: set(0x22) };
  const onChain = (o: OwnRecovery, action = o.action === 'lost-key' ? 1 : 2) =>
    ({
      action,
      replacements_hash: Buffer.from(perch.replacementSetHash(perch.sortReplacements(replacementsFromWire(o.replacements)))),
    }) as perch.Attempt;
  const reader = (attempts: perch.Attempt[]): AttemptReader => ({
    nextAttemptId: async () => BigInt(attempts.length),
    attempt: async (_account, id) => attempts[Number(id)],
  });

  it('accepts only an attempt declaring exactly our replacements for our action', () => {
    expect(ownAttemptProblem(onChain(mine), mine)).toBeUndefined();
    expect(ownAttemptProblem(onChain(theirs), mine)).toMatch(/different new passkey/);
    expect(ownAttemptProblem(onChain(mine, 2), mine)).toMatch(/different kind/);
    const withKit: OwnRecovery = { ...mine, replacements: { ...mine.replacements, zk: { id: 'aa'.repeat(32), commitment: 'bb'.repeat(32) } } };
    expect(ownAttemptProblem(onChain(withKit), mine)).toMatch(/different new passkey/);
  });

  it('finds ours when another attempt was opened first, or after', async () => {
    expect(await findOwnAttempt(reader([onChain(theirs), onChain(mine)]), account, mine)).toMatchObject({ attemptId: 1n });
    expect(await findOwnAttempt(reader([onChain(mine), onChain(theirs)]), account, mine)).toMatchObject({ attemptId: 0n });
    expect(await findOwnAttempt(reader([onChain(theirs)]), account, mine)).toBeUndefined();
    expect(await findOwnAttempt(reader([]), account, mine)).toBeUndefined();
  });
});

describe('recoveryChangeRows', () => {
  /** Every leaf path of a recovery member. */
  const leaves = (m: unknown, path = ''): string[] =>
    Array.isArray(m) || typeof m !== 'object' || m === null
      ? [path]
      : Object.entries(m).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));

  it('shows every setting the config hash binds, with the changes flagged', () => {
    const current = withChoice('protected', 'combined');
    const proposed = withChoice('protected', 'combined', 2, {
      guardians: [guardians[0]!, guardians[1]!, contract(23)],
      zk: { enrollmentId: new Uint8Array(32).fill(7), commitment: new Uint8Array(32).fill(8) },
      baselineDocHash: 'cd'.repeat(32),
      delayLedgers: 10,
      expiryLedgers: 20,
      maxCancels: 9,
    });
    const rows = recoveryChangeRows(current.recovery, proposed.recovery);
    const paths = rows.map((r) => r.path);
    for (const leaf of leaves(proposed.recovery)) expect(paths).toContain(leaf);
    expect(rows.filter((r) => r.changed).map((r) => r.path).sort()).toEqual(
      [
        'baseline.doc-hash',
        'delay-ledgers',
        'expiry-ledgers',
        'max-cancels',
        'mode.commitment',
        'mode.enrollment-id',
        'mode.guardians',
      ].sort(),
    );
    const g = rows.find((r) => r.path === 'mode.guardians')!;
    expect(g.current).toEqual(guardians);
    expect(g.proposed).toEqual([guardians[0], guardians[1], contract(23)]);
    expect(rows.find((r) => r.path === 'baseline.doc-hash')).toMatchObject({ current: [], proposed: ['cd'.repeat(32)] });
    expect(rows.find((r) => r.path === 'mode.quorum')).toMatchObject({ changed: false, proposed: ['2'] });
  });

  it('flags a mode switch and the settings it adds or drops', () => {
    const rows = recoveryChangeRows(withChoice('protected', 'guardian-only').recovery, withChoice('protected', 'zk-only').recovery);
    const changed = rows.filter((r) => r.changed).map((r) => r.path);
    expect(changed).toEqual(
      expect.arrayContaining(['mode.type', 'mode.guardians', 'mode.quorum', 'mode.pool', 'mode.adapter', 'mode.enrollment-id', 'mode.commitment']),
    );
    expect(rows.find((r) => r.path === 'mode.guardians')).toMatchObject({ current: guardians, proposed: [] });
  });

  it('lists a setting it has no label for under its raw path', () => {
    const rows = recoveryChangeRows({ profile: 'loss' }, { profile: 'loss', 'new-field': { x: 1 } });
    expect(rows.at(-1)).toMatchObject({ path: 'new-field.x', label: 'new-field.x', proposed: ['1'], changed: true });
  });
});

describe('recovery kits', () => {
  it('accepts a well-formed kit and refuses anything else', () => {
    const kit = { version: 1, network: NETWORK, account: contract(30), enrollmentId: 'ab'.repeat(32), secret: '01'.repeat(32) };
    expect(parseRecoveryKit(JSON.stringify(kit))).toEqual(kit);
    expect(() => parseRecoveryKit(JSON.stringify({ ...kit, secret: 'short' }))).toThrow();
    expect(() => parseRecoveryKit(JSON.stringify({ ...kit, version: 2 }))).toThrow();
  });
});
