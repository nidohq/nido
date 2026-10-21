/**
 * What a dApp asks this account to authorize, decoded for review.
 *
 * A Soroban authorization is a tree: the call the account approves plus every
 * sub-call it approves on the way down (a router's `swap` authorizing a
 * token's `transfer`, say). Reviewing only the transaction's top-level call
 * hides the rest, so both dApp paths through /sign/ — a transaction, and a
 * bare authorization entry — render the account's whole tree from here and
 * refuse what no dApp may ask for:
 *
 *  - a call on the account itself (`apply_doc`, `execute`, `schedule_upgrade`,
 *    …). Those change who controls the account or move its funds through its
 *    own entry points; Nido's own pages build them, never a dApp;
 *  - a contract deployment in the account's name, which the review can't show.
 *
 * A bare authorization entry gets three more checks before anyone is asked to
 * sign it: it must be a Soroban authorization preimage, for this wallet's
 * network, expiring soon. The passkey signs it under the account's admin
 * rule, so it is as strong as a transaction and outlives the page.
 */

import { Address, xdr } from "@stellar/stellar-sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { describeInvokeContract, type OpSummary } from "../transfer/txSummary.js";
import { esc } from "../html.js";
import { shortAddr } from "../address.js";

/** The longest a dApp-requested authorization entry may stay valid: about an
 *  hour of ledgers. Long enough to assemble and submit a transaction, short
 *  enough that a signature handed to a dApp doesn't linger. */
export const AUTH_ENTRY_MAX_LIFETIME_LEDGERS = 720;

export type AuthCall = OpSummary | { kind: "create-contract" };

export interface AuthNode {
  call: AuthCall;
  /** The invoked contract, or null for a deployment. */
  contract: string | null;
  children: AuthNode[];
}

/** Decode an authorized invocation and its sub-invocations. */
export function describeAuthTree(
  inv: xdr.SorobanAuthorizedInvocation,
  account: string,
  nameRegistry?: string,
): AuthNode {
  const fn = inv.function();
  const children = inv.subInvocations().map((sub) => describeAuthTree(sub, account, nameRegistry));
  if (fn.switch() === xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
    const ic = fn.contractFn();
    return {
      call: describeInvokeContract(ic, account, nameRegistry),
      contract: Address.fromScAddress(ic.contractAddress()).toString(),
      children,
    };
  }
  return { call: { kind: "create-contract" }, contract: null, children };
}

function flatten(node: AuthNode): AuthNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function callName(node: AuthNode): string {
  const c = node.call;
  if (c.kind === "invoke") return c.fn;
  if (c.kind === "transfer") return "execute";
  return c.kind;
}

/**
 * Why this tree is refused, or undefined when a dApp may ask for it. See the
 * module comment for the two refusals.
 */
export function authTreeProblem(tree: AuthNode, account: string): string | undefined {
  const nodes = flatten(tree);
  const self = nodes.find((n) => n.contract === account);
  if (self) {
    return (
      `This request would have your account call its own "${callName(self)}" ` +
      `function, which can change who controls it or move its funds. Only ` +
      `Nido's own pages may ask for that, so Nido refuses it.`
    );
  }
  if (nodes.some((n) => n.call.kind === "create-contract")) {
    return (
      "This request would deploy a contract in your account's name. Nido " +
      "can't show what that contract does, so it refuses the request."
    );
  }
  return undefined;
}

function callLine(node: AuthNode): string {
  const c = node.call;
  switch (c.kind) {
    case "transfer":
      return `Moves <code class="mono">${esc(c.amount.toString())}</code> (smallest units) of token <code class="mono">${esc(shortAddr(c.token))}</code> from <code class="mono">${esc(shortAddr(c.from))}</code> to <code class="mono">${esc(shortAddr(c.to))}</code>`;
    case "name-register":
      return `Registers the name <code class="mono">${esc(c.name)}</code>`;
    case "invoke":
      return `Calls <code class="mono">${esc(c.fn)}</code> on <code class="mono">${esc(shortAddr(c.contract))}</code> (${c.argsCount} arg${c.argsCount === 1 ? "" : "s"})`;
    case "create-contract":
      return "Deploys a contract";
    case "session-grant":
    case "session-revoke":
      return `Changes this account's rules (<code class="mono">${esc(c.kind)}</code>)`;
    case "other":
      return `<code class="mono">${esc(c.type)}</code>`;
  }
}

