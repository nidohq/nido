// perch × Nido — Authorization Console
//
// A dApp that logs in a *local-key* Nido account (via the NidoLocalModule, a
// @creit.tech/stellar-wallets-kit module), visualizes its perch policy and
// reachable calls, simulates authorization locally with @nidohq/testkit, and
// lets you build more complex policies — including a post-quantum (ML-DSA)
// signer. No passkey, no network.

import {
  simulateCheckAuth,
  reachableCalls,
  isNarrowing,
  rule as mkRule,
  contract,
  isSelf,
  docHash,
  VERIFIERS,
  type Algorithm,
  type LocalAccount,
  type PolicyDoc,
  type Rule,
  type SimArg,
} from '@nidohq/testkit';
import { NidoLocalModule } from './nidoLocalModule';

const REGISTRY = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';

const module = new NidoLocalModule();
let account: LocalAccount | null = null;
let baseline: PolicyDoc | null = null; // the grant we attenuate against
let ledger = 54_000_000;
let seq = 0;

const app = document.getElementById('app')!;
const el = <K extends keyof HTMLElementTagNameMap>(t: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(t);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function verifierClass(algorithm: Algorithm): string {
  if (algorithm === 'ml-dsa-65') return 'pq';
  return VERIFIERS[algorithm].onChain ? 'onchain' : 'sim';
}

function refresh(): void {
  if (account) account = { ...account, docHash: docHash(account.policy) };
  render();
}

function logLine(v: 'ok' | 'bad' | 'info', msg: string): void {
  seq++;
  const ol = document.getElementById('log-list');
  if (!ol) return;
  const li = el('li');
  li.append(el('span', 'mono', `#${String(seq).padStart(2, '0')}`));
  const vv = el('span', `v ${v}`, v === 'ok' ? '✓' : v === 'bad' ? '✕' : '·');
  li.append(vv);
  const m = el('span'); m.innerHTML = msg; li.append(m);
  ol.insertBefore(li, ol.firstChild);
}

// ---- header + shell ----

function header(): HTMLElement {
  const h = el('header');
  const left = el('div');
  const mark = el('div', 'mark');
  const g = el('div', 'glyph');
  g.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10a8 8 0 0 1 16 0v10"/><path d="M4 20h16"/><circle cx="12" cy="10" r="2.4"/></svg>`;
  mark.append(g, el('span', 'kicker', 'perch × nido · authorization console'));
  left.append(mark);
  left.append(el('h1', undefined, "Log in a Nido account, see what its keys can do, and narrow it"));
  const lede = el('p', 'lede');
  lede.innerHTML =
    'A local-key Nido smart account — <b>no passkey</b>. Its authorization is a <span class="mono">perch</span> policy; the console shows what each key reaches and lets you build more. Everything runs locally via <span class="mono">@nidohq/testkit</span>.';
  left.append(lede);
  h.append(left);

  const themeBtn = el('button', 'theme-btn', '◐ Theme');
  themeBtn.type = 'button';
  themeBtn.addEventListener('click', () => {
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  });
  h.append(themeBtn);
  return h;
}

function connectHero(): HTMLElement {
  const hero = el('div', 'connect-hero');
  hero.append(el('div', 'kicker', 'stellar wallets kit · module'));
  const t = el('h1'); t.style.fontSize = 'var(--s2)'; t.textContent = 'Connect a Nido account';
  hero.append(t);
  const p = el('p');
  p.innerHTML =
    'Nido is a <span class="mono">@creit.tech/stellar-wallets-kit</span> wallet. This connects a <b>local-key</b> one — three signers across three verifiers (secp256r1, ed25519, and post-quantum ML-DSA-65) — with no WebAuthn.';
  hero.append(p);
  const btn = el('button', 'act', 'Connect with Nido (local key)');
  btn.type = 'button';
  btn.id = 'connect';
  btn.addEventListener('click', connect);
  hero.append(btn);
  return hero;
}

async function connect(): Promise<void> {
  await module.getAddress(); // the kit login handshake
  account = module.account;
  baseline = structuredClone(account.policy);
  render();
  logLine('info', `connected Nido account <span class="h">${short(account.address)}</span> — 3 signers, 3 rules.`);
}

// ---- identity + panels (after connect) ----

function identityBar(a: LocalAccount): HTMLElement {
  const box = el('div', 'identity');
  const f1 = el('div', 'field');
  f1.append(el('span', 'label', 'Nido smart account'));
  f1.append(el('span', 'addr', a.address));
  f1.append(el('span', 'label', 'doc_hash · sha-256 of the canonical perch policy'));
  const hash = el('span', 'hash'); hash.id = 'hash'; hash.textContent = a.docHash; hash.title = a.docHash;
  f1.append(hash);
  box.append(f1);
  const f2 = el('div', 'field'); f2.style.textAlign = 'right';
  f2.append(el('span', 'label', 'Current ledger'));
  const l = el('span', 'mono'); l.style.fontSize = 'var(--s1)'; l.style.fontWeight = '600'; l.textContent = ledger.toLocaleString();
  f2.append(l);
  box.append(f2);
  return box;
}

function panel(title: string, bodyBuilder: (body: HTMLElement) => void, right?: string): HTMLElement {
  const p = el('section', 'panel');
  const h = el('h2'); h.append(document.createTextNode(title));
  if (right) { const r = el('span', 'mono'); r.style.color = 'var(--faint)'; r.textContent = right; h.append(r); }
  p.append(h);
  const body = el('div', 'panel-body');
  bodyBuilder(body);
  p.append(body);
  return p;
}

function signersPanel(a: LocalAccount): HTMLElement {
  return panel('Signers — one per verifier', (body) => {
    const list = el('div', 'signers');
    for (const s of a.signers) {
      const info = VERIFIERS[s.algorithm];
      const card = el('div', 'signer');
      const top = el('div', 'top');
      top.append(el('span', 'id', s.id));
      const badge = el('span', `vbadge ${verifierClass(s.algorithm)}`, info.label + (info.onChain ? '' : ' · sim'));
      top.append(badge);
      card.append(top);
      card.append(el('div', 'pk', `verifier ${short(s.verifier)} · key ${short(s.publicKeyHex)}`));
      if (info.note) { const n = el('div', 'note'); n.textContent = info.note; card.append(n); }
      list.append(card);
    }
    body.append(list);
  });
}

function ruleCard(r: Rule): HTMLElement {
  const card = el('div', 'rule');
  const head = el('div', 'rule-head');
  head.append(el('span', 'rule-name', r.name));
  card.append(head);
  const scopeRow = el('div', 'rule-row');
  scopeRow.append(el('span', 'rk', 'scope'));
  scopeRow.append(el('span', 'chip scope', r.scope.type === 'self-admin' ? 'self-admin' : short(r.scope.address)));
  if (r.principals.type === 'all') for (const id of r.principals.signers) scopeRow.append(el('span', 'chip', `by ${id}`));
  card.append(scopeRow);
  const fnRow = el('div', 'rule-row');
  fnRow.append(el('span', 'rk', 'calls'));
  if (r.functions) r.functions.forEach((f) => fnRow.append(el('span', 'chip fn', `${f}()`)));
  else fnRow.append(el('span', 'chip any', 'any function'));
  card.append(fnRow);
  if ((r.args && r.args.length) || r['not-after-ledger'] !== undefined || r.cap) {
    const lim = el('div', 'rule-row');
    lim.append(el('span', 'rk', 'limits'));
    (r.args ?? []).forEach((c) => lim.append(el('span', 'chip', `arg[${c.index}] ${c.pred.type}`)));
    if (r['not-after-ledger'] !== undefined) lim.append(el('span', 'chip expiry', `expires @ ${r['not-after-ledger'].toLocaleString()}`));
    if (r.cap) lim.append(el('span', 'chip cap', `≤ ${r.cap.limit} / ${r.cap['period-ledgers']} · spending_limit`));
    card.append(lim);
  }
  return card;
}

function rulesPanel(a: LocalAccount): HTMLElement {
  return panel('Policy — what is granted', (body) => {
    for (const r of a.policy.rules) body.append(ruleCard(r));
  });
}

function reachPanel(a: LocalAccount): HTMLElement {
  const reach = reachableCalls(a.policy);
  return panel('Reachable calls — what it can do', (body) => {
    for (const rs of reach) {
      const row = el('div', 'reach-row');
      const who = el('div', 'reach-who');
      who.append(el('span', 'chip', rs.rule));
      who.append(el('span', 'arrow', '→'));
      who.append(el('span', 'chip scope', rs.scope === 'self-admin' ? 'self-admin' : short(rs.scope)));
      row.append(who);
      const fns = el('div', 'reach-fns');
      if (rs.functions.kind === 'any') fns.append(el('span', 'chip any', 'any function'));
      else rs.functions.functions.forEach((f) => fns.append(el('span', 'chip fn', `${f}()`)));
      row.append(fns);
      body.append(row);
    }
  });
}

// ---- simulate ----

function simulatePanel(a: LocalAccount): HTMLElement {
  return panel('Try it — simulate __check_auth', (body) => {
    const controls = el('div', 'controls');
    const targetSel = el('select'); targetSel.id = 'sim-target';
    ([['registry', 'registry contract'], ['self', 'self-admin (this account)']] as const).forEach(([v, t]) => { const o = el('option'); o.value = v; o.textContent = t; targetSel.append(o); });
    const fnSel = el('select'); fnSel.id = 'sim-fn';
    ['publish_hash', 'publish', 'set_admin'].forEach((f) => { const o = el('option'); o.value = f; o.textContent = `${f}()`; fnSel.append(o); });
    const authorSel = el('select'); authorSel.id = 'sim-author';
    ([['self', 'author = self'], ['other', 'author = someone else']] as const).forEach(([v, t]) => { const o = el('option'); o.value = v; o.textContent = t; authorSel.append(o); });
    const signerWrap = el('div', 'controls'); signerWrap.style.gap = '.4rem';
    for (const s of a.signers) {
      const lab = el('label'); lab.style.display = 'inline-flex'; lab.style.gap = '.3rem'; lab.style.fontSize = 'var(--s-1)';
      const cb = el('input'); cb.type = 'checkbox'; cb.value = s.id; cb.className = 'sim-signer'; if (s.id === 'ci') cb.checked = true;
      lab.append(cb, document.createTextNode(s.id));
      signerWrap.append(lab);
    }
    controls.append(mkFld('target', targetSel), mkFld('function', fnSel), mkFld('author', authorSel), mkFld('signed by', signerWrap));
    const run = el('button', 'act', 'Simulate'); run.type = 'button'; run.id = 'sim-run';
    controls.append(run);
    body.append(controls);

    const verdict = el('div', 'verdict info'); verdict.id = 'sim-verdict';
    verdict.append(el('span', 'vi', '·'));
    const vt = el('span'); vt.id = 'sim-verdict-txt'; vt.textContent = 'Pick a call and simulate the ci-publish policy on the registry.';
    verdict.append(vt);
    body.append(verdict);

    run.addEventListener('click', () => runSimulation(a));
  });
}

function runSimulation(a: LocalAccount): void {
  const fn = (document.getElementById('sim-fn') as HTMLSelectElement).value;
  const author = (document.getElementById('sim-author') as HTMLSelectElement).value;
  const signedBy = Array.from(document.querySelectorAll<HTMLInputElement>('.sim-signer:checked')).map((c) => c.value);
  const target = (document.getElementById('sim-target') as HTMLSelectElement).value;
  const authorAddr = author === 'self' ? a.address : otherAddress();
  const args: SimArg[] = [{ type: 'u32', value: 0 }, { type: 'address', value: authorAddr }];
  const ctx =
    target === 'self'
      ? { contract: a.address, fn, ledger } // self-admin scope
      : { contract: REGISTRY, fn, args, ledger };
  const res = simulateCheckAuth(a, ctx, signedBy);
  const v = document.getElementById('sim-verdict')!;
  const kind = res.verdict === 'allow' ? 'ok' : res.verdict === 'deny' ? 'bad' : 'info';
  v.className = `verdict ${kind}`;
  v.querySelector('.vi')!.textContent = res.verdict === 'allow' ? '✓' : res.verdict === 'deny' ? '✕' : '·';
  const label = res.verdict === 'allow' ? 'Authorized' : res.verdict === 'deny' ? 'Denied' : 'No rule applies';
  document.getElementById('sim-verdict-txt')!.innerHTML =
    `<b>${label}</b> — ${res.reasons.join('; ')}` +
    (res.matchedRule ? ` <span class="mono" style="color:var(--muted)">[rule ${res.matchedRule}, digest ${res.authDigest.slice(0, 10)}…]</span>` : '');
  if (kind === 'bad') { v.classList.remove('shake'); void v.offsetWidth; v.classList.add('shake'); }
  logLine(kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'info', `${fn}() by [${signedBy.join(', ') || '∅'}], author=${author} → ${res.verdict}`);
}

// A deterministic non-self contract address, for the "author = someone else" case.
const OTHER_ADDRESS = 'CAPS4YALJ6I4D3NDMRG5JZGDAAT266PSPLSHIITGUKBXUVAH5SUPZQKE';
function otherAddress(): string {
  return OTHER_ADDRESS;
}

// ---- policy builder ----

function builderPanel(a: LocalAccount): HTMLElement {
  return panel('Build a more complex policy — add a rule', (body) => {
    const c = el('div', 'controls');
    const name = el('input'); name.type = 'text'; name.id = 'b-name'; name.placeholder = 'rule name'; name.value = 'ci-publish-2';
    const scope = el('select'); scope.id = 'b-scope';
    ([['contract', 'contract scope'], ['self-admin', 'self-admin']] as const).forEach(([v, t]) => { const o = el('option'); o.value = v; o.textContent = t; scope.append(o); });
    const addr = el('input'); addr.type = 'text'; addr.id = 'b-addr'; addr.value = REGISTRY; addr.style.width = '18ch';
    const signer = el('select'); signer.id = 'b-signer';
    a.signers.forEach((s) => { const o = el('option'); o.value = s.id; o.textContent = `by ${s.id}`; signer.append(o); });
    const fns = el('input'); fns.type = 'text'; fns.id = 'b-fns'; fns.placeholder = 'publish, publish_hash'; fns.value = 'publish';
    const self = el('input'); self.type = 'checkbox'; self.id = 'b-self'; self.checked = true;
    const selfLab = el('label'); selfLab.style.fontSize = 'var(--s-1)'; selfLab.append(self, document.createTextNode(' arg[1] = self'));
    const cap = el('input'); cap.type = 'text'; cap.id = 'b-cap'; cap.placeholder = 'cap limit (optional)'; cap.style.width = '12ch';
    c.append(mkFld('name', name), mkFld('scope', scope), mkFld('address', addr), mkFld('signed by', signer), mkFld('functions', fns), mkFld('', selfLab), mkFld('cap', cap));
    const add = el('button', 'act', '+ Add rule'); add.type = 'button'; add.id = 'b-add';
    c.append(add);
    body.append(c);
    body.append(hintNote());
    add.addEventListener('click', () => addRule(a));
  });
}

function addRule(a: LocalAccount): void {
  const name = (document.getElementById('b-name') as HTMLInputElement).value.trim() || `rule-${a.policy.rules.length}`;
  const scopeType = (document.getElementById('b-scope') as HTMLSelectElement).value;
  const addr = (document.getElementById('b-addr') as HTMLInputElement).value.trim();
  const signerId = (document.getElementById('b-signer') as HTMLSelectElement).value;
  const fns = (document.getElementById('b-fns') as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean);
  const self = (document.getElementById('b-self') as HTMLInputElement).checked;
  const capVal = (document.getElementById('b-cap') as HTMLInputElement).value.trim();
  const newRule = mkRule({
    name,
    scope: scopeType === 'self-admin' ? { type: 'self-admin' } : contract(addr),
    signedBy: [signerId],
    functions: fns.length ? fns : undefined,
    args: self ? [{ index: 1, pred: isSelf() }] : undefined,
    cap: capVal ? { limit: capVal, 'period-ledgers': 17_280 } : undefined,
  });
  a.policy.rules.push(newRule);
  refresh();
  const h = document.getElementById('hash'); if (h) { h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); }
  logLine('info', `added rule <span class="h">${name}</span> — policy now ${a.policy.rules.length} rules; doc_hash changed.`);
}

