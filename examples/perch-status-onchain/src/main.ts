// A guided tour: scope a CI key with perch, from a raw keypair to a policy the
// chain enforces. Five acts (pain → relief), styled in Nido's "Warm Nest".
//
//   1 One key, total power        (the problem)
//   2 The account becomes a program (account abstraction)
//   3 OZ gives you the vocabulary  (Signer + ContextRule + policies)
//   4 Nido makes it human          (connect a real account)
//   5 perch: describe · prove · enforce (the payoff — live on testnet)
import { Keypair } from '@stellar/stellar-sdk';
import { reachableCalls, isNarrowing, docHash } from '@nidohq/testkit';
import type { Fn, InvokeOutcome } from './perchOnchain.js';
import { fundedFeeSource, invokeBoardCall } from './perchOnchain.js';
import { ciDoc, OVERBROAD, SCOPED, SIGNERS, RULES, type SignerView, type RuleView, type PolicyKind } from './policyModel.js';
import { CONTRACTS, explorerContract, explorerTx } from './config.js';
import type { xdr } from '@stellar/stellar-sdk';

// ---------- state ----------
const STEPS = [
  { n: 1, label: 'The problem' },
  { n: 2, label: 'Smart account' },
  { n: 3, label: 'OZ model' },
  { n: 4, label: 'Nido' },
  { n: 5, label: 'perch' },
];
const state = {
  step: 1,
  connected: false,
  attnFns: [...OVERBROAD] as string[],
  attnMsg: null as { ok: boolean; text: string } | null,
  feeKp: null as Keypair | null,
  busy: false,
  lastAllowFootprint: undefined as xdr.SorobanTransactionData | undefined,
};

