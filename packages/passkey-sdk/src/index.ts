export type {
  PasskeyRegistration,
  PasskeySignature,
  NetworkConfig,
} from "./types.js";

export {
  extractPublicKey,
  parseAttestationObject,
  parseRegistration,
} from "./webauthn.js";

export { derToCompact } from "./signature.js";

export {
  buildAuthHash,
  getAuthEntry,
  parseAssertionResponse,
  injectPasskeySignature,
} from "./auth.js";

export {
  getContractSalt,
  computeAccountAddress,
  lookupExistingAccount,
  deploySmartAccount,
} from "./deploy.js";

export {
  buf2hex,
  hex2buf,
  buf2base64url,
  base64url2buf,
} from "./encoding.js";

export {
  isContractId,
  contractIdFromHostname,
  nameFromHostname,
  accountUrl,
  stripSubdomain,
} from "./url.js";

export { resolveName, resolveNameCached } from "./resolve.js";

export type { PendingAccount, SessionKeyMaterial } from "./storage.js";

export {
  saveCredential,
  loadCredential,
  saveAccount,
  loadAccounts,
  savePendingAccount,
  loadPendingAccounts,
  removePendingAccount,
  activateAccount,
  saveAccountName,
  loadAccountName,
  saveFriendNickname,
  loadFriendNicknames,
  saveSessionKeyMaterial,
  loadSessionKeyMaterial,
  forgetSessionKeyMaterial,
  saveBlockLabel,
  loadBlockLabels,
} from "./storage.js";

export * from './policyBlocks/index.js';

export * from './resolveFriendInput.js';

export * from './sessionKey.js';

export * from './syntheticAssertion.js';
