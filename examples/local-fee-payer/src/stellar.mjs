import { Buffer } from 'buffer';
import { Account, Address, Asset, Keypair, Networks, Operation, SorobanDataBuilder, StrKey, TransactionBuilder, hash, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { concat, derToCompact, equal, utf8 } from './webauthn.mjs';

export const NETWORK = Networks.TESTNET;
export const C_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 1));
export const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));
export const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 3));
export const RULE_IDS = [0];
export const MAX_FEE = 1000; // Total fee-bump fee, stroops (0.0001 XLM).
const scMap = pairs => xdr.ScVal.scvMap(pairs.map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })));
const scBytes = b => xdr.ScVal.scvBytes(Buffer.from(b));

export async function createFeeKey() {
  const pair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: StrKey.encodeEd25519PublicKey(Buffer.from(publicBytes)) };
}

export function feeProfile(localKey) {
  // Unfunded fixture. Master is the administrative key; local signer gets only weight 1.
  const admin = Keypair.random();
  const account = admin.publicKey();
  const setup = new TransactionBuilder(new Account(account, '0'), { fee: '100', networkPassphrase: NETWORK })
    .addOperation(Operation.setOptions({ masterWeight: 2, lowThreshold: 1, medThreshold: 2, highThreshold: 2,
      signer: { ed25519PublicKey: localKey.publicKey, weight: 1 } })).setTimeout(120).build();
  setup.sign(admin);
  return { account, localWeight: 1, low: 1, medium: 2, high: 2, masterWeight: 2, setupXdr: setup.toXdr() };
}

export function makeIntent(account = C_ACCOUNT) {
  const source = Keypair.random();
  const recipient = Keypair.random().publicKey();
  const args = [new Address(account).toScVal(), new Address(recipient).toScVal(), nativeToScVal(10000000n, { type: 'i128' })];
  const call = new xdr.InvokeContractArgs({ contractAddress: new Address(TOKEN).toScAddress(), functionName: 'transfer', args });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(account).toScAddress(), nonce: 7n,
      signatureExpirationLedger: 12345, signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call), subInvocations: [],
    }),
  });
  return { source, account, recipient, args, entry };
}

// The current Perch dev addr_oz_v1 digest, not the older main-branch rule-only digest.
// Source: perch@0b3752d8/packages/perch-js/src/auth.ts and xdr.ts.
export function cChallenge(entry, account = C_ACCOUNT, network = NETWORK, ruleIds = RULE_IDS) {
  const creds = entry.credentials.address;
  const payload = hash(xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(new xdr.HashIdPreimageSorobanAuthorization({
    networkId: hash(Buffer.from(network)), nonce: creds.nonce,
    signatureExpirationLedger: creds.signatureExpirationLedger, invocation: entry.rootInvocation,
  })).toXdr());
  return perchDigest(account, payload, ruleIds);
}

export function perchDigest(account, payload, ruleIds) {
  if (payload.length !== 32) throw Error('Signature payload must be 32 bytes');
  const addressBound = hash(Buffer.from(concat(utf8('perch/account/auth-addr-v1'), StrKey.decodeContract(account), payload)));
  const rules = xdr.ScVal.scvVec(ruleIds.map(id => xdr.ScVal.scvU32(id))).toXdr();
  return new Uint8Array(hash(Buffer.from(concat(addressBound, rules))));
}

export function authPayload(assertion, publicKey) {
  const signature = scMap([
    ['authenticator_data', scBytes(assertion.authenticatorData)],
    ['client_data', scBytes(assertion.clientDataJSON)],
    ['signature', scBytes(derToCompact(assertion.signature, true))],
  ]).toXdr();
  return externalPayload(RULE_IDS, VERIFIER, publicKey, signature);
}

export function externalPayload(ruleIds, verifier, publicKey, signature) {
  const signer = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('External'), new Address(verifier).toScVal(), scBytes(publicKey)]);
  return scMap([
    ['context_rule_ids', xdr.ScVal.scvVec(ruleIds.map(id => xdr.ScVal.scvU32(id)))],
    ['signers', xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: signer, val: scBytes(signature) })])],
  ]);
}

export function cTransaction(intent, assertion, publicKey) {
  const entry = xdr.SorobanAuthorizationEntry.fromXdr(intent.entry.toXdr());
  entry.credentials.address.signature = authPayload(assertion, publicKey);
  const op = Operation.invokeContractFunction({ contract: TOKEN, function: 'transfer', args: intent.args, auth: [entry] });
  const tx = new TransactionBuilder(new Account(intent.source.publicKey(), '0'), { fee: '100', networkPassphrase: NETWORK })
    .addOperation(op).setSorobanData(new SorobanDataBuilder().setResources(100000, 1000, 1000).setResourceFee('0').build()).setTimeout(120).build();
  tx.sign(intent.source);
  return tx;
}

export const feeBump = (inner, feePublicKey, baseFee = '100') => TransactionBuilder.buildFeeBumpTransaction(feePublicKey, baseFee, inner, NETWORK);
export const cloneFee = tx => TransactionBuilder.fromXdr(tx.toXdr(), NETWORK);

// Derive facts from the actual encoded transaction, not from a caller's `isC` boolean.
export function inspectC(feeTx, expectedAccount = C_ACCOUNT) {
  const inner = feeTx.innerTransaction;
  if (feeTx.networkPassphrase !== NETWORK || inner.operations.length !== 1) throw Error('Wrong network or operation count');
  const op = inner.operations[0];
  if (op.type !== 'invokeHostFunction' || op.func.type !== 'hostFunctionTypeInvokeContract' || op.auth?.length !== 1) throw Error('Not the C contract flow');
  const entry = op.auth[0];
  if (entry.credentials.type !== 'sorobanCredentialsAddress') throw Error('Wrong authorization type');
  const account = Address.fromScAddress(entry.credentials.address.address).toString();
  if (account !== expectedAccount) throw Error('Wrong C account');
  const invocation = entry.rootInvocation;
  if (invocation.subInvocations.length || invocation.function.type !== 'sorobanAuthorizedFunctionTypeContractFn') throw Error('Unexpected invocation tree');
  const call = op.func.invokeContract;
  if (!equal(call.toXdr(), invocation.function.contractFn.toXdr())) throw Error('Invocation does not match authorization');
  if (Address.fromScAddress(call.contractAddress).toString() !== TOKEN || call.functionName.toString() !== 'transfer' || call.args.length !== 3 || !equal(call.args[0].toXdr(), new Address(account).toScVal().toXdr())) throw Error('Unexpected C action');
  return { account, entry, challenge: cChallenge(entry, account), fee: Number(feeTx.fee) };
}

// This deliberately has no Cedar or passkey check: the bypass witness.
// Non-exportable prevents exportKey(), not sign(). Never use this as a wallet API.
export async function rawSignFee(feeTx, key) {
  const signed = cloneFee(feeTx);
  const signature = await crypto.subtle.sign('Ed25519', key.privateKey, signed.hash());
  signed.addSignature(key.publicKey, Buffer.from(signature).toString('base64'));
  return signed;
}

export function verifiesFeeSignature(feeTx, publicKey) {
  const key = Keypair.fromPublicKey(publicKey);
  return feeTx.signatures.some(sig => equal(sig.hint.value, key.signatureHint()) && key.verify(feeTx.hash(), sig.signature.value));
}

export function unrelatedPayment() {
  const sender = Keypair.random();
  const tx = new TransactionBuilder(new Account(sender.publicKey(), '0'), { fee: '100', networkPassphrase: NETWORK })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' })).setTimeout(120).build();
  tx.sign(sender);
  return tx;
}
