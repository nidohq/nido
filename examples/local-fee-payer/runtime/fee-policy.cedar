permit(principal is Passkey, action == Action::"sponsor", resource is FeeAccount)
when {
  context.passkeyVerified && context.cAuthorizationVerified &&
  principal == resource.passkey &&
  context.cAccount == resource.cAccount &&
  (context.network == "testnet" || context.network == "local") &&
  context.feeStroops > 0 && context.feeStroops <= resource.maxFeeStroops
};