// ---- attenuate ----

function attenuatePanel(a: LocalAccount): HTMLElement {
  return panel('Attenuate — narrow a rule safely', (body) => {
    const c = el('div', 'controls');
    const ruleSel = el('select'); ruleSel.id = 'a-rule';
    a.policy.rules.filter((r) => r.functions).forEach((r) => { const o = el('option'); o.value = r.name; o.textContent = r.name; ruleSel.append(o); });
    const fns = el('input'); fns.type = 'text'; fns.id = 'a-fns'; fns.placeholder = 'new functions'; fns.value = 'publish';
    c.append(mkFld('rule', ruleSel), mkFld('narrow functions to', fns));
    const apply = el('button', 'act ghost', 'Apply (must be a narrowing)'); apply.type = 'button'; apply.id = 'a-apply';
    c.append(apply);
    body.append(c);
    const v = el('div', 'verdict info'); v.id = 'a-verdict';
    v.append(el('span', 'vi', '·'));
    const vt = el('span'); vt.id = 'a-verdict-txt';
    vt.innerHTML = 'Attenuation is fail-closed: a change is applied only if <span class="mono">reachable(child) ⊆ reachable(parent)</span>. Try widening (add a function) — it will be refused.';
    v.append(vt);
    body.append(v);
    apply.addEventListener('click', () => applyNarrowing(a));
  });
}

