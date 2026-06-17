import { describe, it, expect } from 'vitest';
import {
  connectUrl,
  signTransactionUrl,
  signMessageUrl,
  signAuthEntryUrl,
  apexOrigin,
  accountOrigin,
} from './urls.js';

const BASE = 'nido.example.xyz';
const C = 'CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW';
const DAPP = 'https://dapp.example.com';

describe('apexOrigin', () => {
  it('prefixes https by default', () => {
    expect(apexOrigin(BASE)).toBe('https://nido.example.xyz');
  });
  it('keeps an explicit scheme', () => {
    expect(apexOrigin('http://localhost:4321')).toBe('http://localhost:4321');
  });
});

describe('accountOrigin', () => {
  it('puts the lowercased C-address as a subdomain of the base', () => {
    expect(accountOrigin(BASE, C)).toBe(`https://${C.toLowerCase()}.nido.example.xyz`);
  });
  it('throws on an invalid contract id', () => {
    expect(() => accountOrigin(BASE, 'not-a-contract')).toThrow();
  });
  it('encodes a numeric PR-preview base into a single-level account origin', () => {
    expect(accountOrigin('34.mysoroban.xyz', C)).toBe(
      `https://${C.toLowerCase()}--34.mysoroban.xyz`,
    );
  });
  it('accepts a legacy pr-N preview base but emits numeric account origins', () => {
    expect(accountOrigin('pr-34.mysoroban.xyz', C)).toBe(
      `https://${C.toLowerCase()}--34.mysoroban.xyz`,
    );
  });
  it('preserves an explicit scheme with a PR-preview base', () => {
    expect(accountOrigin('http://7.localhost', C)).toBe(
      `http://${C.toLowerCase()}--7.localhost`,
    );
  });
});

describe('preview signing URLs', () => {
  it('use the full account id in the numeric preview host', () => {
    const u = new URL(
      signTransactionUrl({
        base: '100.mysoroban.xyz',
        account: C,
        xdr: 'AAAA',
        dappOrigin: DAPP,
        returnUrl: `${DAPP}/cb`,
      }),
    );
    expect(u.host).toBe(`${C.toLowerCase()}--100.mysoroban.xyz`);
    expect(u.searchParams.get('account')).toBeNull();
  });
});

describe('connectUrl', () => {
  it('targets /connect/ at the apex with dapp + return params', () => {
    const u = new URL(connectUrl({ base: BASE, dappOrigin: DAPP, returnUrl: `${DAPP}/cb` }));
    expect(u.origin).toBe('https://nido.example.xyz');
    expect(u.pathname).toBe('/connect/');
    expect(u.searchParams.get('dapp')).toBe(DAPP);
    expect(u.searchParams.get('return')).toBe(`${DAPP}/cb`);
    expect(u.searchParams.get('previous')).toBeNull();
  });
  it('carries the previously connected address when provided', () => {
    const u = new URL(
      connectUrl({ base: BASE, dappOrigin: DAPP, returnUrl: `${DAPP}/cb`, previous: C }),
    );
    expect(u.searchParams.get('previous')).toBe(C);
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
    expect(u.host).toBe(`${C.toLowerCase()}.nido.example.xyz`);
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
    expect(u.host).toBe(`${C.toLowerCase()}.nido.example.xyz`);
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
