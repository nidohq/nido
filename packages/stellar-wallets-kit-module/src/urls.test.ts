import { describe, it, expect } from 'vitest';
import {
  connectUrl,
  signTransactionUrl,
  signMessageUrl,
  signAuthEntryUrl,
  apexOrigin,
  accountOrigin,
} from './urls.js';

const BASE = 'g2c.example.xyz';
const C = 'CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW';
const DAPP = 'https://dapp.example.com';

describe('apexOrigin', () => {
  it('prefixes https by default', () => {
    expect(apexOrigin(BASE)).toBe('https://g2c.example.xyz');
  });
  it('keeps an explicit scheme', () => {
    expect(apexOrigin('http://localhost:4321')).toBe('http://localhost:4321');
  });
});

describe('accountOrigin', () => {
  it('puts the lowercased C-address as a subdomain of the base', () => {
    expect(accountOrigin(BASE, C)).toBe(`https://${C.toLowerCase()}.g2c.example.xyz`);
  });
  it('throws on an invalid contract id', () => {
    expect(() => accountOrigin(BASE, 'not-a-contract')).toThrow();
  });
  it('encodes a PR-preview base into a single `--pr-N` subdomain level', () => {
    // The dApp-derived base collapses to `pr-34.<apex>` in previews; the
    // account origin must be `<acc>--pr-34.<apex>`, NOT `<acc>.pr-34.<apex>`,
    // so wildcard TLS + the WebAuthn rpId still match.
    expect(accountOrigin('pr-34.mysoroban.xyz', C)).toBe(
      `https://${C.toLowerCase()}--pr-34.mysoroban.xyz`,
    );
  });
  it('preserves an explicit scheme with a PR-preview base', () => {
    expect(accountOrigin('http://pr-7.localhost', C)).toBe(
      `http://${C.toLowerCase()}--pr-7.localhost`,
    );
  });
});

describe('connectUrl', () => {
  it('targets /connect/ at the apex with dapp + return params', () => {
    const u = new URL(connectUrl({ base: BASE, dappOrigin: DAPP, returnUrl: `${DAPP}/cb` }));
    expect(u.origin).toBe('https://g2c.example.xyz');
    expect(u.pathname).toBe('/connect/');
    expect(u.searchParams.get('dapp')).toBe(DAPP);
    expect(u.searchParams.get('return')).toBe(`${DAPP}/cb`);
  });
});

describe('signTransactionUrl', () => {
  it('targets /sign/ at the account subdomain, carrying xdr + scope', () => {
    const u = new URL(
      signTransactionUrl({
        base: BASE,
        account: C,
        xdr: 'AAAA',
        networkPassphrase: 'Test SDF Network ; September 2015',
        dappOrigin: DAPP,
        returnUrl: `${DAPP}/cb`,
      }),
    );
    expect(u.host).toBe(`${C.toLowerCase()}.g2c.example.xyz`);
    expect(u.pathname).toBe('/sign/');
    expect(u.searchParams.get('kind')).toBe('tx');
    expect(u.searchParams.get('xdr')).toBe('AAAA');
    expect(u.searchParams.get('network')).toBe('Test SDF Network ; September 2015');
    expect(u.searchParams.get('dapp')).toBe(DAPP);
    expect(u.searchParams.get('return')).toBe(`${DAPP}/cb`);
  });
});

describe('signMessageUrl', () => {
  it('targets /sign/ with kind=message', () => {
    const u = new URL(
      signMessageUrl({ base: BASE, account: C, message: 'hello', dappOrigin: DAPP, returnUrl: `${DAPP}/cb` }),
    );
    expect(u.host).toBe(`${C.toLowerCase()}.g2c.example.xyz`);
    expect(u.searchParams.get('kind')).toBe('message');
    expect(u.searchParams.get('message')).toBe('hello');
  });
});

describe('signAuthEntryUrl', () => {
  it('targets /sign/ with kind=authEntry', () => {
    const u = new URL(
      signAuthEntryUrl({ base: BASE, account: C, authEntry: 'AAAB', dappOrigin: DAPP, returnUrl: `${DAPP}/cb` }),
    );
    expect(u.searchParams.get('kind')).toBe('authEntry');
    expect(u.searchParams.get('authEntry')).toBe('AAAB');
  });
});
