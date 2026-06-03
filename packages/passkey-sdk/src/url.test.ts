import { describe, it, expect } from 'vitest';
import {
  accountUrl,
  contractIdFromHostname,
  dappPathFromHostname,
  dappUrl,
  nameFromHostname,
  stripSubdomain,
} from './url.js';

const C = 'CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW';

describe('accountUrl', () => {
  it('production: joins contract subdomain to host', () => {
    expect(accountUrl('mysoroban.xyz', C, '/account/')).toBe(
      `//${C.toLowerCase()}.mysoroban.xyz/account/`,
    );
  });

  it('preview from wallet origin (contract--pr-N): uses true apex', () => {
    expect(accountUrl('cabc1234--pr-10.mysoroban.xyz', C, '/account/')).toBe(
      `//${C.toLowerCase()}--pr-10.mysoroban.xyz/account/`,
    );
  });

  it('preview from bare preview root (pr-N): uses apex', () => {
    expect(accountUrl('pr-10.mysoroban.xyz', C, '/account/')).toBe(
      `//${C.toLowerCase()}--pr-10.mysoroban.xyz/account/`,
    );
  });

  // Regression: status-message--pr-24.mysoroban.xyz → the dApp origin in a PR
  // preview deploy. accountUrl previously produced the wallet hostname with
  // a duplicated preview prefix (`<acc>--pr-24.pr-24.mysoroban.xyz`)
  // because `stripSubdomain` preserves the prefix as its own segment for
  // wallet-context usage. The fix derives the apex from `host.split('.').slice(1)`
  // instead, dropping the dApp's first label outright.
  it('preview from a reserved-dApp origin (status-message--pr-N): no duplicate prefix', () => {
    expect(accountUrl('status-message--pr-24.mysoroban.xyz', C, '/security/delegate/')).toBe(
      `//${C.toLowerCase()}--pr-24.mysoroban.xyz/security/delegate/`,
    );
  });

  // Regression: production dApp origin. The session-less status-message sign
  // flow calls accountUrl(window.location.host, …) from `status-message.nido.fyi`.
  // accountUrl previously prepended to the FULL host → `<acc>.status-message.nido.fyi`
  // (a two-label subdomain with no wildcard cert). It must strip to the apex,
  // matching dappUrl, → `<acc>.nido.fyi`.
  it('production from a reserved-dApp origin (status-message): strips to apex', () => {
    expect(accountUrl('status-message.nido.fyi', C, '/')).toBe(
      `//${C.toLowerCase()}.nido.fyi/`,
    );
  });

  it('production from a contract subdomain: strips to apex', () => {
    expect(accountUrl('cabc1234.mysoroban.xyz', C, '/account/')).toBe(
      `//${C.toLowerCase()}.mysoroban.xyz/account/`,
    );
  });
});

describe('stripSubdomain', () => {
  it('drops a contract subdomain', () => {
    expect(stripSubdomain('cabc1234.mysoroban.xyz')).toBe('mysoroban.xyz');
  });
  it('preserves preview prefix as its own segment', () => {
    expect(stripSubdomain('cabc1234--pr-10.mysoroban.xyz')).toBe('pr-10.mysoroban.xyz');
  });
  it('returns the tail when host has no subdomain (no-op on apex is the caller\'s job)', () => {
    // The function always drops the first label. Callers know whether they
    // hold an apex or a subdomain before calling — `accountUrl` doesn't.
    expect(stripSubdomain('mysoroban.xyz')).toBe('xyz');
  });
  it('returns host unchanged when there is only one label', () => {
    expect(stripSubdomain('localhost')).toBe('localhost');
  });
});

describe('contractIdFromHostname', () => {
  it('extracts upper-cased contract id from contract subdomain', () => {
    expect(contractIdFromHostname(`${C.toLowerCase()}.mysoroban.xyz`)).toBe(C);
  });
  it('strips preview suffix', () => {
    expect(contractIdFromHostname(`${C.toLowerCase()}--pr-24.mysoroban.xyz`)).toBe(C);
  });
  it('does not validate — returns the first-label uppercased for any host with >1 label', () => {
    // contractIdFromHostname has no strkey check; isContractId does that.
    // Callers needing validation should pipe the result through isContractId.
    expect(contractIdFromHostname('mysoroban.xyz')).toBe('MYSOROBAN');
  });
  it('returns null when there is no subdomain at all', () => {
    expect(contractIdFromHostname('localhost')).toBe(null);
  });
});

describe('nameFromHostname', () => {
  it('extracts the name subdomain', () => {
    expect(nameFromHostname('alice.mysoroban.xyz')).toBe('alice');
  });
  it('strips preview suffix', () => {
    expect(nameFromHostname('alice--pr-24.mysoroban.xyz')).toBe('alice');
  });
  it('returns null for contract subdomains', () => {
    expect(nameFromHostname(`${C.toLowerCase()}.mysoroban.xyz`)).toBe(null);
  });
  it('returns null for the bare preview root', () => {
    expect(nameFromHostname('pr-24.mysoroban.xyz')).toBe(null);
  });
  it('returns null for reserved dApp subdomains', () => {
    expect(nameFromHostname('status-message.mysoroban.xyz')).toBe(null);
    expect(nameFromHostname('status-message--pr-24.mysoroban.xyz')).toBe(null);
  });
});

describe('dappUrl', () => {
  it('production: builds <dapp>.<apex>/path from a contract subdomain', () => {
    expect(dappUrl(`${C.toLowerCase()}.mysoroban.xyz`, 'status-message', '/?contract=X')).toBe(
      '//status-message.mysoroban.xyz/?contract=X',
    );
  });
  it('production: from the apex itself', () => {
    expect(dappUrl('mysoroban.xyz', 'status-message', '/')).toBe(
      '//status-message.mysoroban.xyz/',
    );
  });
  it('preview: contract subdomain → reserved-dapp subdomain with same prefix', () => {
    expect(dappUrl('cabc1234--pr-24.mysoroban.xyz', 'status-message', '/?contract=X')).toBe(
      '//status-message--pr-24.mysoroban.xyz/?contract=X',
    );
  });
  it('preview: bare preview root → reserved-dapp subdomain', () => {
    expect(dappUrl('pr-24.mysoroban.xyz', 'status-message', '/')).toBe(
      '//status-message--pr-24.mysoroban.xyz/',
    );
  });
});

describe('dappPathFromHostname', () => {
  it('returns path for reserved dApp subdomain', () => {
    expect(dappPathFromHostname('status-message.mysoroban.xyz')).toBe('/status-message/');
  });
  it('handles preview variants', () => {
    expect(dappPathFromHostname('status-message--pr-24.mysoroban.xyz')).toBe('/status-message/');
  });
  it('returns null for non-reserved hosts', () => {
    expect(dappPathFromHostname('alice.mysoroban.xyz')).toBe(null);
    expect(dappPathFromHostname(`${C.toLowerCase()}.mysoroban.xyz`)).toBe(null);
    expect(dappPathFromHostname('mysoroban.xyz')).toBe(null);
  });
});
