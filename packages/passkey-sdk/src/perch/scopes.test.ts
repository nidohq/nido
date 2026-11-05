import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Networks, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { canonicalJson, credentialFingerprint, docHash, type AccountConfiguration, type PolicyDoc } from '@stellar-registry/perch';
import { docCapProblem } from '../policyDoc/caps.js';
import {
  AppScopesTaken,
  appScopeCandidates,
  appSignerId,
  buildApplyScopeTx,
  buildGcScopeTx,
  buildRemoveScopeTx,
  canonicalOrigin,
  credentialUsable,
  findAppRule,
  findAppScope,
  readScopes,
  scopeOrigin,
  scopedDocProblem,
  upsertAppRules,
  withoutAppKey,
  type AppKey,
  type AppRuleTemplate,
  type ScopeReader,
} from './scopes.js';

const VECTORS = JSON.parse(
  readFileSync(fileURLToPath(new URL('./testdata/app-scope-ids.json', import.meta.url)), 'utf8'),
) as {
  vectors: { origin: string; candidates: number[] }[];
  signer_ids: ({ origin: string; id: string } & ({ key: string } | { address: string }))[];
};

const NET = Networks.TESTNET;
const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ACCOUNT = contract(1);
const VERIFIER = contract(2);
const GAME = contract(3);
const XLM = contract(4);
const CONTROLLER = contract(5);
const GAME_ORIGIN = 'https://game.example';
const passkey = (n: number): AppKey => ({ verifier: VERIFIER, key: '04' + n.toString(16).padStart(2, '0').repeat(64) });
const LIMITS = { maxSigners: 8, maxRules: 10, maxCanonicalBytes: 8192, maxRuleNameBytes: 20 };

const guess: AppRuleTemplate = { name: 'guess', scope: { type: 'contract', address: GAME }, functions: ['guess'] };
const stake: AppRuleTemplate = {
  name: 'guess-xlm',
  scope: { type: 'contract', address: XLM },
  functions: ['transfer'],
  cap: { limit: '20000000', 'period-ledgers': 17280 },
};

/** A reader over in-memory scopes: `docs[id]` is the applied JSON. */
function reader(
  docs: Record<number, PolicyDoc>,
  opts: { generation?: bigint; gens?: Record<number, bigint>; named?: Map<string, bigint>; config?: Partial<AccountConfiguration> } = {},
): ScopeReader & { reads: number[] } {
  const ids = Object.keys(docs).map(Number);
  const reads: number[] = [];
  return {
    reads,
    scopeGeneration: async () => opts.generation ?? 0n,
    scopeCount: async () => ids.length,
    scopes: async (start, count) => ids.slice(start, start + count),
    scope: async (id) => {
      reads.push(id);
      const d = docs[id];
      if (d === undefined) return null;
      return {
        gen: opts.gens?.[id] ?? opts.generation ?? 0n,
        docHash: docHash(d),
        rules: d.rules.map((r, i) => ({ id: 100 * id + i, name: r.name })),
      };
    },
    scopeDoc: async (id) => (docs[id] === undefined ? null : canonicalJson(docs[id]!)),
    credentialGeneration: async (fp) => opts.named?.get(Buffer.from(fp).toString('hex')) ?? null,
    isRevoked: async () => false,
    configuration: async () =>
      ({
        revision: 0n,
        docHash: null,
        rules: [],
        recoveryController: null,
        recoveryRule: null,
        gate: null,
        recoveryGeneration: 0n,
        infra: { docCompiler: contract(9), interpreter: contract(10), spendingLimit: contract(11) },
        ...opts.config,
      }) as AccountConfiguration,
  };
}

