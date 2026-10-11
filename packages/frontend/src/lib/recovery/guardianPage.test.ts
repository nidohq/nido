// What the guardian page shows before it offers Approve: a reconfiguration
// setting by setting, and a recovery's new passkey as a check code.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, perch, type PolicyDoc } from '@nidohq/passkey-sdk';

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

const chain = vi.hoisted(() => ({ doc: undefined as unknown, statement: undefined as unknown }));

vi.mock('./chain.js', () => ({
  readRecoveryState: vi.fn(async () => ({ doc: chain.doc, summary: { guardians: [] } })),
  recoveryClient: () => ({ statement: vi.fn(async () => chain.statement) }),
  applyDoc: vi.fn(),
  currentOrFirstDoc: vi.fn(),
  submitAsGuardian: vi.fn(),
  GUARDIAN_RULE: 'guardian',
}));
vi.mock('./deployment.js', () => ({
  perchDeployment: () => deployment,
  requireDeployment: () => deployment,
}));
vi.mock('../walletConnect.js', () => ({ connect: vi.fn(), initWalletKit: vi.fn() }));
vi.mock('../policyChainFetch.js', () => ({ readAccountConfiguration: vi.fn() }));
vi.mock('../toast.js', () => ({ toast: vi.fn() }));

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

  it('refuses settings that do not hash to the request', async () => {
    const root = await open(reconfigure(docWith({ delayLedgers: 12 }), 'ab'.repeat(32)));
    expect(root.textContent).toMatch(/do not match the request/);
    expect(root.querySelector('tr[data-setting]')).toBeNull();
    expect(approvable(root)).toBe(false);
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
