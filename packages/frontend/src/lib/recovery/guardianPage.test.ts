// What the guardian page shows before it offers Approve: a reconfiguration
// setting by setting, and a recovery's new passkey as a check code. And
// where the approval goes: the controller the account adopted, through the
// guardian's rule scoped to it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, parsePolicyDocJson, perch, type PolicyDoc } from '@nidohq/passkey-sdk';

const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const NETWORK = 'Test SDF Network ; September 2015';
const ACCOUNT = contract(30);
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

const chain = vi.hoisted(() => ({
  doc: undefined as unknown,
  statement: undefined as unknown,
  changeStatement: undefined as unknown,
  /** The controller the requesting account adopted. */
  controller: undefined as unknown as string,
  guardians: [] as string[],
  /** The page's own Nido, from its hostname (none: a `G…` guardian). */
  host: null as string | null,
  guardianRules: [] as { name: string; contract: string; recovery: boolean }[],
  guardianDoc: undefined as unknown,
}));

vi.mock('./chain.js', () => ({
  readRecoveryState: vi.fn(async () => ({
    doc: chain.doc,
    summary: { guardians: chain.guardians },
    wiring: { controller: chain.controller, adopted: true },
  })),
  recoveryClient: () => ({
    statement: vi.fn(async () => chain.statement),
    changeStatement: vi.fn(async () => chain.changeStatement),
    submitGuardian: vi.fn(async () => ({ operations: [{ __op: 'submit_guardian' }] })),
    approveChange: vi.fn(async () => ({ operations: [{ __op: 'approve_change' }] })),
  }),
  applyDoc: vi.fn(),
  currentOrFirstDoc: vi.fn(async () => ({ doc: chain.guardianDoc, revision: 3n })),
  submitAsGuardian: vi.fn(),
}));
vi.mock('./deployment.js', () => ({
  perchDeployment: () => deployment,
  requireDeployment: () => deployment,
}));
vi.mock('../walletConnect.js', () => ({ connect: vi.fn(), initWalletKit: vi.fn() }));
vi.mock('../policyChainFetch.js', () => ({
  readAccountConfiguration: vi.fn(async () => ({ rules: chain.guardianRules })),
}));
vi.mock('../toast.js', () => ({ toast: vi.fn() }));
vi.mock('@nidohq/passkey-sdk', async (orig) => ({
  ...(await orig<typeof import('@nidohq/passkey-sdk')>()),
  contractIdFromHostname: () => chain.host,
}));

import { applyDoc, submitAsGuardian } from './chain.js';
import { connect as connectWallet } from '../walletConnect.js';
import { mountGuardian } from './guardianPage';
import {
  adminSignerIds,
  encodeGuardianRequest,
  hex,
  passkeyCheckCode,
  replacementsFromWire,
  type GuardianRequest,
  type WireReplacements,
} from './model';

const guardians = [contract(20), contract(21), contract(22)];

/** A statement as a controller's `statement`/`change_statement` reads it. */
function statementAt(controller: string, subject: perch.StatementSubject): perch.RecoveryStatement {
  return {
    networkId: new Uint8Array(32).fill(1),
    account: ACCOUNT,
    controller,
    configEpoch: 2n,
    configHash: new Uint8Array(32).fill(3),
    delayLedgers: 10,
    expiryLedgers: 100,
    validUntilLedger: 1_000,
    subject,
  };
}
const zk = { enrollmentId: new Uint8Array(32).fill(5), commitment: new Uint8Array(32).fill(1) };

function docWith(more: Partial<perch.RecoveryChoice> = {}): PolicyDoc {
  const doc = buildPolicyDoc({
    network: NETWORK,
    signers: [{ id: 'admin', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: KEY }],
    permissions: [{ name: 'admin', on: 'self-admin', by: ['admin'] }],
  });
  return perch.withRecovery(
    doc,
    perch.recoverySpec(deployment, {
      profile: 'protected',
      mode: 'combined',
      guardians,
      quorum: 2,
      zk,
      replaceable: adminSignerIds(doc),
      ...more,
    }),
  );
}

/** Mount the page for `request` and wait for its description card. */
async function open(request: GuardianRequest): Promise<HTMLElement> {
  window.location.hash = encodeGuardianRequest(request);
  const root = document.createElement('div');
  // A G-guardian page then waits for a wallet connection; the description
  // is all these tests read.
  void mountGuardian(root);
  await vi.waitFor(() => expect(root.querySelector('.card')).not.toBeNull());
  return root;
}

const approvable = (root: HTMLElement) => root.textContent!.includes('Your approval');

beforeEach(() => {
  vi.clearAllMocks();
  chain.controller = deployment.recoveryController;
  chain.guardians = [];
  chain.host = null;
  chain.guardianRules = [];
});

