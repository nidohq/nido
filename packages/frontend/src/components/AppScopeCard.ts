// One connected app as its scoped document holds it (lib/policy/appScopes
// `appEntries`): its origin, its rules, and the keys that may sign them,
// with what the owner can do about it: remove the app, remove one of its
// keys, or clean up a scope a completed recovery already ended. Also the
// card for an app permission still in the admin document from before apps
// had scopes, with Remove. Pure DOM; the page wires the actions.

import { canonicalJson, type PolicyDoc } from '@nidohq/passkey-sdk';
import { esc } from '../lib/html.js';
import { summarizeDoc } from '../lib/policy/docView.js';
import { renderDocPreviewHtml } from './PolicyInspector.js';
import type { AppEntry } from '../lib/policy/appScopes.js';

export interface AppCardActions {
  onRemoveApp(app: AppEntry): void;
  /** Absent: no per-key removal offered (the security page). */
  onRemoveKey?(app: AppEntry, signerId: string): void;
  onCleanUp(app: AppEntry): void;
}

/** The short form of an app key: the `#k8` its signer id ends with. */
function keyLabel(signerId: string): string {
  const at = signerId.lastIndexOf('#');
  return at < 0 ? signerId : `key ${signerId.slice(at + 1)}`;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ghost sm';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function renderAppCard(app: AppEntry, actions: AppCardActions): HTMLElement {
  const card = document.createElement('article');
  card.className = 'card pol-card';
  card.style.padding = '16px';
  card.dataset.scope = String(app.scope);
  const status = app.live
    ? '<span class="pol-badge primary">Connected</span>'
    : '<span class="pol-badge danger">Ended by recovery</span>';
  card.innerHTML = `
    <header class="pol-head">
      <div style="min-width:0;">
        <span class="section-label">App</span>
        <h3 class="pol-name disp" style="word-break:break-all;">${esc(app.origin ?? 'Unknown app')}</h3>
      </div>
      <div class="pol-badges">${status}<span class="pol-badge">scope ${app.scope}</span></div>
    </header>
    <p class="pol-perm mut" style="font-size:12.5px;">${
      app.live
        ? "This app's own permissions, kept apart from your account's rules. Removing the app removes all of them."
        : 'A recovery of your account ended these permissions; they no longer work. Clean up removes what is left.'
    }</p>`;
  if (app.doc !== null) {
    const preview = document.createElement('div');
    preview.innerHTML = renderDocPreviewHtml(summarizeDoc(app.doc, app.docHash), canonicalJson(app.doc));
    card.append(preview);
  }
  if (app.keys.length > 0) {
    const keys = document.createElement('ul');
    keys.className = 'pol-signers';
    for (const k of app.keys) {
      const li = document.createElement('li');
      li.className = 'pol-signer';
      li.innerHTML = `<span class="pol-signer-ico" aria-hidden="true">${'address' in k.key ? '👤' : '🔑'}</span>
        <span class="pol-signer-label">${esc(keyLabel(k.id))}</span>
        <span class="mut" style="font-size:12px;">${esc(k.rules.join(', '))}</span>`;
      if (app.live && app.keys.length > 1 && actions.onRemoveKey) {
        li.append(button('Remove key', () => actions.onRemoveKey!(app, k.id)));
      }
      keys.append(li);
    }
    card.append(keys);
  }
  const row = document.createElement('div');
  row.className = 'actions';
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';
  row.append(
    app.live
      ? button('Remove app', () => actions.onRemoveApp(app))
      : button('Clean up', () => actions.onCleanUp(app)),
  );
  card.append(row);
  return card;
}

/** One app permission still in the admin document. `movedTo` is the app
 *  origin whose scope already holds the same rule for the same key: the
 *  copy a move left behind. */
export function renderOlderAppRule(
  doc: PolicyDoc,
  rule: PolicyDoc['rules'][number],
  movedTo: string | null,
  onRemove: () => void,
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'card pol-card';
  card.style.padding = '16px';
  card.dataset.olderRule = rule.name;
  const only = { ...doc, rules: [rule] };
  const preview = renderDocPreviewHtml(summarizeDoc(only, ''), canonicalJson(only));
  card.innerHTML = `
    <header class="pol-head">
      <div style="min-width:0;">
        <span class="section-label">${movedTo ? 'Copy left in your admin document' : 'Older app permission (app unknown)'}</span>
        <h3 class="pol-name disp" style="word-break:break-all;">${esc(rule.name)}</h3>
      </div>
      <div class="pol-badges"><span class="pol-badge gated">${movedTo ? 'Moved' : 'Older'}</span></div>
    </header>
    <p class="pol-perm mut" style="font-size:12.5px;">${
      movedTo
        ? `${esc(movedTo)} holds this permission in its own scope now. This copy in your admin document can go.`
        : "An app was given this before apps had their own permissions documents, and which app is not recorded. It moves to its app's own permissions when that app connects again with the same key; until then, Remove ends it."
    }</p>
    ${preview}`;
  const row = document.createElement('div');
  row.className = 'actions';
  row.append(button('Remove', onRemove));
  card.append(row);
  return card;
}
