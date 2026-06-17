import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';
import {
  Account,
  Asset,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  fetchRefractorTransaction,
  refractorWebTxUrl,
  storeRefractorTransaction,
} from './refractorClient';

const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SRC_G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const DEST_G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));

/** A real, parseable testnet transaction plus its (content-addressing) hash.
 *  Vary `amount` to get a distinct tx/hash — handy for the substitution test. */
function realTx(amount = '1'): { xdr: string; hash: string } {
  const tx = new TransactionBuilder(new Account(SRC_G, '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({ destination: DEST_G, asset: Asset.native(), amount }),
    )
    .setTimeout(0)
    .build();
  return { xdr: tx.toXDR(), hash: tx.hash().toString('hex') };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('refractorClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores a testnet transaction with the Refractor API shape', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ hash: HASH, network: 'testnet', xdr: 'AAAA' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tx = await storeRefractorTransaction({ xdr: 'AAAA' }, 'https://api.test');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/tx',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ network: 'testnet', xdr: 'AAAA' }),
      }),
    );
    expect(tx.hash).toBe(HASH);
    expect(tx.xdr).toBe('AAAA');
  });

  it('fetches a transaction by hash', async () => {
    const real = realTx();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ hash: real.hash, network: 'testnet', xdr: real.xdr }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tx = await fetchRefractorTransaction(real.hash, 'https://api.test/');

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.test/tx/${real.hash}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(tx).toMatchObject({ hash: real.hash, network: 'testnet', xdr: real.xdr });
  });

  it('rejects a fetched transaction whose XDR does not match the requested hash', async () => {
    // Server returns a DIFFERENT (but valid) transaction under the requested
    // hash — a corrupt/hostile Refractor or a MITM substitution. The client
    // recomputes the content hash and must reject the mismatch.
    const requested = realTx('1');
    const substituted = realTx('2');
    const fetchMock = vi.fn(async () =>
      jsonResponse({ hash: requested.hash, network: 'testnet', xdr: substituted.xdr }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchRefractorTransaction(requested.hash, 'https://api.test'),
    ).rejects.toThrow(/does not match the requested/i);
  });

  it('rejects a fetched transaction whose XDR cannot be parsed', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ hash: HASH, network: 'testnet', xdr: 'not-valid-xdr' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRefractorTransaction(HASH, 'https://api.test')).rejects.toThrow(
      /could not be parsed/i,
    );
  });

  it('rejects malformed hashes before calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRefractorTransaction('not-a-hash')).rejects.toThrow(/invalid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the public Refractor tx URL', () => {
    expect(refractorWebTxUrl(HASH, 'https://refractor.test/')).toBe(
      `https://refractor.test/tx/${HASH}`,
    );
  });
});
