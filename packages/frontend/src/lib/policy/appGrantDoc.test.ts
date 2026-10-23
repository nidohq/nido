// @vitest-environment node
// The document a passkey request applies, as Perch's doc compiler receives
// it. `crates/integration-tests/tests/it/app_grant_doc.rs` compiles this
// fixture with the compiler and the WebAuthn verifier deployed from wasm;
// the verifier is the integration world's, so the compiler canonicalizes
// the keys through it. This test keeps the fixture byte-identical to what
// the request builds. Regenerate with
// `NIDO_WRITE_APP_GRANT_DOC=1 npx vitest run --root packages/frontend src/lib/policy/appGrantDoc.test.ts`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Networks, StrKey, hash } from '@stellar/stellar-sdk';
import { parsePolicyDocJson } from '@nidohq/passkey-sdk';
import { adminBaseline } from './docDraft.js';
import { buildSessionGrantOperation, parseDocDelegateParams, sessionSignerDraft } from './docRequest.js';
import { PERIOD_LEDGERS } from '../spendingLimitParams.js';

const FIXTURE = fileURLToPath(new URL('./testdata/app-grant-doc.json', import.meta.url));
// `contract_at(env, "webauthn-verifier")` in crates/integration-tests.
const VERIFIER = StrKey.encodeContract(hash(Buffer.from('nido-it/webauthn-verifier')));
const APP_KEY = '04' + 'cd'.repeat(64);

describe('a passkey request compiles (testdata/app-grant-doc.json)', () => {
  it('is the document the request builds, byte for byte', () => {
    // Guess the Number's session: `guess` (call-only) and the capped stake,
    // payable only to the game.
    const parsed = parseDocDelegateParams(
      new URLSearchParams({
        origin: 'https://game.example',
        return: 'https://game.example/play',
        pubkey: APP_KEY,
        duration: '24h',
        'grant.0.label': 'guess',
        'grant.0.target': 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL',
        'grant.0.functions': 'guess',
        'grant.0.limit': 'none',
        'grant.1.label': 'guess-xlm',
        'grant.1.target': 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        'grant.1.functions': 'transfer',
        'grant.1.limit': '2',
        'grant.1.limit_period': 'day',
        'grant.1.to': 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL',
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const signer = sessionSignerDraft(parsed.req.signer, VERIFIER)!;
    const op = buildSessionGrantOperation({
      baseline: adminBaseline({ verifier: VERIFIER, publicKeyHex: '04' + '11'.repeat(64) }, Networks.TESTNET),
      baselineRevision: 0n,
      isFirstApply: true,
      drafts: parsed.req.grants.map((g) => ({
        name: g.label,
        signer,
        targetContract: g.target,
        functionsInput: g.functions?.join(', ') ?? '',
        notAfterLedger: 5000,
        ...(g.to !== undefined ? { recipient: g.to } : {}),
        cap:
          g.cap === null || g.cap === 'none'
            ? null
            : { stroops: g.cap.stroops, periodLedgers: PERIOD_LEDGERS[g.cap.period] },
      })),
      networkPassphrase: Networks.TESTNET,
      expiryLabel: '24 hours',
    });
    // The app's key is the bare 65-byte key: the verifier-canonical form
    // the compiler requires.
    expect(parsePolicyDocJson(op.docJson).signers.find((sg) => sg.id === 'session')).toEqual({
      id: 'session',
      verifier: VERIFIER,
      key: APP_KEY,
    });

    if (process.env.NIDO_WRITE_APP_GRANT_DOC === '1') writeFileSync(FIXTURE, `${op.docJson}\n`);
    expect(op.docJson).toBe(readFileSync(FIXTURE, 'utf8').trimEnd());
  });
});