describe('scope ids (testdata/app-scope-ids.json)', () => {
  it('derives every origin’s candidates as the vectors record', () => {
    for (const v of VECTORS.vectors) expect(appScopeCandidates(v.origin)).toEqual(v.candidates);
  });

  it('names an app key <origin>#<first 8 hex of sha256(key bytes)>', () => {
    for (const v of VECTORS.signer_ids) {
      const key: AppKey = 'key' in v ? { verifier: VERIFIER, key: v.key } : { address: v.address };
      expect(appSignerId(v.origin, key)).toBe(v.id);
    }
  });

  it('derives from the canonical origin: case, default port, path and IDN fold away', () => {
    const ids = appScopeCandidates(GAME_ORIGIN);
    expect(appScopeCandidates('HTTPS://Game.Example:443/play?x=1')).toEqual(ids);
    expect(canonicalOrigin('https://bücher.example/')).toBe('https://xn--bcher-kva.example');
    expect(appScopeCandidates('https://bücher.example')).toEqual(
      VECTORS.vectors.find((v) => v.origin === 'https://xn--bcher-kva.example')!.candidates,
    );
    expect(appScopeCandidates('https://game.example:8443')).not.toEqual(ids);
    expect(canonicalOrigin('http://localhost:4321/x')).toBe('http://localhost:4321');
  });

  it('refuses an origin that is not https (or http on localhost)', () => {
    for (const bad of ['http://game.example', 'javascript:alert(1)', 'data:text/html,x', 'game.example', '']) {
      expect(() => canonicalOrigin(bad)).toThrow();
    }
  });
});

describe('upsertAppRules', () => {
  const k1 = passkey(0xaa);
  const k2 = passkey(0xbb);

  it('builds a new scope: one signer named by the origin, one rule per grant', () => {
    const doc = upsertAppRules(null, GAME_ORIGIN, k1, [guess, stake], NET);
    expect(doc.signers).toEqual([{ id: appSignerId(GAME_ORIGIN, k1), ...k1 }]);
    expect(doc.rules.map((r) => [r.name, r.principals])).toEqual([
      ['guess', { type: 'all', signers: [appSignerId(GAME_ORIGIN, k1)] }],
      ['guess-xlm', { type: 'all', signers: [appSignerId(GAME_ORIGIN, k1)] }],
    ]);
    expect(scopeOrigin(doc)).toBe(GAME_ORIGIN);
  });

  it('a second key joins: a named rule takes the new definition and either key signs it', () => {
    const first = upsertAppRules(null, GAME_ORIGIN, k1, [guess, stake], NET);
    const raised = { ...stake, cap: { limit: '50000000', 'period-ledgers': 17280 } };
    const doc = upsertAppRules(first, GAME_ORIGIN, k2, [raised], NET);
    const [id1, id2] = [appSignerId(GAME_ORIGIN, k1), appSignerId(GAME_ORIGIN, k2)];
    expect(doc.signers.map((s) => s.id)).toEqual([id1, id2]);
    expect(doc.rules.find((r) => r.name === 'guess-xlm')).toEqual({
      ...raised,
      principals: { type: 'threshold', m: 1, signers: [id1, id2] },
    });
    // A rule the second request does not name keeps its key.
    expect(doc.rules.find((r) => r.name === 'guess')!.principals).toEqual({ type: 'all', signers: [id1] });
  });

  it('the same key again changes the definition and no signer', () => {
    const first = upsertAppRules(null, GAME_ORIGIN, k1, [guess], NET);
    const doc = upsertAppRules(first, GAME_ORIGIN, k1, [{ ...guess, 'not-after-ledger': 900 }], NET);
    expect(doc.signers).toEqual(first.signers);
    expect(doc.rules).toEqual([{ ...guess, 'not-after-ledger': 900, principals: first.rules[0]!.principals }]);
  });

  it('a ninth key is over the document limit', () => {
    let doc: PolicyDoc | null = null;
    for (let n = 1; n <= 8; n++) doc = upsertAppRules(doc, GAME_ORIGIN, passkey(n), [guess], NET);
    expect(docCapProblem(doc!, LIMITS)).toBeUndefined();
    const ninth = upsertAppRules(doc, GAME_ORIGIN, passkey(9), [guess], NET);
    expect(docCapProblem(ninth, LIMITS)).toMatch(/9 keys; an account holds at most 8/);
  });

  it('refuses two grants of one name', () => {
    expect(() => upsertAppRules(null, GAME_ORIGIN, k1, [guess, guess], NET)).toThrow(/two grants name the rule "guess"/);
  });
});

describe('withoutAppKey', () => {
  const [k1, k2] = [passkey(0xaa), passkey(0xbb)];
  const joined = upsertAppRules(upsertAppRules(null, GAME_ORIGIN, k1, [guess, stake], NET), GAME_ORIGIN, k2, [stake], NET);

  it('drops a key from every rule, a rule it alone signed, and its declaration', () => {
    const doc = withoutAppKey(joined, appSignerId(GAME_ORIGIN, k1))!;
    expect(doc.signers.map((s) => s.id)).toEqual([appSignerId(GAME_ORIGIN, k2)]);
    expect(doc.rules).toEqual([{ ...stake, principals: { type: 'all', signers: [appSignerId(GAME_ORIGIN, k2)] } }]);
  });

  it('is null once no rule is left', () => {
    const only = upsertAppRules(null, GAME_ORIGIN, k1, [guess], NET);
    expect(withoutAppKey(only, appSignerId(GAME_ORIGIN, k1))).toBeNull();
  });
});

