import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedBank, withRetry, FRIENDBOT_URL } from '../../support/testnet';
import { credentialFor } from '../../support/auth/seed';
import { credentialIdForLabel, privateKeyForCredentialId } from '../../support/auth/vault';
import { buildSyntheticAssertion } from '../../../packages/passkey-sdk/src/syntheticAssertion';
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  encodeMuxedAccountToAddress,
  hash,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const PORT = Number(process.env.E2E_PORT || 4399);
const DAPP = `http://dapp.localhost:${PORT}`;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const RELAYER_URL = process.env.G2C_RELAYER_URL || 'https://nido.fly.dev';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** Deployed spending-limit policy wrapper (DEPLOYED.md; registered as
 *  `unverified/spending-limit-policy` — the delegate page resolves it via the
 *  registry, we only need the literal to assert the rule actually carries it). */
const POLICY = 'CCJMCPGADKMVKYOIZXMV7UWH62XYDAIT6GJRNJPQSZ2CHPOF4K2AU2QC';

/** The relayer's public fund address — guaranteed on-chain, used ONLY as a
 *  recording-mode simulation source (mirrors the dApp's TIP_SIM_SOURCE in
 *  examples/status-message-dapp/src/lib/nidoSign.ts). It never signs and never
 *  pays here; the relayer's channel accounts source the real transaction. */
const SIM_SOURCE = 'GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2';

/** Native-XLM Stellar Asset Contract on testnet — the contract the tipping
 *  session key is scoped to (the spending-limit policy meters SAC `transfer`). */
const XLM_SAC = Asset.native().contractId(Networks.TESTNET);

/** 0.5 XLM/day limit; 0.2 XLM tip fits, a further 0.4 XLM (cumulative 0.6)
 *  must be rejected by the policy with Error(Contract, #3221)
 *  (SpendingLimitError::SpendingLimitExceeded in OZ rev 637c53a). */
const LIMIT_XLM = '0.5';
const TIP_1_STROOPS = 2_000_000n; // 0.2 XLM
const TIP_2_STROOPS = 4_000_000n; // 0.4 XLM

const enc = encodeURIComponent;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Simulate-only view call against `contractId` (Node-side, dummy source). */
async function simulateView(
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal> {
  const server = new rpc.Server(RPC_URL);
  const source = new Account(DUMMY_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(
      `simulateView ${method}: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`,
    );
  }
  const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result) throw new Error(`simulateView ${method}: no result`);
  return result.retval;
}

/** Decode the bytes a raw-`scValToNative` External signer hands back (it may
 *  arrive as Uint8Array, a number[], or an object with numeric keys). Copied
 *  from session-key.testnet.spec.ts. */
