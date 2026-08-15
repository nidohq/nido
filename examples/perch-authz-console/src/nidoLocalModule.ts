// A @creit.tech/stellar-wallets-kit module that connects a *local-key* Nido
// account — the passkey-free counterpart to @nidohq/stellar-wallets-kit-module.
// It generates local signers for every verifier (secp256r1, ed25519, ML-DSA-65)
// and derives the Nido account from them, so any dApp using the kit can "log in
// with Nido" in a test or demo without a WebAuthn ceremony.
//
// getAddress returns the derived C-address; signMessage signs locally.
// Submitting real transactions is out of scope for this simulation demo — those
// throw with a pointer to simulateCheckAuth.

import { ModuleType } from '@creit.tech/stellar-wallets-kit';
import {
  localSigner,
  createLocalAccount,
  contract,
  isSelf,
  rule,
  TESTNET_PASSPHRASE,
  type LocalAccount,
  type LocalSigner,
} from '@nidohq/testkit';

const REGISTRY = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';

// A small teal "perch" bird icon (data URI — CSP-safe, no remote fetch).
const ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%230C8B99" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10a8 8 0 0 1 16 0v10"/><path d="M4 20h16"/><circle cx="12" cy="10" r="2.4"/></svg>`,
  );

/** Build the default multi-verifier account: an admin (secp256r1), a CI key
 *  (ed25519), and a post-quantum key (ML-DSA-65), with a starter policy. */
export function buildDefaultAccount(): { account: LocalAccount; signers: LocalSigner[] } {
  const admin = localSigner({ id: 'admin', algorithm: 'secp256r1' });
  const ci = localSigner({ id: 'ci', algorithm: 'ed25519' });
  const pq = localSigner({ id: 'pq', algorithm: 'ml-dsa-65' });
  const account = createLocalAccount({
    signers: [admin, ci, pq],
    rules: [
      rule({ name: 'admin-root', scope: { type: 'self-admin' }, signedBy: ['admin'] }),
      rule({
        name: 'ci-publish',
        scope: contract(REGISTRY),
        signedBy: ['ci'],
        functions: ['publish', 'publish_hash'],
        args: [{ index: 1, pred: isSelf() }],
        notAfterLedger: 55_000_000,
      }),
      rule({ name: 'pq-admin', scope: { type: 'self-admin' }, signedBy: ['pq'] }),
    ],
  });
  return { account, signers: [admin, ci, pq] };
}

export class NidoLocalModule {
  readonly moduleType = ModuleType.HOT_WALLET;
  readonly productId = 'nido-local';
  readonly productName = 'Nido (local key)';
  readonly productUrl = 'https://nido.fyi';
  readonly productIcon = ICON;

  private state = buildDefaultAccount();

  /** The connected account — read by the app after getAddress. */
  get account(): LocalAccount {
    return this.state.account;
  }
  get signers(): LocalSigner[] {
    return this.state.signers;
  }

  /** Replace the account (e.g. after the policy builder edits it). */
  setAccount(account: LocalAccount): void {
    this.state = { account, signers: account.signers };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    return { network: 'TESTNET', networkPassphrase: TESTNET_PASSPHRASE };
  }

  async getAddress(): Promise<{ address: string }> {
    return { address: this.state.account.address };
  }

  async signMessage(message: string): Promise<{ signedMessage: string; signerAddress: string }> {
    // Local signing with the primary (admin) signer over the message bytes.
    const bytes = new TextEncoder().encode(message);
    const digest = new Uint8Array(32);
    digest.set(bytes.slice(0, 32));
    const first = this.state.signers[0]!;
    const sig = first.signAuth(digest);
    const signedMessage = sig.kind === 'raw' ? bytesToHex(sig.bytes) : bytesToHex(sig.assertion.signature);
    return { signedMessage, signerAddress: this.state.account.address };
  }

  async signTransaction(): Promise<never> {
    throw new Error(
      'Nido (local key) is a simulation wallet — it does not submit transactions. ' +
        'Use simulateCheckAuth() to check authorization locally.',
    );
  }

  async signAuthEntry(): Promise<never> {
    throw new Error(
      'Nido (local key) is a simulation wallet — signAuthEntry is not supported. ' +
        'Use simulateCheckAuth() to check authorization locally.',
    );
  }

  async disconnect(): Promise<void> {
    /* stateless local wallet */
  }
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