function nodeHtml(node: AuthNode): string {
  const kids = node.children.length
    ? `<ul style="margin:6px 0 0;padding-left:18px;">${node.children.map(nodeHtml).join("")}</ul>`
    : "";
  return `<li style="margin:6px 0;font-size:13px;line-height:1.5;">${callLine(node)}${kids}</li>`;
}

/**
 * The review card for an account's authorization tree. Every decoded field is
 * escaped: the tree comes from a dApp's XDR or its simulation.
 */
export function renderAuthTree(tree: AuthNode, consequence: string): string {
  return `<div class="card" style="padding:13px 16px;margin-top:10px;">
    <div class="mut" style="font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;">What your account authorizes</div>
    <ul style="margin:6px 0 0;padding-left:18px;">${nodeHtml(tree)}</ul>
    <p class="mut" style="font-size:12px;line-height:1.5;margin:10px 0 0;">${esc(consequence)}</p>
  </div>`;
}

/** The sentence under a transaction's tree. */
export const TX_AUTH_CONSEQUENCE =
  "Your passkey approves exactly these calls, for this transaction only. " +
  "Anything not listed here is not authorized.";

/** The sentence under a bare authorization entry's tree. */
export function authEntryConsequence(expirationLedger: number): string {
  return (
    "Your passkey signs this under your account's admin rule. Whoever holds " +
    `the signature can make exactly these calls as your account until ledger ` +
    `${expirationLedger}, in any transaction they choose.`
  );
}

export interface AuthEntryReview {
  expirationLedger: number;
  tree: AuthNode;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Decode and check a dApp's `kind=authEntry` payload (base64
 * `HashIdPreimage`) for `account` on `networkPassphrase`, before any ledger
 * is known. Refuses anything but a Soroban authorization preimage for this
 * network whose tree a dApp may ask for.
 */
export function reviewAuthEntry(
  authEntryXdr: string,
  account: string,
  networkPassphrase: string,
  nameRegistry?: string,
): { ok: true; review: AuthEntryReview } | { ok: false; reason: string } {
  let preimage: xdr.HashIdPreimage;
  try {
    preimage = xdr.HashIdPreimage.fromXDR(authEntryXdr, "base64");
  } catch {
    return { ok: false, reason: "This isn't a readable authorization entry." };
  }
  if (preimage.switch() !== xdr.EnvelopeType.envelopeTypeSorobanAuthorization()) {
    return { ok: false, reason: "This isn't a Soroban authorization entry, so Nido won't sign it." };
  }
  const auth = preimage.sorobanAuthorization();
  const expected = sha256(new TextEncoder().encode(networkPassphrase));
  if (!bytesEqual(new Uint8Array(auth.networkId()), expected)) {
    return {
      ok: false,
      reason: "This authorization is for a different Stellar network than this wallet, so Nido won't sign it.",
    };
  }
  const tree = describeAuthTree(auth.invocation(), account, nameRegistry);
  const problem = authTreeProblem(tree, account);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, review: { expirationLedger: auth.signatureExpirationLedger(), tree } };
}

/** Why an authorization entry's expiry is refused at `latestLedger`. */
export function authEntryExpiryProblem(expirationLedger: number, latestLedger: number): string | undefined {
  if (expirationLedger <= latestLedger) return "This authorization has already expired.";
  if (expirationLedger - latestLedger > AUTH_ENTRY_MAX_LIFETIME_LEDGERS) {
    return (
      `This authorization would stay valid until ledger ${expirationLedger}, ` +
      `more than ${AUTH_ENTRY_MAX_LIFETIME_LEDGERS} ledgers (about an hour) from now. ` +
      "Ask the app for one that expires sooner."
    );
  }
  return undefined;
}

/**
 * The authorization entry a transaction asks this account to sign: the first
 * entry, which is the one the signer fills in. Refused unless it is this
 * account's own address credential.
 */
export function accountAuthEntry(
  entries: readonly xdr.SorobanAuthorizationEntry[],
  account: string,
): xdr.SorobanAuthorizationEntry {
  const entry = entries[0];
  if (
    !entry ||
    entry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress() ||
    Address.fromScAddress(entry.credentials().address().address()).toString() !== account
  ) {
    throw new Error("This transaction doesn't ask this account to authorize anything Nido can sign.");
  }
  return entry;
}
