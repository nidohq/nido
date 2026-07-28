/**
 * mlDsaSign.ts — sign and submit an account operation with the ML-DSA
 * backstop key instead of a passkey.
 *
 * The passkey twin is `signAndSubmit` (primaryPasskeySigner.ts); this flow
 * reuses its extracted halves (`simulateForSigning` / `submitSigned`) and
 * replaces the WebAuthn ceremony with a local FIPS 204 signature over the
 * auth digest, under the enrolled `pq-backstop` rule. Because that rule is
 * scoped `CallContract(self)`, this signer can only authorize the account's
 * own administration (add/remove rules and signers) — a spend simulates but
 * fails `__check_auth` on-chain.
 *
 * Rotation ("my passkey is gone") uses the rule-replacement pattern the ZK
 * recovery completion shipped: install the NEW passkey as a fresh Default
 * rule (Default rules coexist and act as OR since the AuthPayload names its
 * rule id), then optionally remove the old rule 0. Never `add_signer` onto
 * a policy-less Default rule — OZ treats that as N-of-N and bricks it.
 */

import { Buffer } from "buffer";
import { Networks, rpc } from "@stellar/stellar-sdk";
import { Client as SmartAccountClient } from "@nidohq/smart-account";
import {
  buildAuthHash,
  computeAuthDigest,
  injectMlDsaSignature,
  extractXdrOperations,
  buf2hex,
} from "@nidohq/passkey-sdk";
import {
  simulateForSigning,
  submitSigned,
} from "./primaryPasskeySigner.js";
import { loadBackstopKey, signDigest } from "./mlDsaBackstop.js";
import { getBackstopEnrollment, resolveMlDsaVerifier } from "./mlDsaEnroll.js";
import { RPC_URL, NETWORK_PASSPHRASE } from "./network.js";

type OnProgress = (p: {
  phase: "build" | "sign" | "submit" | "confirm";
  detail?: string;
}) => void;

/**
 * Sign `operation` with the locally-held backstop key under the enrolled
 * pq-backstop rule and submit it. Throws when no local key exists, the
 * account has no backstop enrollment, or the enrolled commitment doesn't
 * match this device's key.
 */
export async function signAndSubmitWithBackstop(args: {
  account: string;
  // xdr.Operation from the bindings' TxBuild — same bridge as signAndSubmit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operation: any;
  onProgress?: OnProgress;
}): Promise<rpc.Api.SendTransactionResponse & { authHashHex: string }> {
  const key = loadBackstopKey(localStorage);
  if (!key) throw new Error("No backstop key on this device.");

  const [verifier, enrollment] = await Promise.all([
    resolveMlDsaVerifier(),
    getBackstopEnrollment(args.account),
  ]);
  if (!enrollment) {
    throw new Error("This account has no enrolled backstop rule.");
  }
  if (buf2hex(enrollment.commitment) !== buf2hex(key.commitment)) {
    throw new Error(
      "The enrolled backstop uses a different key than this device holds.",
    );
  }

  const { server, submitter, authEntry, lastLedger, expirationOffset, assembledTx } =
    await simulateForSigning(args.operation, args.onProgress);

  // Same invariants as the passkey flow: identical contextRuleIds and
  // expiration offset must flow into the digest AND the injected payload.
  const contextRuleIds = [enrollment.ruleId];
  const signaturePayload = buildAuthHash(
    authEntry,
    Networks.TESTNET,
    lastLedger,
    expirationOffset,
  );
  const digest = computeAuthDigest(signaturePayload, contextRuleIds);
  const authHashHex = buf2hex(digest);

  args.onProgress?.({ phase: "sign", detail: "Signing with the backstop key" });
  const signature = signDigest(key.seed, digest);

  injectMlDsaSignature(
    assembledTx,
    {
      verifierAddress: verifier,
      commitment: key.commitment,
      publicKey: key.publicKey,
      signature,
    },
    lastLedger,
    expirationOffset,
    contextRuleIds,
  );

  return submitSigned(assembledTx, submitter, server, authHashHex, args.onProgress);
}

/** Name bound onto the replacement Default rule at rotation. */
export const RECOVERED_RULE_NAME = "recovered";

function smartAccount(account: string): SmartAccountClient {
  return new SmartAccountClient({
    contractId: account,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
}

/**
 * Build the rotation op: a brand-new Default rule holding the replacement
 * passkey (bare 65-byte SEC1 pubkey — resolveSignerRule does an exact-hex
 * match, so never append credential-id bytes). Same shape as ZK recovery's
 * `buildCompleteRecovery`.
 */
export async function buildRecoveredRuleOperation(
  account: string,
  webauthnVerifier: string,
  newPasskeyPublicKey: Uint8Array,
): Promise<unknown> {
  if (newPasskeyPublicKey.length !== 65) {
    throw new Error(`passkey public key must be 65 bytes, got ${newPasskeyPublicKey.length}`);
  }
  const tx = await smartAccount(account).add_context_rule({
    context_type: { tag: "Default", values: undefined },
    name: RECOVERED_RULE_NAME,
    valid_until: undefined,
    signers: [
      {
        tag: "External" as const,
        values: [webauthnVerifier, Buffer.from(newPasskeyPublicKey)] as readonly [string, Buffer],
      },
    ],
    policies: new Map(),
  });
  return extractXdrOperations(tx, RECOVERED_RULE_NAME)[0];
}

/** Build the op removing a context rule (the old passkey's rule 0 after a
 *  successful rotation). Caller must check the rule carries no policies it
 *  still needs — removing the rule drops them. */
export async function buildRemoveRuleOperation(
  account: string,
  ruleId: number,
): Promise<unknown> {
  const tx = await smartAccount(account).remove_context_rule({ context_rule_id: ruleId });
  return extractXdrOperations(tx, "remove-rule")[0];
}