function applyNarrowing(a: LocalAccount): void {
  const ruleName = (document.getElementById('a-rule') as HTMLSelectElement).value;
  const newFns = (document.getElementById('a-fns') as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean);
  const proposed: PolicyDoc = structuredClone(a.policy);
  const r = proposed.rules.find((x) => x.name === ruleName);
  if (!r) return;
  r.functions = newFns;
  const check = isNarrowing(a.policy, proposed);
  if (check.ok) {
    account = { ...a, policy: proposed, docHash: docHash(proposed) };
    render(); // rebuild first, then set the verdict on the fresh node
    const nv = document.getElementById('a-verdict')!;
    nv.className = 'verdict ok';
    nv.querySelector('.vi')!.textContent = '✓';
    document.getElementById('a-verdict-txt')!.innerHTML = `<b>Verified narrowing</b> — ${ruleName} → [${newFns.join(', ')}]. reachable(child) ⊆ reachable(parent) ✓`;
    logLine('ok', `attenuated <span class="h">${ruleName}</span> → [${newFns.join(', ')}] (verified ⊆ parent).`);
    return;
  }
  {
    const v = document.getElementById('a-verdict')!;
    v.className = 'verdict bad';
    v.querySelector('.vi')!.textContent = '✕';
    document.getElementById('a-verdict-txt')!.innerHTML = `<b>Refused — not a narrowing.</b> ${check.reason}. The grant is unchanged.`;
    v.classList.remove('shake'); void v.offsetWidth; v.classList.add('shake');
    logLine('bad', `widening refused on <span class="h">${ruleName}</span>: ${check.reason}.`);
  }
}

