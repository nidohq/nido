import { WALLET_ORIGIN } from './wallet-protocol.mjs';
export function evaluateInWallet(input, timeout = 10000) {
  if (location.origin !== WALLET_ORIGIN) return Promise.reject(Error('WASI evaluator belongs to wallet origin'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./wasi-worker.mjs', import.meta.url), { type: 'module' });
    const finish = (error, result) => { clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(Error('WASI checker timed out; signing refused')), timeout);
    worker.onerror = () => finish(Error('WASI worker failed; signing refused'));
    worker.onmessage = event => event.data?.ok === true ? finish(null, event.data.result) : finish(Error(event.data?.error || 'WASI checker failed'));
    worker.postMessage(input);
  });
}