describe('guardian page: reconfiguration approval', () => {
  beforeEach(() => {
    chain.doc = docWith();
  });

  function reconfigure(proposed: PolicyDoc, configHash = hex(perch.configHash(proposed)!)): GuardianRequest {
    return {
      kind: 'change',
      account: ACCOUNT,
      change: { kind: 'reconfigure-set', configHash },
      validUntil: 1_000,
      recovery: proposed.recovery,
    };
  }

  it('shows every setting the config hash binds and highlights what changes', async () => {
    const swapped = contract(40);
    const proposed = docWith({
      guardians: [guardians[0]!, swapped, guardians[2]!],
      delayLedgers: 12,
      expiryLedgers: 34,
      maxCancels: 7,
      baselineDocHash: 'ef'.repeat(32),
      zk: { enrollmentId: new Uint8Array(32).fill(9), commitment: new Uint8Array(32).fill(3) },
    });
    const root = await open(reconfigure(proposed));

    const rows = [...root.querySelectorAll('tr[data-setting]')];
    const setting = (path: string) => rows.find((r) => r.getAttribute('data-setting') === path)!;
    const changed = rows.filter((r) => r.hasAttribute('data-changed')).map((r) => r.getAttribute('data-setting'));
    expect(changed.sort()).toEqual(
      ['baseline.doc-hash', 'delay-ledgers', 'expiry-ledgers', 'max-cancels', 'mode.commitment', 'mode.enrollment-id', 'mode.guardians'].sort(),
    );
    for (const path of ['profile', 'mode.type', 'mode.quorum', 'mode.pool', 'mode.adapter', 'mode.circuit-id', 'controller', 'replaceable']) {
      expect(setting(path)).toBeDefined();
    }
    // Full addresses and hashes, the replaced guardian marked removed and the
    // new one added.
    const g = setting('mode.guardians').textContent!;
    expect(g).toContain(`− ${guardians[1]}`);
    expect(g).toContain(`+ ${swapped}`);
    expect(setting('baseline.doc-hash').textContent).toContain('ef'.repeat(32));
    expect(setting('mode.commitment').textContent).toContain('03'.repeat(32));
    const delayNow = (chain.doc as PolicyDoc).recovery!['delay-ledgers'];
    expect(setting('delay-ledgers').textContent).toBe(`Wait after approval (ledgers) (changes)Now− ${delayNow}Proposed+ 12`);
    expect(approvable(root)).toBe(true);
  });

  it('marks no setting changed that stays the same', async () => {
    const root = await open(reconfigure(docWith({ quorum: 3 })));
    const changed = [...root.querySelectorAll('tr[data-changed]')].map((r) => r.getAttribute('data-setting'));
    expect(changed).toEqual(['mode.quorum']);
    expect(root.textContent).toMatch(/One setting changes/);
  });

  describe('each setting the config hash binds, changed alone', () => {
    const base = () =>
      docWith({ baselineDocHash: 'ba'.repeat(32), delayLedgers: 100, expiryLedgers: 200, maxCancels: 3 });
    /** `base()` with one member path set to `value`, as a link would carry it. */
    function changedAt(path: string, value: unknown): PolicyDoc {
      const recovery = structuredClone(base().recovery) as Record<string, unknown>;
      const keys = path.split('.');
      let at = recovery;
      for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
      at[keys.at(-1)!] = value;
      return parsePolicyDocJson(JSON.stringify({ ...base(), recovery }));
    }
    const replaced = [contract(60), contract(61), contract(62)];
    const cases: { path: string; value: unknown; trust?: boolean; foreign?: boolean }[] = [
      { path: 'profile', value: 'loss' },
      { path: 'mode.guardians', value: replaced, trust: true },
      { path: 'mode.quorum', value: 1, trust: true },
      { path: 'mode.adapter', value: contract(50), trust: true, foreign: true },
      { path: 'mode.pool', value: contract(51), trust: true, foreign: true },
      { path: 'mode.circuit-id', value: 'c2'.repeat(32), trust: true, foreign: true },
      { path: 'mode.enrollment-id', value: '0b'.repeat(32), trust: true },
      { path: 'mode.commitment', value: '0c'.repeat(32), trust: true },
      { path: 'controller', value: contract(52), trust: true, foreign: true },
      { path: 'baseline.doc-hash', value: 'bb'.repeat(32) },
      { path: 'replaceable', value: [] },
      { path: 'delay-ledgers', value: 101 },
      { path: 'expiry-ledgers', value: 201 },
      { path: 'max-cancels', value: 4 },
    ];

    beforeEach(() => {
      chain.doc = base();
    });

    /** What the guardian reads: the request and the approval it signs. */
    const seen = (root: HTMLElement) => root.textContent!;

    it.each(cases)('$path', async ({ path, value, trust, foreign }) => {
      const proposed = changedAt(path, value);
      const root = await open(reconfigure(proposed));

      const changed = [...root.querySelectorAll('tr[data-changed]')].map((r) => r.getAttribute('data-setting'));
      expect(changed).toEqual([path]);
      const shown = [value].flat().map(String);
      const row = root.querySelector(`tr[data-setting="${path}"]`)!.textContent!;
      for (const v of shown) expect(row).toContain(v);
      // The approval names the hash of exactly these settings.
      expect(root.querySelector('[data-approves]')!.getAttribute('data-approves')).toBe(hex(perch.configHash(proposed)!));

      const moved = [...root.querySelectorAll('[data-trust]')];
      expect(moved.map((t) => t.getAttribute('data-trust'))).toEqual(trust ? [path] : []);
      if (trust) {
        for (const v of shown) expect(moved[0]!.textContent).toContain(v);
        expect(moved[0]!.textContent!.includes('Not the one Nido sets up today')).toBe(!!foreign);
      }
      expect(approvable(root)).toBe(true);
    });

    it('never explains two of them the same way', async () => {
      const texts = new Set<string>();
      for (const { path, value } of cases) texts.add(seen(await open(reconfigure(changedAt(path, value)))));
      texts.add(seen(await open(reconfigure(base()))));
      expect(texts.size).toBe(cases.length + 1);
    });
  });

  it('shows a mode switch and the friends or kit it drops', async () => {
    const root = await open(reconfigure(docWith({ mode: 'guardian-only' })));
    const changed = [...root.querySelectorAll('tr[data-changed]')].map((r) => r.getAttribute('data-setting'));
    expect(changed).toContain('mode.type');
    const moved = [...root.querySelectorAll('[data-trust]')].map((t) => t.getAttribute('data-trust'));
    expect(moved).toEqual(expect.arrayContaining(['mode.adapter', 'mode.pool', 'mode.enrollment-id', 'mode.commitment']));
  });

  it('calls out a controller and every guardian replaced at once', async () => {
    const recovery = structuredClone(docWith().recovery) as Record<string, unknown> & { mode: Record<string, unknown> };
    recovery.controller = contract(70);
    recovery.mode.guardians = [contract(71), contract(72), contract(73)];
    const proposed = parsePolicyDocJson(JSON.stringify({ ...docWith(), recovery }));
    const root = await open(reconfigure(proposed));
    const alert = root.querySelector('[data-trust-changes]')!.textContent!;
    for (const g of guardians) expect(alert).toContain(g);
    for (const n of [70, 71, 72, 73]) expect(alert).toContain(contract(n));
    expect(alert).toContain(deployment.recoveryController);
    expect(root.textContent).not.toMatch(/2 of 3 friends/);
  });

  it('refuses settings that do not hash to the request', async () => {
    const root = await open(reconfigure(docWith({ delayLedgers: 12 }), 'ab'.repeat(32)));
    expect(root.textContent).toMatch(/do not match the request/);
    expect(root.querySelector('tr[data-setting]')).toBeNull();
    expect(approvable(root)).toBe(false);
  });

  it("hands a G… guardian's wallet only the approval of the change statement shown", async () => {
    const wallet = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 70));
    chain.guardians = [...guardians, wallet];
    vi.mocked(connectWallet).mockResolvedValue({ walletId: 'freighter', walletAddress: wallet });
    const proposed = docWith({ quorum: 3 });
    const configHash = perch.configHash(proposed)!;
    chain.changeStatement = statementAt(chain.controller, {
      action: 'reconfigure',
      change: { kind: 'set', newConfigHash: configHash },
    });
    const root = await open(reconfigure(proposed));
    [...root.querySelectorAll('button')].find((b) => /Connect your Stellar wallet/.test(b.textContent!))!.click();
    await vi.waitFor(() =>
      expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Approve')).toBe(true),
    );
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Approve')!.click();

    await vi.waitFor(() => expect(submitAsGuardian).toHaveBeenCalledTimes(1));
    expect(submitAsGuardian).toHaveBeenCalledWith(
      wallet,
      { __op: 'approve_change' },
      {
        controller: deployment.recoveryController,
        fn: 'approve_change',
        digest: perch.statementDigest(chain.changeStatement as perch.RecoveryStatement),
      },
      undefined,
    );
  });
});

