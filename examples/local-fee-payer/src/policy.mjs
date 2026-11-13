export const POLICY = `permit (
  principal is Passkey,
  action == Action::"sponsor",
  resource is FeeAccount
) when {
  context.passkeyVerified &&
  context.cAuthorizationVerified &&
  context.cAccount == resource.cAccount &&
  principal == resource.passkey &&
  context.network == "testnet" &&
  context.feeStroops > 0 &&
  context.feeStroops <= resource.maxFeeStroops
};`;

export function decide(cedar, { credentialId, expectedCredentialId, feeAccount, cAccount, expectedC, feeStroops, passkeyVerified, cAuthorizationVerified }, policy = POLICY) {
  const principal = { type: 'Passkey', id: credentialId };
  const resource = { type: 'FeeAccount', id: feeAccount };
  try {
    const answer = cedar.isAuthorized({
      principal, action: { type: 'Action', id: 'sponsor' }, resource,
      context: { passkeyVerified, cAuthorizationVerified, cAccount, feeStroops, network: 'testnet' },
      policies: { staticPolicies: policy },
      entities: [{ uid: resource, attrs: {
        cAccount: expectedC, maxFeeStroops: 1000,
        passkey: { __entity: { type: 'Passkey', id: expectedCredentialId } },
      }, parents: [] }],
    });
    return { allowed: answer.type === 'success' && answer.response.decision === 'allow' && answer.response.diagnostics.errors.length === 0, answer };
  } catch (error) { return { allowed: false, error: String(error) }; }
}
