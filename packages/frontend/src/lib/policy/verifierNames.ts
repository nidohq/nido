/**
 * The deployment's verifier names in the documents the wallet writes. On a
 * Perch deployment whose compiler resolves verifier names (M7,
 * `perch/verifiers`), every admin document and recovery member must name its
 * passkey verifier, and a scoped document that doesn't is flagged. The
 * deployment says what the WebAuthn verifier is named
 * (`PerchDeployment.webauthnVerifierName`); without a name, documents are
 * left as they are.
 */
import { withVerifierNames, type PolicyDoc } from '@nidohq/passkey-sdk';
import { perchDeployment } from '../recovery/deployment.js';

/** `doc` naming the deployment's WebAuthn verifier wherever a signer uses it. */
export function namedDoc(doc: PolicyDoc): PolicyDoc {
  const d = perchDeployment();
  return d?.webauthnVerifierName ? withVerifierNames(doc, { [d.webauthnVerifier]: d.webauthnVerifierName }) : doc;
}
