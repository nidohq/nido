import { runWasi } from './wasi-runner.mjs';
import manifest from '../public/runtime/manifest.json';
self.onmessage = async event => {
  try {
    const response = await fetch('/runtime/wallet-checker.wasm', { cache: 'no-store' });
    if (!response.ok) throw Error('WASI module unavailable');
    const binary = await response.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', binary))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== manifest.sha256) throw Error('WASI module hash mismatch');
    self.postMessage({ ok: true, result: await runWasi(binary, event.data) });
  } catch (error) { self.postMessage({ ok: false, error: String(error) }); }
  finally { self.close(); }
};
