import { Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const DEFAULT_REFRACTOR_API_URL = 'https://api.refractor.space';
const DEFAULT_REFRACTOR_WEB_URL = 'https://refractor.space';

export interface RefractorTransaction {
  hash: string;
  network: string;
  xdr: string;
  status?: string;
  submitted?: string | boolean;
}

export interface StoreRefractorTransactionArgs {
  xdr: string;
  network?: 'public' | 'testnet';
  submit?: boolean;
  expires?: string | number;
}

export function refractorWebTxUrl(
  hash: string,
  webUrl = DEFAULT_REFRACTOR_WEB_URL,
): string {
  return `${webUrl.replace(/\/+$/, '')}/tx/${hash}`;
}

function apiUrl(path: string, baseUrl = DEFAULT_REFRACTOR_API_URL): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function readJson<T>(resp: Response): Promise<T> {
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    if (!resp.ok) throw new Error(`Refractor HTTP ${resp.status}`);
    throw new Error('Refractor returned non-JSON');
  }
  if (!resp.ok) {
    const msg =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error?: unknown }).error)
        : `Refractor HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return body as T;
}

function assertHash(hash: string): void {
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error(`Invalid Refractor transaction hash: ${hash || '(empty)'}`);
  }
}

/**
 * Refractor is content-addressed by the Stellar transaction hash. Recompute it
 * from the returned XDR and reject a mismatch, so a corrupt or hostile response
 * (or a MITM substitution) fails fast HERE instead of producing an unusable
 * downstream signature. This is a fail-fast integrity layer — the binding that
 * actually prevents a substituted tx from being authorized is enforced on-chain
 * at submit, which anchors to the originator's locally-staged digest.
 */
function assertXdrMatchesHash(xdrBase64: string, network: string, hash: string): void {
  const passphrase = network === 'public' ? Networks.PUBLIC : Networks.TESTNET;
  let computed: string;
  try {
    computed = TransactionBuilder.fromXDR(xdrBase64, passphrase).hash().toString('hex');
  } catch {
    throw new Error('Refractor transaction XDR could not be parsed');
  }
  if (computed.toLowerCase() !== hash.toLowerCase()) {
    throw new Error(
      `Refractor returned a transaction whose hash (${computed}) does not match the requested hash (${hash})`,
    );
  }
}

export async function storeRefractorTransaction(
  args: StoreRefractorTransactionArgs,
  baseUrl = DEFAULT_REFRACTOR_API_URL,
): Promise<RefractorTransaction> {
  const payload: Record<string, unknown> = {
    network: args.network ?? 'testnet',
    xdr: args.xdr,
  };
  if (args.submit === true) payload.submit = true;
  if (args.expires !== undefined && args.expires !== '') payload.expires = args.expires;

  const resp = await fetch(apiUrl('/tx', baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const tx = await readJson<Partial<RefractorTransaction>>(resp);
  if (typeof tx.hash !== 'string') {
    throw new Error('Refractor response did not include a transaction hash');
  }
  assertHash(tx.hash);
  return {
    hash: tx.hash,
    network: typeof tx.network === 'string' ? tx.network : payload.network as string,
    xdr: typeof tx.xdr === 'string' ? tx.xdr : args.xdr,
    status: tx.status,
    submitted: tx.submitted,
  };
}

export async function fetchRefractorTransaction(
  hash: string,
  baseUrl = DEFAULT_REFRACTOR_API_URL,
): Promise<RefractorTransaction> {
  assertHash(hash);
  const resp = await fetch(apiUrl(`/tx/${hash}`, baseUrl), {
    method: 'GET',
    headers: { Accept: 'application/json, text/plain, */*' },
  });
  const tx = await readJson<Partial<RefractorTransaction>>(resp);
  if (typeof tx.hash !== 'string') tx.hash = hash;
  assertHash(tx.hash);
  if (typeof tx.xdr !== 'string') {
    throw new Error('Refractor transaction is missing XDR');
  }
  if (typeof tx.network !== 'string') {
    throw new Error('Refractor transaction is missing network');
  }
  assertXdrMatchesHash(tx.xdr, tx.network, hash);
  return {
    hash: tx.hash,
    network: tx.network,
    xdr: tx.xdr,
    status: tx.status,
    submitted: tx.submitted,
  };
}