describe('scopedDocProblem', () => {
  const k1 = passkey(0xaa);
  const ctx = { account: ACCOUNT, excluded: [CONTROLLER], adminKeys: [passkey(0x11)], origin: GAME_ORIGIN };
  const ok = upsertAppRules(null, GAME_ORIGIN, k1, [guess], NET);

  it('accepts an app’s grants', () => {
    expect(scopedDocProblem(ok, ctx)).toBeUndefined();
  });

  it('refuses what the account’s check_scoped refuses', () => {
    const on = (address: string) => upsertAppRules(null, GAME_ORIGIN, k1, [{ ...guess, scope: { type: 'contract', address } }], NET);
    expect(scopedDocProblem(on(ACCOUNT), ctx)).toMatch(/your own account/);
    expect(scopedDocProblem(on(CONTROLLER), ctx)).toMatch(/recovery/);
    expect(scopedDocProblem({ ...ok, rules: [{ ...ok.rules[0]!, scope: { type: 'self-admin' } }] }, ctx)).toMatch(/account itself/);
  });

  it('refuses an admin key and another origin’s signer id', () => {
    const admin = upsertAppRules(null, GAME_ORIGIN, passkey(0x11), [guess], NET);
    expect(scopedDocProblem(admin, ctx)).toMatch(/admin keys/);
    const other = upsertAppRules(null, 'https://other.example', k1, [guess], NET);
    expect(scopedDocProblem(other, ctx)).toMatch(/not one of https:\/\/game\.example's keys/);
  });
});

describe('findAppScope', () => {
  const [c0, c1, c2, c3] = appScopeCandidates(GAME_ORIGIN) as [number, number, number, number];
  const mine = upsertAppRules(null, GAME_ORIGIN, passkey(0xaa), [guess], NET);
  const theirs = upsertAppRules(null, 'https://other.example', passkey(0xbb), [guess], NET);

  it('creates at the first candidate when nothing holds one', async () => {
    expect(await findAppScope(reader({}), GAME_ORIGIN)).toEqual({ id: c0, view: null });
  });

  it('skips a candidate another origin holds, and never takes it over', async () => {
    expect(await findAppScope(reader({ [c0]: theirs }), GAME_ORIGIN)).toEqual({ id: c1, view: null });
    const found = await findAppScope(reader({ [c0]: theirs, [c1]: mine }), GAME_ORIGIN);
    expect(found.id).toBe(c1);
    expect(found.view?.origin).toBe(GAME_ORIGIN);
  });

  it('finds its own scope past a free candidate that a removal left', async () => {
    const found = await findAppScope(reader({ [c1]: mine }), GAME_ORIGIN);
    expect(found.id).toBe(c1);
  });

  it('a wiped scope is still the origin’s, to apply over', async () => {
    const found = await findAppScope(reader({ [c0]: mine }, { generation: 1n, gens: { [c0]: 0n } }), GAME_ORIGIN);
    expect(found.id).toBe(c0);
    expect(found.view?.live).toBe(false);
  });

  it('refuses when every candidate holds another origin', async () => {
    const r = reader({ [c0]: theirs, [c1]: theirs, [c2]: theirs, [c3]: theirs });
    await expect(findAppScope(r, GAME_ORIGIN)).rejects.toBeInstanceOf(AppScopesTaken);
  });
});

describe('readScopes', () => {
  it('lists every scope with its origin and liveness', async () => {
    const mine = upsertAppRules(null, GAME_ORIGIN, passkey(0xaa), [guess], NET);
    const { generation, scopes } = await readScopes(reader({ 7: mine, 9: mine }, { generation: 2n, gens: { 7: 2n, 9: 1n } }));
    expect(generation).toBe(2n);
    expect(scopes.map((s) => [s.id, s.live, s.origin, s.rules])).toEqual([
      [7, true, GAME_ORIGIN, [{ id: 700, name: 'guess' }]],
      [9, false, GAME_ORIGIN, [{ id: 900, name: 'guess' }]],
    ]);
  });
});

describe('credentialUsable', () => {
  const k = passkey(0xaa);
  const fp = Buffer.from(credentialFingerprint({ kind: 'external', verifier: k.verifier, key: Buffer.from((k as { key: string }).key, 'hex') })).toString('hex');

  it('a key a wiped scope named is not usable; one named this generation is', async () => {
    expect(await credentialUsable(reader({}, { generation: 1n, named: new Map([[fp, 0n]]) }), k)).toBe(false);
    expect(await credentialUsable(reader({}, { generation: 1n, named: new Map([[fp, 1n]]) }), k)).toBe(true);
    expect(await credentialUsable(reader({}, { generation: 1n }), k)).toBe(true);
  });
});

describe('scope transactions', () => {
  const args = { account: ACCOUNT, networkPassphrase: NET };
  const call = (op: xdr.Operation) => {
    const fn = op.body().invokeHostFunctionOp().hostFunction().invokeContract();
    return {
      contract: StrKey.encodeContract(fn.contractAddress().contractId() as unknown as Buffer),
      fn: fn.functionName().toString(),
      args: fn.args().map((a) => scValToNative(a)),
    };
  };

  it('apply_scope(scope, canonical bytes)', () => {
    const doc = upsertAppRules(null, GAME_ORIGIN, passkey(0xaa), [guess], NET);
    const tx = buildApplyScopeTx(4_000_000_000, doc, args);
    const c = call(tx.operations[0]!);
    expect(c.contract).toBe(ACCOUNT);
    expect(c.fn).toBe('apply_scope');
    expect(c.args[0]).toBe(4_000_000_000);
    expect(Buffer.from(c.args[1] as Uint8Array).toString('utf8')).toBe(canonicalJson(doc));
    expect(tx.docHash).toBe(docHash(doc));
  });

  it('refuses before building what the account or its compiler would refuse', () => {
    const doc = upsertAppRules(null, GAME_ORIGIN, passkey(0xaa), [{ ...guess, scope: { type: 'contract', address: CONTROLLER } }], NET);
    const scoped = { account: ACCOUNT, excluded: [CONTROLLER], adminKeys: [], origin: GAME_ORIGIN };
    expect(() => buildApplyScopeTx(1, doc, { ...args, scoped })).toThrow(/recovery/);
    expect(() => buildApplyScopeTx(1, doc, { ...args, networkPassphrase: Networks.PUBLIC })).toThrow(/bound to/);
    expect(() => buildApplyScopeTx(-1, doc, args)).toThrow(/not a scope id/);
  });

  it('remove_scope(scope) and gc_scope(scope)', () => {
    expect(call(buildRemoveScopeTx(7, args).operations[0]!)).toEqual({ contract: ACCOUNT, fn: 'remove_scope', args: [7] });
    expect(call(buildGcScopeTx(7, args).operations[0]!)).toEqual({ contract: ACCOUNT, fn: 'gc_scope', args: [7] });
  });
});

describe('findAppRule', () => {
  const k = passkey(0xaa);
  const [c0] = appScopeCandidates(GAME_ORIGIN) as [number];
  const doc = upsertAppRules(null, GAME_ORIGIN, k, [guess, stake], NET);

  it('finds the app’s rule on a contract in its origin’s live scope', async () => {
    expect(await findAppRule(reader({ [c0]: doc }), { origin: GAME_ORIGIN, key: k, contract: XLM })).toEqual({
      scope: c0,
      ruleId: 100 * c0 + 1,
      ruleName: 'guess-xlm',
    });
  });

  it('falls back to a rule still in the admin document, and to nothing after a recovery', async () => {
    const config = {
      rules: [
        {
          id: 3,
          recovery: false,
          name: 'guess',
          contract: GAME,
          validUntil: null,
          signers: [{ kind: 'external' as const, verifier: VERIFIER, key: Buffer.from((k as { key: string }).key, 'hex') }],
          policies: [],
        },
      ],
    };
    expect(await findAppRule(reader({}, { config }), { origin: GAME_ORIGIN, key: k, contract: GAME })).toEqual({
      scope: null,
      ruleId: 3,
      ruleName: 'guess',
    });
    const wiped = reader({ [c0]: doc }, { generation: 1n, gens: { [c0]: 0n } });
    expect(await findAppRule(wiped, { origin: GAME_ORIGIN, key: k, contract: GAME })).toBeNull();
  });
});
