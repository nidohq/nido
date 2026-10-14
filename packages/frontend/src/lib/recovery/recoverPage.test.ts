// The recover page proves, links, and adopts a passkey only for the attempt
// that declares the replacement set it opened, whatever attempt id it saved.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { perch } from '@nidohq/passkey-sdk';

const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ACCOUNT = contract(30);
const VERIFIER = contract(2);

const client = {
  attempt: vi.fn(),
  nextAttemptId: vi.fn(),
  attemptLive: vi.fn(async () => true),
  activityGate: vi.fn(async () => ({ frozen: false })),
  statement: vi.fn(async () => ({ __statement: true })),
  submitZk: vi.fn(async () => ({ operations: [{ __op: true }] })),
};
const summary = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./chain.js', () => ({
  readRecoveryState: vi.fn(async () => ({ summary: summary.current })),
  recoveryClient: () => client,
  latestLedger: vi.fn(async () => 100),
  // Never settles: the page would reload after a recorded proof.
  submitOpen: vi.fn(() => new Promise(() => {})),
}));
vi.mock('./deployment.js', () => ({
  perchDeployment: () => ({}),
  requireDeployment: () => ({ webauthnVerifier: VERIFIER }),
}));
vi.mock('./zk.js', () => ({
  proveWithKit: vi.fn(async () => ({ __evidence: true })),
  newRecoveryKit: vi.fn(),
  kitFile: vi.fn(),
}));
vi.mock('../toast.js', () => ({ toast: vi.fn() }));
vi.mock('@nidohq/passkey-sdk', async (orig) => ({
  ...(await orig<typeof import('@nidohq/passkey-sdk')>()),
  saveCredential: vi.fn(),
}));

import { saveCredential } from '@nidohq/passkey-sdk';
import { mountRecover } from './recoverPage';
import { hex, passkeyCheckCode, replacementsFromWire, type WireReplacements } from './model';

const set = (fill: number): WireReplacements => ({
  signers: [{ signerId: 'admin', verifier: VERIFIER, key: '04' + hex(new Uint8Array(64).fill(fill)) }],
});
const MINE = set(0x11);
const THEIRS = set(0x22);

function attempt(replacements: WireReplacements, state = 'Collecting'): perch.Attempt {
  return {
    action: 1,
    state: { tag: state },
    guardians: [],
    replacements_hash: Buffer.from(perch.replacementSetHash(perch.sortReplacements(replacementsFromWire(replacements)))),
  } as unknown as perch.Attempt;
}

/** `attempts[i]` is attempt id `i`. */
function onChain(attempts: perch.Attempt[]): void {
  client.nextAttemptId.mockResolvedValue(BigInt(attempts.length));
  client.attempt.mockImplementation(async (_account: string, id: bigint) => attempts[Number(id)]);
}

function savePending(attemptId: string): void {
  localStorage.setItem(
    `nido:recover:${ACCOUNT}`,
    JSON.stringify({ action: 'lost-key', attemptId, credentialId: 'AQID', publicKey: MINE.signers[0]!.key, replacements: MINE }),
  );
}
const savedAttemptId = () => JSON.parse(localStorage.getItem(`nido:recover:${ACCOUNT}`)!).attemptId;

async function mount(): Promise<HTMLElement> {
  const root = document.createElement('div');
  await mountRecover(root, ACCOUNT);
  return root;
}

async function pasteKit(root: HTMLElement): Promise<void> {
  const kit = { version: 1, network: 'testnet', account: ACCOUNT, enrollmentId: 'ab'.repeat(32), secret: '01'.repeat(32) };
  const text = root.querySelector('textarea')!;
  text.value = JSON.stringify(kit);
  text.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(client.submitZk).toHaveBeenCalled());
}

describe('recover page: whose attempt it works on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    summary.current = {
      mode: 'zk-only',
      quorum: 0,
      guardians: [],
      replaceable: ['admin'],
      delayLedgers: 100,
      baselineDocHash: undefined,
    };
  });

  it('refuses the attempt another opened first and proves its own', async () => {
    // Someone else's attempt landed first (id 0), so the id saved for this
    // user names it; the user's own attempt is id 1.
    onChain([attempt(THEIRS), attempt(MINE)]);
    savePending('0');
    const root = await mount();

    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/Recovery attempt 0 is not yours/);
    expect(savedAttemptId()).toBe('1');

    await pasteKit(root);
    expect(client.statement).toHaveBeenCalledTimes(1);
    expect(client.statement).toHaveBeenCalledWith(ACCOUNT, 1n, perch.EvidenceDomain.Initiate);
    expect(client.submitZk).toHaveBeenCalledWith(ACCOUNT, 1n, perch.EvidenceDomain.Initiate, { __evidence: true });
  });

  it('proves its own attempt when the saved id is right', async () => {
    onChain([attempt(THEIRS), attempt(MINE)]);
    savePending('1');
    const root = await mount();

    expect(root.querySelector('[role="alert"]')).toBeNull();
    await pasteKit(root);
    expect(client.statement).toHaveBeenCalledWith(ACCOUNT, 1n, perch.EvidenceDomain.Initiate);
  });

  it('offers no proof when none of the attempts is its own', async () => {
    onChain([attempt(THEIRS)]);
    savePending('0');
    const root = await mount();

    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/not yours/);
    expect(root.textContent).toMatch(/Your own recovery attempt was not found/);
    expect(root.querySelector('textarea')).toBeNull();
    expect(client.statement).not.toHaveBeenCalled();
  });

  it('keeps no passkey for a completed attempt that is not its own', async () => {
    onChain([attempt(THEIRS, 'Completed')]);
    savePending('0');
    await mount();
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it('keeps the new passkey once its own attempt completes', async () => {
    onChain([attempt(THEIRS, 'Completed'), attempt(MINE, 'Completed')]);
    savePending('1');
    const root = await mount();
    expect(saveCredential).toHaveBeenCalledTimes(1);
    expect(root.textContent).toMatch(/Recovery finished/);
  });

  it('finds its own attempt when it saved no id', async () => {
    onChain([attempt(MINE), attempt(THEIRS)]);
    localStorage.setItem(
      `nido:recover:${ACCOUNT}`,
      JSON.stringify({ action: 'lost-key', credentialId: 'AQID', publicKey: MINE.signers[0]!.key, replacements: MINE }),
    );
    const root = await mount();
    expect(savedAttemptId()).toBe('0');
    await pasteKit(root);
    expect(client.statement).toHaveBeenCalledWith(ACCOUNT, 0n, perch.EvidenceDomain.Initiate);
  });

  it('shows the new passkey’s check code for friends to compare', async () => {
    summary.current = { ...summary.current, mode: 'guardian-only', quorum: 2, guardians: [contract(20), contract(21)] };
    onChain([attempt(MINE)]);
    savePending('0');
    const root = await mount();
    expect(root.textContent).toContain(passkeyCheckCode(MINE.signers[0]!.key));
  });
});