describe('guardian page: recovery approval', () => {
  const wire = (key: string): WireReplacements => ({
    signers: [{ signerId: 'admin', verifier: deployment.webauthnVerifier, key }],
  });
  function attemptRequest(w: WireReplacements): GuardianRequest {
    chain.statement = {
      subject: {
        action: 'lost-key',
        replacementsHash: perch.replacementSetHash(perch.sortReplacements(replacementsFromWire(w))),
      },
    };
    return { kind: 'attempt', account: ACCOUNT, attemptId: '0', domain: 'initiate', replacements: w };
  }

  beforeEach(() => {
    chain.doc = docWith();
  });

  it('shows the new passkey as a check code of the whole key', async () => {
    const key = '04' + '11'.repeat(58) + 'deadbeef1234';
    const root = await open(attemptRequest(wire(key)));
    expect(root.textContent).toContain(passkeyCheckCode(key));
    expect(root.textContent).not.toContain(key.slice(-12));
    expect(approvable(root)).toBe(true);
  });

  it('refuses a key carrying trailing bytes after the point', async () => {
    const forged = '04' + '22'.repeat(64) + 'deadbeef1234';
    const root = await open(attemptRequest(wire(forged)));
    expect(root.textContent).toMatch(/not in the form Nido creates.*Do not approve/);
    expect(approvable(root)).toBe(false);
  });
});

