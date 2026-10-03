import { describe, expect, it } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import {
  adminSignerIds,
  changeNeeds,
  changeSubject,
  changeToRequest,
  condition,
  decodeGuardianRequest,
  encodeGuardianRequest,
  hex,
  parseRecoveryKit,
  replacementsFromWire,
  replacementsToWire,
  summarizeRecovery,
  type RecoveryMode,
  type RecoveryProfile,
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

function withChoice(profile: RecoveryProfile, mode: RecoveryMode, quorum = 2): PolicyDoc {
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

describe('recovery kits', () => {
  it('accepts a well-formed kit and refuses anything else', () => {
    const kit = { version: 1, network: NETWORK, account: contract(30), enrollmentId: 'ab'.repeat(32), secret: '01'.repeat(32) };
    expect(parseRecoveryKit(JSON.stringify(kit))).toEqual(kit);
    expect(() => parseRecoveryKit(JSON.stringify({ ...kit, secret: 'short' }))).toThrow();
    expect(() => parseRecoveryKit(JSON.stringify({ ...kit, version: 2 }))).toThrow();
  });
});
