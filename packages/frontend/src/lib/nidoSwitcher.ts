// Runtime for the "My Nido" switcher popover. Extracted from MyNidoMenu.astro so
// multiple triggers (landing pill, account topbar chip, desktop sidebar chip)
// share one implementation. Each `.mynido` root is mounted independently; every
// query is scoped to the root (no global IDs).
import {
  loadAccounts,
  loadPendingAccounts,
  loadAccountName,
  saveAccountName,
  activateAccount,
  lookupName,
  fetchRegistryAddress,
} from "@g2c/passkey-sdk";
import { rpc, xdr } from "@stellar/stellar-sdk";
import { buildMyNidoModel, type MyNidoRow } from "./myNidoModel";
import { nidoRowHref, accountShareUrl } from "./accountLinks";
import { resolveMissingNames } from "./resolveMyNidoNames";
import { fetchXlmBalance } from "./balance";
import { avatarBackground } from "./avatarStyle";
import { shortAddr } from "./address";
import { formatXlm } from "./money";
import { createNido } from "./createNido";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NAME_NETWORK = "Test SDF Network ; September 2015";

// Resolve the name-registry contract id once per page load (memoized promise),
// shared across switcher instances. Only fetched if some row needs an on-chain
// name.
let nameRegistryIdPromise: Promise<string> | null = null;
function nameRegistryId(): Promise<string> {
  return (nameRegistryIdPromise ??= fetchRegistryAddress("name-registry"));
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function rowHtml(row: MyNidoRow): string {
  const av = `<span class="mn-av" style="background:${avatarBackground(row.contractId)}"><span class="st"></span></span>`;
  const title = esc(row.name ?? "Your Nido");
  const href = esc(nidoRowHref(window.location.host, row));
  if (row.status === "pending") {
    return `<a class="mn-row mn-pending" role="menuitem" href="${href}">${av}
      <span class="mn-main"><span class="mn-name">${title}</span><span class="mn-meta">Finishing setup…</span></span>
      <span class="mn-chev">›</span></a>`;
  }
  return `<a class="mn-row" role="menuitem" href="${href}" data-balance-for="${row.contractId}">${av}
    <span class="mn-main"><span class="mn-name">${title}</span><span class="mn-meta">${esc(shortAddr(row.contractId, 6, 6))}</span></span>
    <span class="mn-bal"><span class="skeleton">&nbsp;</span></span>
    <span class="mn-chev">›</span></a>`;
}

// Minimal inline Nest mark (matches Nest.astro: dashed coral + honey rings, teal dot).
function nestSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="46" fill="none" stroke="var(--coral)" stroke-width="7" stroke-dasharray="14 9" stroke-linecap="round"/>
    <circle cx="60" cy="60" r="31" fill="none" stroke="var(--honey)" stroke-width="7" stroke-dasharray="11 8" stroke-linecap="round"/>
    <circle cx="60" cy="60" r="11" fill="var(--teal)"/></svg>`;
}

// verifyPending hits the RPC; with several triggers on one page, run it once.
let verifiedPending = false;

// Every mounted switcher registers here so ONE set of document-level listeners
// (outside-click, Escape) serves all instances, opening one closes the others,
// and a background promotion can refresh whichever panel happens to be open.
interface SwitcherInstance {
  root: HTMLElement;
  btn: HTMLElement;
  close: () => void;
  refreshIfOpen: () => void;
}
const instances: SwitcherInstance[] = [];
let globalListenersAttached = false;
let panelIdSeq = 0;

function attachGlobalListeners() {
  if (globalListenersAttached) return;
  globalListenersAttached = true;
  // A click outside an open switcher closes it.
  document.addEventListener("click", (e) => {
    for (const inst of instances) {
      if (inst.root.classList.contains("mynido-open") && !inst.root.contains(e.target as Node)) {
        inst.close();
      }
    }
  });
  // Escape closes any open switcher and returns focus to its trigger.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const inst of instances) {
      if (inst.root.classList.contains("mynido-open")) {
        inst.close();
        inst.btn.focus();
      }
    }
  });
}

export interface MountOptions {
  /** Only the primary instance (the landing pill) responds to `nido:open-menu`. */
  primary?: boolean;
}

export function mountNidoSwitcher(root: HTMLElement, opts: MountOptions = {}): void {
  const btn = root.querySelector<HTMLElement>("[data-mynido-trigger]");
  const panel = root.querySelector<HTMLElement>("[data-mynido-panel]");
  if (!btn || !panel) return;

  // Associate the trigger with the panel it opens (unique id per instance, so
  // multiple switchers on one page each reference their own panel).
  if (!panel.id) panel.id = `mynido-panel-${++panelIdSeq}`;
  btn.setAttribute("aria-controls", panel.id);

  function render() {
    const accounts = loadAccounts();
    const pending = loadPendingAccounts();
    const model = buildMyNidoModel(accounts, pending, loadAccountName);

    if (model.state === "empty") {
      const pendingRows = model.rows.map(rowHtml).join("");
      panel!.innerHTML = `<div class="mn-scroll"><div class="mn-create">
          <div style="display:grid;place-items:center;"><span class="mn-nest"></span></div>
          <div class="t">Create your Nido</div>
          <div class="s">A safe place for everything you own. Set up in seconds — just your face.</div>
          <button class="btn acc cbtn mn-create-btn" type="button">Set up with your face</button>
        </div>
        ${pendingRows ? `<div class="mn-div"></div><div class="mn-body">${pendingRows}</div>` : ""}
        <div class="mn-err" style="display:none"></div></div>`;
      (panel!.querySelector(".mn-nest") as HTMLElement).innerHTML = nestSvg(54);
      wireCreate();
      return;
    }

    const header =
      model.state === "single"
        ? `<div class="mn-head"><span class="lockchip">Only you</span><div class="hl">Welcome back</div><div class="hs">Your Nido is ready</div></div>`
        : `<div class="mn-head"><div class="hl">Your Nidos</div><div class="hs">${model.rows.length} on this device</div></div>`;

    panel!.innerHTML = `<div class="mn-scroll">${header}
      <div class="mn-body">
        ${model.rows.map(rowHtml).join("")}
        <div class="mn-div"></div>
        <button class="mn-foot mn-create-btn" type="button"><span class="pl">+</span> Create another Nido</button>
      </div>
      <div class="mn-err" style="display:none"></div></div>`;
    wireCreate();
    loadBalances();
    void resolveNames(model.rows);
  }

  // After the synchronous render, reverse-look-up each nameless active account
  // via the name registry, patch the row's name + (bare) href in place, and
  // persist the hit so later renders are instant. Mirrors loadBalances().
  async function resolveNames(rows: MyNidoRow[]) {
    const lookup = async (contractId: string) =>
      lookupName(RPC_URL, await nameRegistryId(), contractId, NAME_NETWORK);
    const resolved = await resolveMissingNames(rows, lookup, saveAccountName);
    resolved.forEach((name, contractId) => {
      const rowEl = panel!.querySelector<HTMLAnchorElement>(
        `.mn-row[data-balance-for="${contractId}"]`,
      );
      if (!rowEl) return;
      const nameEl = rowEl.querySelector(".mn-name");
      if (nameEl) nameEl.textContent = name;
      rowEl.href = accountShareUrl(window.location.host, name);
    });
  }

  function wireCreate() {
    const cbtn = panel!.querySelector<HTMLButtonElement>(".mn-create-btn");
    if (!cbtn) return;
    cbtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cbtn.disabled = true;
      cbtn.textContent = "Opening setup…";
      window.location.href = createNido(window.location.host);
    });
  }

  async function loadBalances() {
    const rows = panel!.querySelectorAll<HTMLElement>("[data-balance-for]");
    rows.forEach(async (rowEl) => {
      const id = rowEl.dataset.balanceFor!;
      const balEl = rowEl.querySelector(".mn-bal")!;
      try {
        const raw = await fetchXlmBalance(id, RPC_URL);
        balEl.innerHTML = `${formatXlm(raw)} <small>XLM</small>`;
      } catch {
        balEl.innerHTML = `<small>—</small>`;
      }
    });
  }

  // Promote any pending account that has since deployed, then re-render if needed.
  async function verifyPending() {
    const pending = loadPendingAccounts();
    if (pending.length === 0) return;
    const active = new Set(loadAccounts());
    let changed = false;
    const server = new rpc.Server(RPC_URL);
    for (const { contractId } of pending) {
      if (active.has(contractId)) continue;
      try {
        await server.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance());
        activateAccount(contractId);
        changed = true;
      } catch {
        /* not deployed yet */
      }
    }
    // The scan runs once (on the first-mounted instance) but the open panel may
    // belong to a DIFFERENT instance, so refresh every open switcher.
    if (changed) for (const inst of instances) inst.refreshIfOpen();
  }

  function refreshIfOpen() {
    if (root.classList.contains("mynido-open")) render();
  }
  function open() {
    // Keep switchers mutually exclusive (defensive: today the responsive CSS
    // shows only one trigger per breakpoint, but this future-proofs it).
    for (const inst of instances) {
      if (inst.root !== root) inst.close();
    }
    render();
    root.classList.add("mynido-open");
    btn!.setAttribute("aria-expanded", "true");
    panel!.setAttribute("aria-hidden", "false");
    // Move focus into the menu for keyboard users (preventScroll avoids a jump).
    // Both render() states put an .mn-row or .mn-create-btn first; the create
    // buttons carry .mn-create-btn, so no bare `button` fallback is needed.
    panel!
      .querySelector<HTMLElement>("a.mn-row, .mn-create-btn")
      ?.focus({ preventScroll: true });
  }
  function close() {
    root.classList.remove("mynido-open");
    btn!.setAttribute("aria-expanded", "false");
    panel!.setAttribute("aria-hidden", "true");
  }
  function toggle() {
    root.classList.contains("mynido-open") ? close() : open();
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  instances.push({ root, btn, close, refreshIfOpen });
  attachGlobalListeners();

  // Hero / CTA-band buttons dispatch `nido:open-menu` on the landing page only;
  // the primary (landing) instance handles it. Defer to the next tick so the
  // originating click settles past the document "click outside closes" handler.
  if (opts.primary) {
    window.addEventListener("nido:open-menu", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(open, 0);
    });
  }

  if (!verifiedPending) {
    verifiedPending = true;
    void verifyPending();
  }
}