function bytesToHex(raw: unknown): string | null {
  if (raw instanceof Uint8Array) {
    return Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (Array.isArray(raw)) {
    return (raw as number[]).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, number>;
    const ordered: number[] = [];
    for (let j = 0; obj[j as unknown as string] !== undefined; j++) {
      ordered.push(obj[j as unknown as string]);
    }
    if (ordered.length > 0) {
      return ordered.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  return null;
}

/**
 * Node-side mirror of the frontend's `findRuleForPubkey` (see
 * session-key.testnet.spec.ts for why this is inlined rather than importing
 * the `@g2c/passkey-sdk` barrel). Extended for this spec to also return the
 * rule's `policies` (Vec<Address> on the OZ ContextRule) so we can prove the
 * spending-limit policy is attached to the installed rule.
 */
async function findRuleForPubkey(
  account: string,
  pubkeyHex: string,
): Promise<{ ruleId: number; verifier: string; contextType: string; policies: string[] } | null> {
  const countRv = await simulateView(account, 'get_context_rules_count');
  const count = scValToNative(countRv) as number;
  const lowerHex = pubkeyHex.toLowerCase();

  for (let i = 0; i < count; i++) {
    const ruleRv = await simulateView(
      account,
      'get_context_rule',
      nativeToScVal(i, { type: 'u32' }),
    );
    const native = scValToNative(ruleRv) as {
      id?: number;
      signers?: unknown[];
      context_type?: unknown;
      policies?: unknown[];
    };
    for (const s of native.signers ?? []) {
      // ["External", verifier, pubkey_bytes]
      if (Array.isArray(s) && s[0] === 'External') {
        const candidateHex = bytesToHex(s[2]);
        if (candidateHex && candidateHex.toLowerCase() === lowerHex) {
          const ct = native.context_type;
          return {
            ruleId: native.id ?? i,
            verifier: String(s[1]),
            contextType: Array.isArray(ct) ? ct.map((v) => String(v)).join(':') : String(ct),
            policies: Array.from(native.policies ?? []).map((p) => String(p)),
          };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Relayer client (inlined — mirrors scripts/relayer-proof.mjs / the SDK's
// relayer.ts, but returns the RAW response body so the over-limit rejection
// can be captured verbatim as proof, not just as a thrown Error message).
// ---------------------------------------------------------------------------

interface RelayerRaw {
  httpStatus: number;
  body: {
    success?: boolean;
    error?: string | null;
    data?: { code?: string; details?: unknown; result?: Record<string, unknown> } & Record<
      string,
      unknown
    >;
  };
}

async function relayerCall(params: Record<string, unknown>): Promise<RelayerRaw> {
  const resp = await fetch(`${RELAYER_URL}/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params }),
  });
  let body: RelayerRaw['body'];
  try {
    body = ((await resp.json()) ?? {}) as RelayerRaw['body'];
  } catch {
    throw new Error(`relayer returned non-JSON (HTTP ${resp.status})`);
  }
  return { httpStatus: resp.status, body };
}

/** Unwrap the Channels-plugin payload nesting ({data} or {data:{result}}). */
function relayerPayload(raw: RelayerRaw): { transactionId?: string; hash?: string; status?: string } {
  const data = raw.body.data;
  const payload = (data && typeof data === 'object' && data.result ? data.result : data) ?? {};
  return payload as { transactionId?: string; hash?: string; status?: string };
}

// ---------------------------------------------------------------------------
// Session-key signing of a SAC transfer auth entry (Node-side).
//
// Mirrors the dApp's tipAuthorInPage (examples/status-message-dapp/src/lib/
// nidoSign.ts) end to end, but signs with the synthetic P-256 session key
// directly instead of running the WebAuthn ceremony in a browser — the same
// substitution the Rust integration tests make. The XDR construction below is
// a line-for-line mirror of `buildAuthHashAt` / `computeAuthDigest` /
// `injectPasskeySignature` in packages/passkey-sdk/src/auth.ts (inlined for
// the same barrel-import reason as findRuleForPubkey above).
// ---------------------------------------------------------------------------

async function buildSignedTransfer(opts: {
  account: string; // the smart account (auth author / `from`)
  to: string; // tip recipient
  stroops: bigint;
  ruleId: number;
  verifier: string;
  sessionPubkey: Uint8Array; // 65-byte SEC1 uncompressed
  sessionPriv: Uint8Array; // P-256 scalar
}): Promise<{ func: string; authXdr: string; latestLedger: number }> {
  const server = new rpc.Server(RPC_URL);

  // Recording-mode simulation: source = the relayer's public fund address
  // (NOT the smart account — a foreign source makes the account's auth record
  // as signable sorobanCredentialsAddress; see relayer-proof.mjs step 3).
  const source = await server.getAccount(SIM_SOURCE);
  const op = new Contract(XLM_SAC).call(
    'transfer',
    Address.fromString(opts.account).toScVal(),
    Address.fromString(opts.to).toScVal(),
    nativeToScVal(opts.stroops, { type: 'i128' }),
  );
  const simTx = new TransactionBuilder(source, {
    fee: '10000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(simTx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`transfer simulation failed: ${sim.error}`);
  }
  const success = sim as rpc.Api.SimulateTransactionSuccessResponse;
  const auth = success.result?.auth ?? [];
  if (auth.length !== 1) {
    throw new Error(`expected exactly 1 recorded auth entry, got ${auth.length}`);
  }
  const entry = auth[0];
  if (entry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
    throw new Error(`auth entry has ${entry.credentials().switch().name} credentials`);
  }
  const creds = entry.credentials().address();
  const authorizer = Address.fromScAddress(creds.address()).toString();
  if (authorizer !== opts.account) {
    throw new Error(`auth entry authorizes ${authorizer}, expected ${opts.account}`);
  }

  // signature_payload = sha256(HashIdPreimage(sorobanAuthorization)) over the
  // ABSOLUTE expiration ledger we also write into the credentials.
  const expirationLedger = success.latestLedger + 600;
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(Networks.TESTNET, 'utf-8')),
      nonce: xdr.Int64.fromString(creds.nonce().toString()),
      signatureExpirationLedger: expirationLedger,
      invocation: entry.rootInvocation(),
    }),
  );
  const signaturePayload = hash(preimage.toXDR());

  // OZ v0.7 auth digest: sha256(signature_payload || context_rule_ids.to_xdr()).
  const ctxIdsXdr = xdr.ScVal.scvVec([xdr.ScVal.scvU32(opts.ruleId)]).toXDR();
  const authDigest = hash(Buffer.concat([signaturePayload, ctxIdsXdr]));

  // Synthetic WebAuthn assertion over the digest with the session key — the
  // exact assertion shape the on-chain webauthn verifier accepts (same helper
  // the shim authenticator uses; signature already compact r||s low-S).
  const assertion = await buildSyntheticAssertion(opts.sessionPriv, new Uint8Array(authDigest));

  // WebAuthnSigData { authenticator_data, client_data, signature } — ScMap
  // with symbol keys in lexicographic order.
  const sigDataBytes = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('authenticator_data'),
      val: xdr.ScVal.scvBytes(Buffer.from(assertion.authenticatorData)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('client_data'),
      val: xdr.ScVal.scvBytes(Buffer.from(assertion.clientDataJSON)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signature'),
      val: xdr.ScVal.scvBytes(Buffer.from(assertion.signature)),
    }),
  ]).toXDR();

  // AuthPayload { context_rule_ids, signers: Map<Signer::External, Bytes> }.
  const signerScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    Address.fromString(opts.verifier).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(opts.sessionPubkey)),
  ]);
  creds.signatureExpirationLedger(expirationLedger);
  creds.signature(
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('context_rule_ids'),
        val: xdr.ScVal.scvVec([xdr.ScVal.scvU32(opts.ruleId)]),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signers'),
        val: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: signerScVal, val: xdr.ScVal.scvBytes(sigDataBytes) }),
        ]),
      }),
    ]),
  );

  const func = simTx
    .toEnvelope()
    .v1()
    .tx()
    .operations()[0]
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .toXDR('base64');
  return { func, authXdr: entry.toXDR('base64'), latestLedger: success.latestLedger };
}

/** Decode an xdr.MuxedAccount → address (+ ed25519 base), from relayer-proof.mjs. */
function describeMuxed(muxed: xdr.MuxedAccount): { address: string; baseAddress: string } {
  const address = encodeMuxedAccountToAddress(muxed);
  const baseAddress =
    muxed.switch() === xdr.CryptoKeyType.keyTypeMuxedEd25519()
      ? StrKey.encodeEd25519PublicKey(muxed.med25519().ed25519())
      : address;
  return { address, baseAddress };
}

/**
 * @testnet — END-TO-END PROOF for #72 (session-key scope UI, PR 2):
 *
 *  1. A session-key rule WITH A SPENDING LIMIT (0.5 XLM/day) is installed
 *     through the REAL `/security/delegate/` page (limit suggested via the new
 *     `limit`/`limit_period` URL params, approved with the primary passkey).
 *  2. An in-limit 0.2 XLM tip-style `SAC.transfer(account → author)` signed by
 *     the SESSION key lands GASLESSLY through the relayer (fee-bump, channel
 *     source) — hash + on-chain decode recorded.
 *  3. A second 0.4 XLM tip (cumulative 0.6 > 0.5) is REJECTED with the
 *     spending-limit policy's Error(Contract, #3221) — rejection body recorded
 *     verbatim.
 */
test.describe('@testnet spending-limit session key: delegate-page install + relayer tips', () => {
  test.describe.configure({ timeout: 480_000 });

  test('installs a 0.5 XLM/day session rule, lands a 0.2 XLM tip via relayer, rejects 0.4 XLM over-limit', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const annotate = (type: string, description: string) => {
      console.log(`[proof] ${type}: ${description}`);
      test.info().annotations.push({ type, description });
    };

    // -----------------------------------------------------------------
    // PART A — create + deploy a fresh smart account (send-to-name pattern)
    // -----------------------------------------------------------------
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#get-started-hero').click();
    await expect(page.locator('[data-mynido]')).toHaveClass(/mynido-open/);
    await page.locator('.mn-create-btn').click();
    await page.waitForURL(/\/new-account\/\?key=/, { timeout: 60_000 });
    const host = new URL(page.url()).host;
    const cAddress = host.split('.')[0].toUpperCase();
    expect(cAddress).toMatch(/^C[A-Z2-7]{55}$/);
    await page.locator('#register-btn').click();
    await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });
    annotate('cAddress', cAddress);

    // -----------------------------------------------------------------
    // PART B — the dApp's session keypair (deterministic, Node-side). The
    // private half signs the tips below; only the public half goes on-chain.
    // -----------------------------------------------------------------
    const seed = hexToBytes(SEED_HEX);
    const session = await credentialFor(SEED_HEX, 'tip-session');
    expect(session.publicKeyHex).toMatch(/^04[0-9a-fA-F]{128}$/);
    const sessionCredId = await credentialIdForLabel(seed, 'tip-session');
    const sessionPriv = await privateKeyForCredentialId(seed, sessionCredId);

    // -----------------------------------------------------------------
    // PART C — REAL delegate page: target = XLM SAC, with the dApp-suggested
    // 0.5 XLM/day spending limit (new `limit` + `limit_period` params).
    // -----------------------------------------------------------------
    const delegateUrl =
      `http://${host}/security/delegate/?origin=${enc(DAPP)}` +
      `&target=${XLM_SAC}` +
      `&pubkey=${session.publicKeyHex}` +
      `&duration=24h` +
      `&limit=${LIMIT_XLM}` +
      `&limit_period=day` +
      `&return=${enc(`${DAPP}/cb`)}`;
    await page.goto(delegateUrl, { waitUntil: 'domcontentloaded' });

    // The request — including the suggested limit — is surfaced for approval.
    await expect(page.locator('#pubkey-text')).toHaveText(session.publicKeyHex);
    await expect(page.locator('#target-text')).toHaveText(XLM_SAC);
    await expect(page.locator('#limit-amount')).toHaveValue(LIMIT_XLM);
    await expect(page.locator('#limit-none')).not.toBeChecked();
    await expect(page.locator('#limit-summary')).toContainText(
      `capped at ${LIMIT_XLM} XLM per day`,
    );
    await expect(page.locator('#approve')).toBeEnabled({ timeout: 30_000 });

    await page.locator('#approve').click();

    const outcome = await Promise.race([
      page.waitForURL('**/cb?delegation=ok**', { timeout: 180_000 }).then(() => 'ok' as const),
      page
        .locator('#status')
        .filter({ hasText: /Failed:/ })
        .first()
        .waitFor({ state: 'visible', timeout: 180_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'ok') {
      const statusText = (await page.locator('#status').textContent().catch(() => null))?.trim();
      throw new Error(
        `delegate-with-limit install did not reach ?delegation=ok (outcome=${outcome}). ` +
          `#status="${statusText ?? '<none>'}". account=${cAddress} target=${XLM_SAC} ` +
          `pubkey=${session.publicKeyHex}. EXPECTED SUCCESS — a self-add of a context ` +
          `rule (with a registry-resolved spending-limit policy) authorizes under the ` +
          `Default rule.`,
      );
    }
    annotate('delegationRedirect', page.url());

    // -----------------------------------------------------------------
    // PART D — on-chain: the rule exists, carries the External session signer
    // AND the spending-limit policy, whose installed params match what the
    // user approved (0.5 XLM = 5_000_000 stroops per 17280 ledgers).
    // -----------------------------------------------------------------
    const match = await withRetry(
      async () => {
        const m = await findRuleForPubkey(cAddress, session.publicKeyHex);
        if (!m) throw new Error('session pubkey not yet visible on any rule');
        return m;
      },
      { tries: 5, baseMs: 1500 },
    );
    expect(match.contextType).toContain(XLM_SAC);
    expect(
      match.policies,
      `rule ${match.ruleId} policies ${JSON.stringify(match.policies)} must include the ` +
        `spending-limit policy ${POLICY}`,
    ).toContain(POLICY);
    annotate('ruleId', String(match.ruleId));
    annotate('verifier', match.verifier);
    annotate('rulePolicies', match.policies.join(','));

    const limitParams = await withRetry(
      async () => {
        const rv = await simulateView(
          POLICY,
          'get_spending_limit',
          nativeToScVal(match.ruleId, { type: 'u32' }),
          nativeToScVal(cAddress, { type: 'address' }),
        );
        const native = scValToNative(rv) as {
          spending_limit?: bigint;
          period_ledgers?: number;
        } | null;
        if (!native) throw new Error('spending limit not yet readable on the policy');
        return native;
      },
      { tries: 4, baseMs: 1500 },
    );
    expect(String(limitParams.spending_limit)).toBe('5000000'); // 0.5 XLM in stroops
    expect(limitParams.period_ledgers).toBe(17280); // per day
    annotate(
      'installedLimit',
      `spending_limit=${limitParams.spending_limit} stroops, period_ledgers=${limitParams.period_ledgers}`,
    );

    // -----------------------------------------------------------------
    // PART E — a tip recipient ("the author"): fresh funded G-address.
    // -----------------------------------------------------------------
    const author = Keypair.random();
    await withRetry(
      async () => {
        const r = await fetch(`${FRIENDBOT_URL}?addr=${enc(author.publicKey())}`);
        if (!r.ok) throw new Error(`friendbot HTTP ${r.status}`);
      },
      { tries: 3, baseMs: 2000 },
    );
    annotate('author', author.publicKey());

    // -----------------------------------------------------------------
    // PART F — IN-LIMIT TIP: 0.2 XLM SAC transfer signed by the SESSION key,
    // submitted as {func, auth} to the relayer. Expect confirmed + hash.
    // -----------------------------------------------------------------
    const tip1 = await buildSignedTransfer({
      account: cAddress,
      to: author.publicKey(),
      stroops: TIP_1_STROOPS,
      ruleId: match.ruleId,
      verifier: match.verifier,
      sessionPubkey: hexToBytes(session.publicKeyHex),
      sessionPriv,
    });
    const submit1 = await relayerCall({ func: tip1.func, auth: [tip1.authXdr], skipWait: false });
    annotate('tip1RelayerResponse', JSON.stringify(submit1.body));
    expect(
      submit1.body.success,
      `in-limit tip rejected by the relayer: ${JSON.stringify(submit1.body)}`,
    ).not.toBe(false);
    let payload1 = relayerPayload(submit1);

    // skipWait=false normally returns "confirmed"+hash; under congestion poll
    // the relayer by transactionId until a hash exists or it fails.
    for (let i = 0; i < 40 && !payload1.hash; i++) {
      if (payload1.status === 'failed' || payload1.status === 'expired') break;
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await relayerCall({
        getTransaction: { transactionId: payload1.transactionId },
      });
      payload1 = relayerPayload(poll);
    }
    expect(
      payload1.hash,
      `relayer returned no hash for the in-limit tip (last: ${JSON.stringify(payload1)})`,
    ).toBeTruthy();
    const tipHash = payload1.hash!;
    annotate('tipHash', tipHash);
    annotate('tipExplorer', `https://stellar.expert/explorer/testnet/tx/${tipHash}`);

    // -----------------------------------------------------------------
    // PART G — decode the landed tip like PR 1's evidence: on-chain SUCCESS,
    // fee-bump envelope, channel inner source (≠ the account), the inner tx
    // carries THIS run's host function + signed auth entry byte-for-byte, and
    // the auth credential is the smart account itself.
    // -----------------------------------------------------------------
    const server = new rpc.Server(RPC_URL);
    const txResp = await withRetry(
      async () => {
        const r = await server.getTransaction(tipHash);
        if (r.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
          throw new Error('tip tx not yet found on-chain');
        }
        return r;
      },
      { tries: 8, baseMs: 2000 },
    );
    expect(txResp.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS);
    const successResp = txResp as rpc.Api.GetSuccessfulTransactionResponse;
    const envelope = successResp.envelopeXdr;
    expect(envelope.switch()).toBe(xdr.EnvelopeType.envelopeTypeTxFeeBump());
    const feeBumpTx = envelope.feeBump().tx();
    const feeSource = describeMuxed(feeBumpTx.feeSource());
    const innerSource = describeMuxed(feeBumpTx.innerTx().v1().tx().sourceAccount());

    const innerOps = feeBumpTx.innerTx().v1().tx().operations();
    expect(innerOps.length).toBe(1);
    const landedOp = innerOps[0].body().invokeHostFunctionOp();
    expect(landedOp.hostFunction().toXDR('base64')).toBe(tip1.func);
    expect(landedOp.auth().some((a) => a.toXDR('base64') === tip1.authXdr)).toBe(true);

    // The session credential: address credentials of the SMART ACCOUNT.
    const landedAuth = landedOp.auth()[0];
    const landedCreds = landedAuth.credentials().address();
    const credentialAddress = Address.fromScAddress(landedCreds.address()).toString();
    expect(credentialAddress).toBe(cAddress);

    // Invocation: XLM SAC transfer(account → author, 0.2 XLM).
    const fn = landedAuth.rootInvocation().function().contractFn();
    const invokedContract = Address.fromScAddress(fn.contractAddress()).toString();
    expect(invokedContract).toBe(XLM_SAC);
    expect(fn.functionName().toString()).toBe('transfer');
    const args = fn.args().map((a) => scValToNative(a));
    expect(String(args[0])).toBe(cAddress);
    expect(String(args[1])).toBe(author.publicKey());
    expect(String(args[2])).toBe(String(TIP_1_STROOPS));

    const decode = {
      hash: tipHash,
      explorer: `https://stellar.expert/explorer/testnet/tx/${tipHash}`,
      ledger: successResp.ledger,
      feeBump: true,
      feeSource: feeSource.address,
      innerSource: innerSource.address,
      hostFunctionMatchedOnChain: true,
      authEntryMatchedOnChain: true,
      authCredential: credentialAddress,
      invokedContract,
      invokedFunction: 'transfer',
      transferFrom: String(args[0]),
      transferTo: String(args[1]),
      transferStroops: String(args[2]),
      sessionRuleId: match.ruleId,
      verifier: match.verifier,
    };
    console.log(`[proof] tipDecode: ${JSON.stringify(decode, null, 2)}`);
    test.info().annotations.push({ type: 'tipDecode', description: JSON.stringify(decode) });

    // -----------------------------------------------------------------
    // PART H — OVER-LIMIT TIP: 0.4 XLM (cumulative 0.6 > 0.5/day) must be
    // rejected with the spending-limit policy failure (Error(Contract,#3221)).
    // -----------------------------------------------------------------
    const tip2 = await buildSignedTransfer({
      account: cAddress,
      to: author.publicKey(),
      stroops: TIP_2_STROOPS,
      ruleId: match.ruleId,
      verifier: match.verifier,
      sessionPubkey: hexToBytes(session.publicKeyHex),
      sessionPriv,
    });
    const submit2 = await relayerCall({ func: tip2.func, auth: [tip2.authXdr], skipWait: false });
    annotate('overLimitRelayerResponse', JSON.stringify(submit2.body));

    let rejectionText = JSON.stringify(submit2.body);
    let payload2 = relayerPayload(submit2);
    if (submit2.body.success !== false) {
      // The relayer accepted the submission — it must then fail on-chain /
      // in its own enforce simulation. Poll the transactionId to a terminal
      // failed/expired state and capture THAT as the rejection evidence.
      expect(
        payload2.transactionId,
        `over-limit tip neither rejected nor tracked: ${rejectionText}`,
      ).toBeTruthy();
      let terminal = false;
      for (let i = 0; i < 60; i++) {
        const poll = await relayerCall({
          getTransaction: { transactionId: payload2.transactionId },
        });
        payload2 = relayerPayload(poll);
        if (payload2.status === 'failed' || payload2.status === 'expired') {
          rejectionText = JSON.stringify(poll.body);
          annotate('overLimitTerminalPoll', rejectionText);
          terminal = true;
          break;
        }
        if (payload2.status === 'confirmed') {
          throw new Error(
            `OVER-LIMIT TIP WAS CONFIRMED (${JSON.stringify(payload2)}) — the spending-limit ` +
              `policy did NOT reject a cumulative 0.6 XLM spend against a 0.5 XLM/day limit. ` +
              `This is a REAL policy-enforcement finding, not a test artifact.`,
          );
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(
        terminal,
        `over-limit tip never reached a terminal state (last: ${JSON.stringify(payload2)})`,
      ).toBe(true);
    }

    // The rejection must reference the policy enforcement failure. OZ's
    // SpendingLimitError::SpendingLimitExceeded = 3221, surfaced by the
    // relayer's enforce-mode simulation as Error(Contract, #3221). Anchored
    // with the `#` (matching the Rust twin's needle): a bare /3221/ also
    // matches digit runs inside tx hashes, UUIDs, fees, and ledger numbers
    // in the serialized body — which would let the deliverable's key
    // assertion pass with zero policy involvement.
    expect(
      rejectionText,
      `over-limit rejection does not reference the spending-limit policy failure: ${rejectionText}`,
    ).toMatch(/Error\(Contract, #3221\)|#3221\b|SpendingLimitExceeded/i);
    annotate('overLimitRejection', rejectionText);

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
  });
});
