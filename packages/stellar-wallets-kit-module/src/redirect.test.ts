import { describe, it, expect } from 'vitest';
import { resolveReturnRedirect } from './redirect.js';

/**
 * The full-page-redirect fallback assigns the return URL to
 * `window.location.href`. A `javascript:`/`data:`/opaque callback there would
 * execute script in the wallet account's own origin, so the sink must refuse
 * any non-http(s) target regardless of what entry-point validation allowed.
 */
describe('resolveReturnRedirect (navigation sink guard)', () => {
  it('refuses a javascript: callback', () => {
    expect(resolveReturnRedirect('javascript:alert(document.cookie)', '?nido_sign=cancelled')).toBeNull();
  });

  it('refuses data: and other opaque-origin schemes', () => {
    expect(resolveReturnRedirect('data:text/html,<script>alert(1)</script>', '?x=1')).toBeNull();
    expect(resolveReturnRedirect('blob:https://evil.example/abc', '?x=1')).toBeNull();
    expect(resolveReturnRedirect('vbscript:msgbox(1)', '?x=1')).toBeNull();
  });

  it('refuses http on a non-localhost host', () => {
    expect(resolveReturnRedirect('http://dapp.example/cb', '?x=1')).toBeNull();
  });

  it('allows an https callback and merges the result query string', () => {
    expect(resolveReturnRedirect('https://dapp.example/callback', '?nido_signed=abc&kind=tx')).toBe(
      'https://dapp.example/callback?nido_signed=abc&kind=tx',
    );
  });

  it('allows http localhost for dev', () => {
    expect(resolveReturnRedirect('http://localhost:3000/cb', '?x=1')).toBe('http://localhost:3000/cb?x=1');
    expect(resolveReturnRedirect('http://127.0.0.1:4321/cb', '?x=1')).toBe('http://127.0.0.1:4321/cb?x=1');
  });

  // Regression: the dev dApp lives at a `*.localhost` subdomain
  // (`http://dapp.localhost:<port>`), a loopback origin the sink must allow so
  // the full-page-redirect fallback can round-trip the result to it.
  it('allows an http *.localhost subdomain callback for dev', () => {
    expect(resolveReturnRedirect('http://dapp.localhost:4399/cb', '?nido_address=C')).toBe(
      'http://dapp.localhost:4399/cb?nido_address=C',
    );
  });

  it('refuses a malformed URL', () => {
    expect(resolveReturnRedirect('not a url', '?x=1')).toBeNull();
  });
});