const app = document.getElementById('app')!;
const el = <K extends keyof HTMLElementTagNameMap>(t: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(t);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const G_EXAMPLE = 'GBX...RELEASEBOT'; // illustrative

function go(step: number): void { state.step = step; render(); }

// ---------- brand ----------
function nestRing(size = 30): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke-width="7" stroke-linecap="round"><circle cx="60" cy="60" r="46" stroke="#F25C2A" stroke-dasharray="14 9"/><circle cx="60" cy="60" r="31" stroke="#F5A623" stroke-dasharray="11 8"/></g><circle cx="60" cy="60" r="11" fill="#0E9AA8"/></svg>`;
}

function topbar(): HTMLElement {
  const t = el('div', 'topbar');
  const brand = el('div', 'brand');
  brand.append(el('span', 'mark', nestRing(30)));
  brand.append(el('span', 'word', 'Ni<b>do</b>'));
  brand.append(el('span', 'sep', '·'));
  brand.append(el('span', 'tag', 'perch guided tour'));
  t.append(brand);
  const scen = el('div', 'chip acc');
  scen.innerHTML = '🎯 give CI a key that ships releases, not the treasury';
  t.append(scen);
  return t;
}

function rail(): HTMLElement {
  const r = el('div', 'rail');
  for (const s of STEPS) {
    const st = el('button', 'st' + (s.n === state.step ? ' active' : s.n < state.step ? ' done' : ''));
    st.type = 'button';
    st.append(el('span', 'n', String(s.n)));
    st.append(el('span', 'lbl', s.label));
    st.addEventListener('click', () => go(s.n));
    r.append(st);
  }
  return r;
}

// ---------- act helpers ----------
function actHead(eyebrow: string, h1Html: string, ledeHtml: string): HTMLElement {
  const d = el('div');
  d.append(el('div', 'eyebrow', eyebrow));
  d.append(el('h1', undefined, h1Html));
  d.append(el('p', 'lede', ledeHtml));
  return d;
}
function capItem(cls: string, mark: string, text: string): HTMLElement {
  const li = el('li', cls);
  li.append(el('span', 'mk', mark));
  li.append(el('span', undefined, text));
  return li;
}
function nav(): HTMLElement {
  const n = el('div', 'nav');
  const back = el('button', 'btn ghost', '← Back'); back.type = 'button';
  back.disabled = state.step === 1;
  back.addEventListener('click', () => go(Math.max(1, state.step - 1)));
  n.append(back);
  const next = el('button', 'btn acc', state.step === 5 ? 'Start over ↺' : 'Next →'); next.type = 'button';
  next.addEventListener('click', () => go(state.step === 5 ? 1 : state.step + 1));
  n.append(next);
  return n;
}

// ---------- Act 1 ----------
function act1(): HTMLElement {
  const a = el('div', 'act halo');
  a.append(actHead('The problem', 'One key. Total power over <i>everything</i>.',
    'A Stellar <b>G-address</b> is a single keypair. Whoever holds it can do anything the account can — send every last stroop, hand off ownership, sign any call. There is no "a little bit of authority."'));
  const card = el('div', 'card stack');
  card.append(el('div', 'section-label', 'Hand this key to your release pipeline and it can:'));
  const list = el('ul', 'caplist deny');
  for (const [m, t] of [['✓', 'publish a release'], ['✓', 'move the entire balance'], ['✓', 'change the admin / owner'], ['✓', 'delete history'], ['✓', 'anything the account can — forever']] as const)
    list.append(capItem('', m, t));
  card.append(list);
  card.append((() => { const p = el('div', 'addr'); p.style.marginTop = '.9rem'; p.textContent = `signing key: ${G_EXAMPLE}`; return p; })());
  a.append(card);
  const al = el('div', 'alert danger');
  al.innerHTML = '<span class="ic">▲</span><span>A leaked or misbehaving CI job = a drained treasury. And you can\'t hand back only <i>part</i> of the power. We need scoping.</span>';
  a.append((() => { const w = el('div', 'stack'); w.append(al); return w; })());
  return a;
}

// ---------- Act 2 ----------
function act2(): HTMLElement {
  const a = el('div', 'act');
  a.append(actHead('Account abstraction', 'Move to a <i>smart account</i> and auth becomes code.',
    'A Soroban smart account is a contract — a <b>C-address</b>. Instead of a fixed signature check, it runs your <span class="mono">__check_auth</span> on every call. <b>Your code decides what "authorized" means.</b>'));
  const card = el('div', 'card stack');
  card.append(el('div', 'section-label', 'Every call runs through your account program'));
  const flow = el('div', 'flow');
  flow.append(el('span', 'node mono', 'board.post(…)'));
  flow.append(el('span', 'arw', '→'));
  flow.append(el('span', 'node acc mono', 'account.__check_auth'));
  flow.append(el('span', 'arw', '→'));
  flow.append(el('span', 'node', '✓ allow / ✕ deny'));
  card.append(flow);
  const p = el('p'); p.style.marginTop = '.9rem'; p.style.color = 'var(--ink-soft)';
  p.innerHTML = 'Now you <i>can</i> have several keys with different powers, expiry, and limits. The open question: <b>how do you express those rules — safely?</b>';
  card.append(p);
  a.append(card);
  return a;
}

// ---------- Act 3 ----------
function act3(): HTMLElement {
  const a = el('div', 'act');
  a.append(actHead('OpenZeppelin smart accounts', 'A standard vocabulary: Signers, Rules, Policies.',
    'OZ\'s <span class="mono">stellar-accounts</span> gives the account real structure. Every authorization is a <b>ContextRule</b>.'));
  const g = el('div', 'grid2 stack');
  const anat = el('div', 'card');
  anat.append(el('h3', undefined, 'A ContextRule'));
  anat.append(el('p', 'sub', 'which keys, over what scope, gated by which policies'));
  const r = el('div', 'rule');
  r.append(el('div', 'rn', 'ci-can-publish'));
  const row1 = el('div', 'rrow'); row1.append(el('span', 'rk', 'signers'), el('span', 'chip', 'External · verifier + key'), el('span', 'chip', 'Delegated · another account')); r.append(row1);
  const row2 = el('div', 'rrow'); row2.append(el('span', 'rk', 'scope'), el('span', 'chip acc', 'a contract + function')); r.append(row2);
  const row3 = el('div', 'rrow'); row3.append(el('span', 'rk', 'policies'), el('span', 'chip warn', 'attached contracts — the final say')); r.append(row3);
  anat.append(r);
  g.append(anat);

  const catchCard = el('div', 'card');
  catchCard.append(el('h3', undefined, 'The catch: you write the policy'));
  catchCard.append(el('p', 'sub', 'To say "publish but not admin", you attach a policy — and unless a built-in fits, you write it. In Rust. Deploy it. Audit it.'));
  const code = el('div', 'codebox');
  code.innerHTML = [
    '<span class="c">// a hand-written OZ Policy — you own every line</span>',
    '<span class="k">fn</span> enforce(e, ctx, signers, rule, account) {',
    '  account.require_auth();',
    '  <span class="k">if</span> ctx.fn != <span class="s">"publish"</span> { <span class="b">panic!</span>(<span class="s">"denied"</span>) }',
    '  <span class="k">if</span> ctx.args[1] != account   { <span class="b">panic!</span>(<span class="s">"not self"</span>) }',
    '  <span class="c">// …caps? expiry? multi-sig? all by hand</span>',
    '}',
  ].join('\n');
  catchCard.append(code);
  catchCard.append((() => { const c = el('div', 'codecap'); c.innerHTML = '⚠︎ <b>INV-2 footgun:</b> a deny-bug in a policy on your admin rule can lock you out of your own account. And every policy is new code on the critical path — to audit, per account.'; return c; })());
  g.append(catchCard);
  a.append(g);
  return a;
}

// ---------- Act 4 ----------
function verifierBadge(s: SignerView): HTMLElement {
  const map: Record<SignerView['verifier'], [string, string]> = {
    'secp256r1': ['chip good', 'secp256r1'],
    'ml-dsa-65': ['chip warn', 'ML-DSA-65 · post-quantum'],
    'delegated': ['chip acc', '→ another account'],
  };
  const [cls, txt] = map[s.verifier];
  return el('span', cls, txt);
}
function signerCard(s: SignerView): HTMLElement {
  const c = el('div', 'signer');
  const top = el('div', 'top');
  const left = el('span'); left.style.display = 'flex'; left.style.gap = '.45rem'; left.style.alignItems = 'center';
  left.append(el('span', 'id', s.label), el('span', 'chip', s.kind));
  top.append(left);
  const badge = el('span'); badge.style.display = 'flex'; badge.style.gap = '.3rem'; badge.append(verifierBadge(s));
  if (s.status === 'sim') badge.append(el('span', 'chip', '· sim'));
  top.append(badge);
  c.append(top);
  c.append((() => { const d = el('div', 'addr'); d.style.marginTop = '.45rem'; d.textContent = s.detail; return d; })());
  if (s.note) c.append(el('div', 'note', s.note));
  return c;
}
function act4(): HTMLElement {
  const a = el('div', 'act');
  a.append(actHead('Nido', 'Nido makes smart accounts <i>usable</i>.',
    'Passkeys instead of seed phrases, a factory, social recovery, and a path from your old G-address. A Nido account holds <b>keys across verifiers</b> — even a post-quantum one — and can <b>delegate</b> to another account.'));
  const card = el('div', 'card stack');
  if (!state.connected) {
    card.append(el('div', 'section-label', 'Connect the account'));
    card.append((() => { const p = el('p', 'sub'); p.textContent = 'A local-key Nido account — no passkey ceremony, no seed.'; return p; })());
    const b = el('button', 'btn acc', 'Connect Nido account'); b.type = 'button'; b.id = 'connect';
    b.addEventListener('click', () => { state.connected = true; render(); });
    card.append(b);
  } else {
    card.append(el('div', 'section-label', 'Nido smart account'));
    const link = el('a', 'addr'); link.href = explorerContract(CONTRACTS.account); link.target = '_blank'; link.textContent = CONTRACTS.account;
    card.append(link);
    card.append((() => { const l = el('div', 'section-label'); l.style.marginTop = '.4rem'; l.textContent = 'Signers — one per verifier'; return l; })());
    const grid = el('div', 'sig');
    for (const s of SIGNERS) grid.append(signerCard(s));
    card.append(grid);
    const ex = el('p', 'sub');
    ex.innerHTML = '<b>External</b> signers carry a key a verifier contract checks (secp256r1 passkeys, post-quantum ML-DSA). <b>Delegated</b> signers point at <b>another account</b> that authorizes for you — a co-signer, recovery, a treasury.';
    card.append(ex);
    const note = el('div', 'alert info');
    note.innerHTML = '<span class="ic">➜</span><span>Keys across verifiers, a delegated treasury. But scoping the CI key — the problem from Act 3 — is still on you. <b>That\'s perch.</b></span>';
    card.append(note);
  }
  a.append(card);
  return a;
}

// ---------- Act 5 ----------
function reachRows(fns: string[]): HTMLElement {
  const doc = ciDoc(fns);
  const reach = reachableCalls(doc);
  const wrap = el('div');
  for (const rs of reach) {
    const row = el('div', 'rrow');
    row.append(el('span', 'chip', rs.rule));
    row.append(el('span', 'arw', '→'));
    row.append(el('span', 'chip acc', rs.scope === 'self-admin' ? 'self-admin' : short(rs.scope)));
    if (rs.functions.kind === 'any') row.append(el('span', 'chip', 'any function'));
    else for (const f of rs.functions.functions) row.append(el('span', 'chip good', `${f}()`));
    wrap.append(row);
  }
  return wrap;
}

function ptypeBadge(p: PolicyKind): HTMLElement {
  const map: Record<PolicyKind, [string, string]> = {
    'policy-free': ['chip', 'policy-free'],
    'perch': ['chip acc', 'perch interpreter'],
    'spending-limit': ['chip warn', 'OZ spending-limit'],
  };
  const [cls, txt] = map[p];
  return el('span', cls, txt);
}
function ruleCard(r: RuleView): HTMLElement {
  const clsMap: Record<PolicyKind, string> = { 'policy-free': 'free', 'perch': 'perch', 'spending-limit': 'cap' };
  const c = el('div', `rule ${clsMap[r.policy]}${r.status === 'sim' ? ' sim' : ''}`);
  const head = el('div'); head.style.display = 'flex'; head.style.justifyContent = 'space-between'; head.style.alignItems = 'center'; head.style.gap = '.5rem';
  head.append(el('span', 'rn', r.name));
  if (r.onchain) head.append(el('span', 'on-mark', 'on-chain'));
  else if (r.status === 'sim') head.append(el('span', 'chip', '· sim'));
  c.append(head);
  const row1 = el('div', 'rrow'); row1.append(el('span', 'rk', 'signers'));
  for (const s of r.signers) row1.append(el('span', 'chip', s));
  row1.append(el('span', 'chip acc', r.scope));
  c.append(row1);
  const row2 = el('div', 'rrow'); row2.append(el('span', 'rk', 'policy'), ptypeBadge(r.policy)); c.append(row2);
  const reach = el('div', 'reach'); reach.innerHTML = `reaches <b>${r.reach}</b>`; c.append(reach);
  return c;
}
function act5(): HTMLElement {
  const a = el('div', 'act');
  a.append(actHead('perch', '<i>Describe</i> the policy. Prove it\'s safe. Watch it enforce.',
    'perch is a policy you write as <b>data</b>, compiled to one tiny interpreter that\'s audited once. No per-account Rust. And the same <span class="mono">doc_hash</span> you review is the program the chain runs.'));

  // full policy view — perch composed with OZ-native policies
  const pol = el('div', 'card stack');
  pol.append(el('h3', undefined, 'The account\'s full policy'));
  pol.append(el('p', 'sub', 'Several rules. perch handles function/arg scoping (the CI rule); it composes with OZ-native policies — a spend cap on the treasury, policy-free admin (INV-2), a post-quantum co-signer.'));
  const rl = el('div', 'rulelist');
  for (const r of RULES) rl.append(ruleCard(r));
  pol.append(rl);
  a.append(pol);

  // 5a describe
  const d1 = el('div', 'card stack');
  d1.append(el('h3', undefined, '① Describe it — and see the scope'));
  d1.append(el('p', 'sub', 'A PolicyDoc, not a contract. Reachable-calls shows exactly what the CI key can touch.'));
  const doc = ciDoc(state.attnFns);
  const jsonView = el('div', 'codebox');
  jsonView.innerHTML = [
    '{ <span class="k">"signer"</span>: <span class="s">"ci"</span>, <span class="k">"scope"</span>: <span class="s">"board"</span>,',
    `  <span class="k">"functions"</span>: [${state.attnFns.map((f) => `<span class="s">"${f}"</span>`).join(', ')}],`,
    '  <span class="k">"args"</span>: [{ <span class="k">"index"</span>: 1, <span class="k">"is"</span>: <span class="s">"self"</span> }] }',
  ].join('\n');
  d1.append(jsonView);
  d1.append(el('div', 'section-label', 'Reachable calls'));
  d1.append(reachRows(state.attnFns));
  const dh = el('div', 'addr'); dh.style.marginTop = '.7rem'; dh.textContent = `doc_hash ${docHash(doc)}`;
  d1.append(dh);
  if (state.attnFns.length > 1) {
    const warn = el('div', 'alert warn'); warn.innerHTML = '<span class="ic">▲</span><span>This grant is <b>too broad</b> — CI can also <span class="mono">clear</span> (wipe history). Let\'s narrow it.</span>';
    d1.append(warn);
  }
  a.append(d1);

  // 5b attenuate
  const d2 = el('div', 'card stack');
  d2.append(el('h3', undefined, '② Narrow it — safely'));
  d2.append(el('p', 'sub', 'Attenuation is a machine-checked subset: perch accepts a narrowing and refuses a widening.'));
  const btns = el('div'); btns.style.display = 'flex'; btns.style.gap = '.6rem'; btns.style.flexWrap = 'wrap';
  const narrow = el('button', 'btn sm acc', 'Narrow → publish-only'); narrow.type = 'button'; narrow.id = 'narrow';
  narrow.disabled = state.attnFns.length <= 1;
  narrow.addEventListener('click', () => {
    const check = isNarrowing(ciDoc(state.attnFns), ciDoc(SCOPED));
    if (check.ok) { state.attnFns = [...SCOPED]; state.attnMsg = { ok: true, text: 'Verified narrowing — reachable(child) ⊆ reachable(parent). doc_hash updated.' }; }
    else state.attnMsg = { ok: false, text: check.reason ?? 'refused' };
    render();
  });
  const widen = el('button', 'btn sm ghost', 'Try to widen → add set_admin'); widen.type = 'button'; widen.id = 'widen';
  widen.addEventListener('click', () => {
    const check = isNarrowing(ciDoc(state.attnFns), ciDoc([...state.attnFns, 'set_admin']));
    state.attnMsg = check.ok ? { ok: true, text: 'widened' } : { ok: false, text: `Refused — not a narrowing. ${check.reason ?? 'adds set_admin()'}. The grant is unchanged.` };
    render();
  });
  btns.append(narrow, widen);
  d2.append(btns);
  if (state.attnMsg) {
    const al = el('div', `alert ${state.attnMsg.ok ? 'good' : 'danger'}`);
    al.innerHTML = `<span class="ic">${state.attnMsg.ok ? '✓' : '✕'}</span><span>${state.attnMsg.text}</span>`;
    d2.append(al);
  }
  a.append(d2);

  // 5c enforce on-chain
  const d3 = el('div', 'card stack');
  d3.append(el('h3', undefined, '③ Enforce it — on real testnet'));
  d3.append(el('p', 'sub', 'The scoped policy is deployed on-chain. Drive the CI key for real — the perch interpreter says yes or no.'));
  const row = el('div', 'grid2');
  row.append(oncard('post', 'Publish a release', 'In policy — the CI key may post(message, self).', 'btn acc', 'Publish → expect ALLOW'));
  row.append(oncard('clear', 'Wipe history', 'Out of policy — perch refuses clear(self).', 'btn ghost', 'Wipe → expect DENY'));
  d3.append(row);
  a.append(d3);

  // payoff
  const pay = el('div', 'bn stack');
  const before = el('div', 'col');
  before.innerHTML = '<div class="eyebrow">Hand-written policy</div><ul><li><b>Rust per account</b> — write, deploy, audit each one.</li><li><b>INV-2 footgun</b> — a deny-bug can brick admin.</li><li><b>Opaque</b> — no proof of what a key can reach.</li><li><b>Trust</b> that a change didn\'t widen power.</li></ul>';
  const now = el('div', 'col now');
  now.innerHTML = '<div class="eyebrow">With perch</div><ul><li><b>Data, not code</b> — one interpreter, audited once.</li><li><b>Safe by construction</b> — INV-1/INV-2, fail-closed.</li><li><b>Analyzable</b> — reachable-calls answers "can it ever?"</li><li><b>Attenuation is proof</b> — narrowing is machine-checked.</li><li><b>doc_hash = what enforces</b> — no drift, on-chain.</li></ul>';
  pay.append(before, now);
  a.append(pay);
  return a;
}

function oncard(fn: Fn, title: string, desc: string, btnCls: string, btnLabel: string): HTMLElement {
  const c = el('div', 'card');
  c.append(el('h3', undefined, title));
  c.append(el('p', 'sub', desc));
  const b = el('button', btnCls, btnLabel); b.type = 'button'; b.id = `on-${fn}`;
  b.disabled = state.busy;
  b.addEventListener('click', () => runOnchain(fn));
  c.append(b);
  c.append((() => { const s = el('div'); s.id = `res-${fn}`; s.style.marginTop = '.7rem'; return s; })());
  return c;
}

async function runOnchain(fn: Fn): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  setOnResult(fn, 'info', ['Preparing…']);
  const setBtns = (d: boolean) => { for (const f of ['post', 'clear']) { const b = document.getElementById(`on-${f}`) as HTMLButtonElement | null; if (b) b.disabled = d; } };
  setBtns(true);
  try {
    if (!state.feeKp) { setOnResult(fn, 'info', ['Funding an ephemeral fee account (friendbot)…']); state.feeKp = await fundedFeeSource(); }
    const msg = fn === 'post' ? 'shipped v1.0.0 via a perch-scoped CI key' : null;
    const reuse = fn === 'clear' ? state.lastAllowFootprint : undefined;
    const out: InvokeOutcome = await invokeBoardCall(state.feeKp, fn, msg, reuse, (s) => setOnResult(fn, 'info', [s]));
    if (fn === 'post' && out.ok) state.lastAllowFootprint = out.sorobanData;
    if (out.ok) setOnResult(fn, 'good', ['✓ Authorized on-chain — perch enforce returned.', txLink(out.hash)]);
    else setOnResult(fn, 'danger', [`✕ Denied on-chain — ${out.reason ?? 'refused'}`, out.hash ? txLink(out.hash) : '(rejected at enforcing simulation — the chain\'s __check_auth verdict)']);
  } catch (e) {
    setOnResult(fn, 'danger', [`Error: ${(e as Error).message}`]);
  } finally {
    state.busy = false;
    setBtns(false);
  }
}

function txLink(hash?: string): HTMLElement {
  if (!hash) return el('span', undefined, 'submitted');
  const a = el('a'); (a as HTMLAnchorElement).href = explorerTx(hash); (a as HTMLAnchorElement).target = '_blank';
  a.className = 'mono'; a.textContent = `tx ${short(hash)} ↗`;
  return a;
}
function setOnResult(fn: Fn, kind: 'good' | 'danger' | 'info', lines: (string | HTMLElement)[]): void {
  const slot = document.getElementById(`res-${fn}`); if (!slot) return;
  const al = el('div', `alert ${kind}${kind === 'danger' ? ' shake' : ''}`);
  const body = el('span');
  lines.forEach((l, i) => { if (i) body.append(el('br')); body.append(typeof l === 'string' ? document.createTextNode(l) : l); });
  al.append(el('span', 'ic', kind === 'good' ? '✓' : kind === 'danger' ? '✕' : '·'), body);
  slot.replaceChildren(al);
}

// ---------- render ----------
const ACTS: Record<number, () => HTMLElement> = { 1: act1, 2: act2, 3: act3, 4: act4, 5: act5 };
function render(): void {
  app.replaceChildren();
  const stage = el('div', 'stage');
  stage.append(topbar(), rail());
  stage.append(ACTS[state.step]!());
  stage.append(nav());
  app.append(stage);
}
render();
(window as unknown as { __tour: unknown }).__tour = { go, state };
