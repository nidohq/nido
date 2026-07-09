// Main-thread handle for zk-recovery proof generation. Spawns the module worker
// (prover.worker.ts) when `Worker` is available so the (tens-of-seconds) proving step doesn't
// block the UI thread; otherwise runs the identical pipeline inline, single-threaded, in the
// caller's context. The inline fallback has NO COOP/COEP requirement — it doesn't need
// cross-origin isolation, only the (optional) multi-threaded WASM path inside bb.js would want
// that, and this repo doesn't require it.
//
// SCOPE: not exercised by automated tests. Live in-browser proving needs a real browser
// (WebAssembly + a circuit fetch) and is deferred to M4 — see the task brief. blob.ts carries the
// unit-tested core (the pure blob assembly), independent of this module.

import type { NoirInputMap, ProveRequest, ProveResponse } from './prover.worker.js';

export interface ProveResult {
  /** u32-BE(#pubs) ‖ pubs(32B each, BE) ‖ proof — see blob.ts. */
  blob: Uint8Array;
  /** keccak256(blob) as lowercase hex, used to correlate a proof with its on-chain submission. */
  proofId: string;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${hex.length} chars)`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toResult(response: ProveResponse): ProveResult {
  if (!response.ok) {
    throw new Error(`zk prover failed: ${response.error}`);
  }
  return { blob: hexToBytes(response.blobHex), proofId: response.proofId };
}

function resolveBaseUrl(): string {
  const meta = import.meta as ImportMeta & { env?: { BASE_URL?: string } };
  return meta.env?.BASE_URL ?? '/';
}

/**
 * Generate a zk-recovery proof for `circuitName` with `inputs`, returning the assembled proof
 * blob (blob.ts layout) and its proof id. Prefers a module worker; falls back to running inline
 * when `Worker` isn't available in this environment.
 */
export async function prove(
  circuitName: string,
  inputs: NoirInputMap,
): Promise<ProveResult> {
  if (typeof Worker !== 'undefined') {
    return proveWithWorker(circuitName, inputs);
  }
  return proveInline(circuitName, inputs);
}

function proveWithWorker(
  circuitName: string,
  inputs: NoirInputMap,
): Promise<ProveResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./prover.worker.js', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<ProveResponse>) => {
      worker.terminate();
      try {
        resolve(toResult(event.data));
      } catch (err) {
        reject(err);
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate();
      reject(new Error(`zk prover worker error: ${event.message}`));
    };

    const request: ProveRequest = { circuitName, inputs };
    worker.postMessage(request);
  });
}

async function proveInline(
  circuitName: string,
  inputs: NoirInputMap,
): Promise<ProveResult> {
  // Dynamic import: prover.worker.ts's runProve is the same pipeline the worker path uses, but we
  // only want to pull in bb.js/noir_js (via runProve's own dynamic imports) when this fallback is
  // actually exercised.
  const { runProve } = await import('./prover.worker.js');
  const response = await runProve({ circuitName, inputs }, resolveBaseUrl());
  return toResult(response);
}
