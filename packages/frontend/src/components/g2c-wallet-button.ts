/**
 * <g2c-wallet-button> — a vanilla-TS custom element mirroring the
 * stellar-scaffold-frontend `WalletButton` UX:
 *   - logged out  → a "Connect wallet" button that opens the kit's selector
 *     modal (g2c + standard wallets).
 *   - logged in   → the connected address (shortened) + a Disconnect action.
 *   - restores the persisted session on load AND re-checks on window focus
 *     (lighter than the scaffold's 1s React polling).
 *   - renders any per-wallet warnings from the behaviour table.
 *
 * It emits a `g2c:wallet-changed` CustomEvent (detail: WalletSession | null) on
 * connect/disconnect/restore so the host page can react (e.g. the
 * status-message demo wiring its `author` to the connected account).
 *
 * Uses the reusable helper in `../lib/walletConnect.ts` for all kit/session
 * logic — this element is purely presentation + event glue.
 */

import {
  connect,
  disconnect,
  getSession,
  initWalletKit,
  restore,
  warningsFor,
  isG2cWallet,
  type WalletSession,
} from '../lib/walletConnect.js';

function shorten(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

function esc(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!,
  );
}

export const WALLET_CHANGED_EVENT = 'g2c:wallet-changed';

export class G2cWalletButton extends HTMLElement {
  private session: WalletSession | null = null;
  private busy = false;
  private onFocus = () => this.recheck();

  connectedCallback(): void {
    // Render the logged-out state immediately so there's no flash of empty UI
    // while the kit's standard modules load lazily.
    this.render();
    // Re-check on focus instead of aggressive polling: another tab may have
    // connected/disconnected this wallet.
    window.addEventListener('focus', this.onFocus);
    void this.boot();
  }

  /**
   * Init the kit once (idempotent), then restore any persisted session into the
   * live kit and render. `base`/`network` can be overridden via attributes;
   * otherwise the helper derives them.
   */
  private async boot(): Promise<void> {
    const base = this.getAttribute('base') ?? undefined;
    const networkPassphrase = this.getAttribute('network-passphrase') ?? undefined;
    await initWalletKit({ base, networkPassphrase });

    this.session = restore();
    this.render();
    if (this.session) this.emit();
  }

  disconnectedCallback(): void {
    window.removeEventListener('focus', this.onFocus);
  }

  /** Re-read the persisted session; re-render + emit if it changed. */
  private recheck(): void {
    const next = getSession();
    const changed =
      (next?.walletAddress ?? null) !== (this.session?.walletAddress ?? null) ||
      (next?.walletId ?? null) !== (this.session?.walletId ?? null);
    if (changed) {
      this.session = next;
      this.render();
      this.emit();
    }
  }

  private emit(): void {
    this.dispatchEvent(
      new CustomEvent<WalletSession | null>(WALLET_CHANGED_EVENT, {
        detail: this.session,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async handleConnect(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      this.session = await connect();
      this.emit();
    } catch (err: unknown) {
      // The kit rejects with { code: -1, message: "The user closed the modal." }
      // on cancel — treat that as a no-op rather than an error.
      const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
      if (!/closed the modal|cancel/i.test(message)) {
        this.setError(message);
      }
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async handleDisconnect(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await disconnect();
      this.session = null;
      this.emit();
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private setError(msg: string): void {
    const el = this.querySelector<HTMLElement>('.g2c-wb-error');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  private render(): void {
    const s = this.session;
    if (!s) {
      this.innerHTML = `
        <div class="g2c-wb">
          <button type="button" class="g2c-wb-connect"${this.busy ? ' disabled' : ''}>
            ${this.busy ? 'Connecting…' : 'Connect wallet'}
          </button>
          <div class="g2c-wb-error" style="display:none"></div>
        </div>`;
      this.querySelector<HTMLButtonElement>('.g2c-wb-connect')!.addEventListener('click', () =>
        this.handleConnect(),
      );
      return;
    }

    const behavior = warningsFor(s.walletId);
    const warningHtml = behavior.warning
      ? `<div class="g2c-wb-warning">⚠ ${esc(behavior.warning)}${
          behavior.helpUrl
            ? ` <a href="${esc(behavior.helpUrl)}" target="_blank" rel="noopener">learn more</a>`
            : ''
        }</div>`
      : '';
    const kindLabel = isG2cWallet(s.walletId) ? 'g2c smart account' : esc(s.walletId);

    this.innerHTML = `
      <div class="g2c-wb g2c-wb-connected">
        <span class="g2c-wb-meta">
          <span class="g2c-wb-id">${kindLabel}</span>
          <span class="g2c-wb-addr" title="${esc(s.walletAddress)}">${esc(shorten(s.walletAddress))}</span>
        </span>
        <button type="button" class="g2c-wb-disconnect"${this.busy ? ' disabled' : ''}>
          ${this.busy ? '…' : 'Disconnect'}
        </button>
        ${warningHtml}
      </div>`;
    this.querySelector<HTMLButtonElement>('.g2c-wb-disconnect')!.addEventListener('click', () =>
      this.handleDisconnect(),
    );
  }
}

/** Register the element (idempotent). Call once before using the tag. */
export function defineG2cWalletButton(): void {
  if (typeof customElements !== 'undefined' && !customElements.get('g2c-wallet-button')) {
    customElements.define('g2c-wallet-button', G2cWalletButton);
  }
}
