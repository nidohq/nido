export const TESTNET_NETWORK = 'Test SDF Network ; September 2015';
export const LOCAL_NETWORK = 'Standalone Network ; February 2017';

// Build-owned configuration, never accepted from a URL, dapp message or RPC.
export function demoConfig(previewNumber = '') {
  if (previewNumber && !/^[1-9][0-9]*$/.test(String(previewNumber))) throw Error('Invalid preview number');
  const testnet = !!previewNumber;
  return Object.freeze({
    testnet,
    network: testnet ? TESTNET_NETWORK : LOCAL_NETWORK,
    appOrigin: testnet ? `https://${previewNumber}.test.nido.fyi` : 'http://localhost:5198',
    walletOrigin: testnet ? `https://pr-${previewNumber}.nido-1am.pages.dev` : 'http://wallet.localhost:5199',
    walletRpId: testnet ? `pr-${previewNumber}.nido-1am.pages.dev` : 'wallet.localhost',
    base: testnet ? '/fee-demo/' : '/',
    rpc: testnet ? 'https://soroban-testnet.stellar.org' : 'http://wallet.localhost:5199/local-rpc',
    label: testnet ? 'Stellar testnet' : 'isolated local chain',
  });
}
export const DEMO = demoConfig(import.meta.env?.VITE_FEE_PREVIEW_NUMBER || '');