describe('guardian page: an account enrolled at an earlier controller', () => {
  const EARLIER = contract(50);
  const GUARDIAN = guardians[0]!;
  const cancel: GuardianRequest = { kind: 'attempt', account: ACCOUNT, attemptId: '3', domain: 'cancel' };
  const ruleAt = (name: string, at: string) => ({
    name,
    scope: { type: 'contract', address: at },
    principals: { type: 'all', signers: ['admin'] },
  });

  beforeEach(() => {
    chain.doc = docWith();
    chain.controller = EARLIER;
    chain.guardians = guardians;
    chain.host = GUARDIAN;
    chain.statement = statementAt(EARLIER, {
      action: 'cancel',
      attemptId: 3n,
      attemptStatement: new Uint8Array(32).fill(4),
    });
    // The guardian's own document: its approval rule for the current
    // controller, none for the earlier one.
    chain.guardianDoc = parsePolicyDocJson(
      JSON.stringify({
        version: 1,
        network: NETWORK,
        signers: [{ id: 'admin', verifier: deployment.webauthnVerifier, key: KEY }],
        rules: [
          { name: 'admin', scope: { type: 'self-admin' }, principals: { type: 'all', signers: ['admin'] } },
          ruleAt('guardian', deployment.recoveryController),
        ],
      }),
    );
    chain.guardianRules = [{ name: 'guardian', contract: deployment.recoveryController, recovery: false }];
  });

  /** The approval of the cancel statement the page read, at the earlier
   *  controller. */
  const approval = (): perch.GuardianApproval => ({
    controller: EARLIER,
    fn: 'submit_guardian',
    digest: perch.statementDigest(chain.statement as perch.RecoveryStatement),
  });

  async function click(root: HTMLElement, label: RegExp): Promise<void> {
    await vi.waitFor(() =>
      expect([...root.querySelectorAll('button')].some((b) => label.test(b.textContent!))).toBe(true),
    );
    [...root.querySelectorAll('button')].find((b) => label.test(b.textContent!))!.click();
  }

  it('adds a rule scoped to that controller beside the current one, and approves through it', async () => {
    const root = await open(cancel);
    await vi.waitFor(() => expect(root.textContent).toContain(EARLIER));
    expect(root.textContent).toMatch(/an earlier one than Nido sets up today/);

    await click(root, /Allow my Nido/);
    await vi.waitFor(() => expect(applyDoc).toHaveBeenCalledTimes(1));
    const [who, doc, opts] = vi.mocked(applyDoc).mock.calls[0]!;
    expect(who).toBe(GUARDIAN);
    expect(opts).toEqual({ baseRevision: 3n });
    const name = `guardian-${EARLIER.slice(0, 11).toLowerCase()}`;
    expect(name.length).toBeLessThanOrEqual(20);
    expect((doc as PolicyDoc).rules.filter((r) => r.name.startsWith('guardian'))).toEqual([
      ruleAt('guardian', deployment.recoveryController),
      ruleAt(name, EARLIER),
    ]);

    await click(root, /Approve cancelling it/);
    await vi.waitFor(() => expect(submitAsGuardian).toHaveBeenCalledTimes(1));
    expect(submitAsGuardian).toHaveBeenCalledWith(GUARDIAN, { __op: 'submit_guardian' }, approval(), name);
  });

  it('approves through the rule it already holds for that controller', async () => {
    chain.guardianRules.push({ name: 'guardian-older', contract: EARLIER, recovery: false });
    const root = await open(cancel);
    await click(root, /Approve cancelling it/);
    await vi.waitFor(() => expect(submitAsGuardian).toHaveBeenCalledTimes(1));
    expect(submitAsGuardian).toHaveBeenCalledWith(GUARDIAN, { __op: 'submit_guardian' }, approval(), 'guardian-older');
    expect(applyDoc).not.toHaveBeenCalled();
    expect(root.textContent).not.toMatch(/Allow my Nido/);
  });
});
