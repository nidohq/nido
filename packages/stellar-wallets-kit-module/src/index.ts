export { G2cModule, G2C_ID } from './module.js';
export type { G2cModuleParams } from './module.js';

export {
  connectUrl,
  signTransactionUrl,
  signMessageUrl,
  signAuthEntryUrl,
  apexOrigin,
  accountOrigin,
} from './urls.js';
export type {
  ConnectUrlParams,
  SignTxUrlParams,
  SignMessageUrlParams,
  SignAuthEntryUrlParams,
} from './urls.js';

export {
  parseConnectReturn,
  parseSignReturn,
  loadCachedAddress,
  saveCachedAddress,
  clearCachedAddress,
} from './handover.js';
export type { ConnectReturn, SignReturn, SignKind } from './handover.js';

export {
  openCeremonyPopup,
  redirectTopLevel,
  postResultToOpener,
  MESSAGE_SOURCE,
} from './redirect.js';
export type { PopupResult } from './redirect.js';
