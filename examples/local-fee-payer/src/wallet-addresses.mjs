import { StrKey } from '@stellar/stellar-sdk';

// The two classic accounts a finished setup leaves the user with. U stands in
// for the permanent G: this lab funds U as the demo treasury, and the
// permanent-G account mode (README "Architecture slides") is not implemented.
export function walletAddresses(profile) {
  const rows = [
    { id: 'g', label: 'G · test-only U account', note: 'Demo treasury. It stands in for your permanent G address, which this preview does not implement yet.', address: profile.u },
    { id: 'f', label: 'F · fee account', note: 'Pays network fees. Its key stays encrypted in this wallet.', address: profile.fee },
  ];
  for (const row of rows) if (!StrKey.isValidEd25519PublicKey(row.address)) throw Error(`Invalid ${row.id.toUpperCase()} address`);
  return rows;
}

export function renderWalletAddresses(container, profile, copy = text => navigator.clipboard.writeText(text)) {
  const doc = container.ownerDocument;
  const list = container.querySelector('dl');
  list.replaceChildren();
  for (const { id, label, note, address } of walletAddresses(profile)) {
    const term = doc.createElement('dt'), value = doc.createElement('dd'), code = doc.createElement('code'), button = doc.createElement('button'), hint = doc.createElement('p');
    term.textContent = label;
    code.id = `address-${id}`; code.textContent = address;
    button.type = 'button'; button.className = 'copy'; button.textContent = 'Copy';
    button.setAttribute('aria-label', `Copy ${label}`);
    button.onclick = async () => {
      try { await copy(address); button.textContent = 'Copied'; }
      catch { doc.getSelection()?.selectAllChildren(code); button.textContent = 'Selected · press copy'; }
    };
    hint.className = 'small'; hint.textContent = note;
    value.append(code, button, hint);
    list.append(term, value);
  }
  container.hidden = false;
}