// ---- helpers + render ----

function mkFld(label: string, control: HTMLElement): HTMLElement {
  const l = el('label', 'fld');
  if (label) l.append(el('span', undefined, label));
  l.append(control);
  return l;
}

function hintNote(): HTMLElement {
  const n = el('div', 'note');
  n.innerHTML =
    'Adding rules <b>authors</b> the policy (an owner action) — the doc_hash changes. Use the <span class="mono">Attenuate</span> panel to <i>narrow</i> an existing grant with the fail-closed subset check.';
  return n;
}

function log(): HTMLElement {
  return panel('Change log', (body) => {
    const ol = el('ol'); ol.id = 'log-list';
    body.append(ol);
  });
}

function footer(): HTMLElement {
  const f = el('footer');
  f.innerHTML =
    'Built on <span class="mono">@nidohq/testkit</span> (nidohq/nido#188) and <span class="mono">perch</span>. The account, signatures, doc_hash, and verdicts are real and local; ed25519 / ML-DSA verifiers and perch-on-chain are simulated ahead of their contracts (ML-DSA: #143). Roadmap: soroban-env in the browser + rs-soroban-sdk#1657.';
  return f;
}

function render(): void {
  app.replaceChildren();
  const wrap = el('div', 'wrap');
  wrap.append(header());
  if (!account) {
    wrap.append(connectHero());
  } else {
    wrap.append(identityBar(account));
    const grid = el('div', 'grid');
    const colA = el('div'); colA.style.display = 'flex'; colA.style.flexDirection = 'column'; colA.style.gap = '1.1rem';
    colA.append(signersPanel(account), rulesPanel(account));
    const colB = el('div'); colB.style.display = 'flex'; colB.style.flexDirection = 'column'; colB.style.gap = '1.1rem';
    colB.append(reachPanel(account), simulatePanel(account));
    grid.append(colA, colB);
    wrap.append(grid);
    const stack = el('div'); stack.style.display = 'flex'; stack.style.flexDirection = 'column'; stack.style.gap = '1.1rem'; stack.style.marginTop = '1.1rem';
    stack.append(builderPanel(account), attenuatePanel(account), log());
    wrap.append(stack);
  }
  wrap.append(footer());
  app.append(wrap);
}

render();

// expose for the e2e test / console poking
(window as unknown as { __console: unknown }).__console = { connect, get account() { return account; }, module };
