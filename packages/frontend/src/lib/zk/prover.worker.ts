// Module worker that runs zk-recovery proof generation off the main thread.
//
// Ports the flow of NoirService.generateProof (see the reference implementation at
// /home/willem/c/s/zk/soroban-zk-demo/src/services/NoirService.ts) onto this repo's blob layout
// (blob.ts) and toolchain pins (manifest.ts):
//   fetch circuit JSON -> Noir.execute(inputs) -> UltraHonkBackend.generateProof({verifierTarget})
//   -> encode public inputs as 32B BE fields -> buildProofBlob -> keccak256(blob) as the proof id.
//
// bb.js/noir_js are dynamically imported *inside* runProve, not as static top-level imports, so:
//   1. this file type-checks (and Vite/Astro can build it) without those packages' WASM/worker
//      internals ever needing to resolve at import time, and
//   2. nothing heavy loads into a spawned worker until a message actually asks for a proof.
//
// SCOPE: the `runProve` pipeline itself is NOT exercised by any automated test. Live in-browser
// proving needs a real browser (WebAssembly + threads) and is deferred to M4. What IS tested: the
// pure `buildProofBlob` in blob.ts (against a real committed proof/public_inputs fixture) and, from
// this file, `verifyAndParseCircuit` (against the real committed zk_recovery.json circuit bytes) —
// see manifest.test.ts.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildProofBlob } from './blob.js';
import { manifestCheck, MANIFEST } from './manifest.js';

// Type-only: the shape `new Noir(circuit)` expects (bytecode/abi/debug_symbols/file_map), lives in
// '@noir-lang/types'. That package isn't an explicit dependency of this package (only pulled in
// transitively via noir_js, same rationale as the NoirField/NoirInputMap aliases above) — derive
// the type from noir_js's own constructor signature instead of adding a new explicit import.
type NoirModule = typeof import('@noir-lang/noir_js');
type CompiledCircuit = ConstructorParameters<NoirModule['Noir']>[0];

// Structurally mirrors @noir-lang/types' `InputValue`/`InputMap` (kept as a local alias rather
// than an explicit dependency on that package, since it's already pulled in transitively by
// noir_js and this is the only thing we'd need from it).
export type NoirField = string | number | boolean;
export type NoirInputValue = NoirField | NoirInputMap | NoirInputValue[];
export type NoirInputMap = { [key: string]: NoirInputValue };

export interface ProveRequest {
  circuitName: string;
  inputs: NoirInputMap;
}

export type ProveResponse =
  | { ok: true; blobHex: string; publicInputsHex: string[]; proofId: string }
  | { ok: false; error: string };

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Encode a field-element string (hex `0x...` or decimal, as returned in `proof.publicInputs`) as
 * a 32-byte big-endian field, matching NoirService.encodePublicInputValues. */
function encodeFieldBE(value: string): Uint8Array {
  let val = BigInt(value);
  const field = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    field[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return field;
}

/**
 * Verify `bytes` (the exact raw bytes fetched over the network, before any parsing) against
 * `MANIFEST.circuitSha256`, then parse them as the circuit JSON. The sha MUST be computed over
 * the raw file bytes — matching how `manifest.json` was generated (`sha256sum` over the file on
 * disk) — never over a re-serialized/re-encoded form, which could hash to something different
 * even for byte-identical content post-parse.
 *
 * Exported (rather than kept as a runProve-local closure) so it can be unit-tested directly
 * against the real committed circuit artifact, without needing a live fetch/worker.
 */
export function verifyAndParseCircuit(bytes: Uint8Array): CompiledCircuit {
  const fetchedSha = toHex(sha256(bytes));
  manifestCheck(fetchedSha, MANIFEST.circuitSha256);
  return JSON.parse(new TextDecoder().decode(bytes)) as CompiledCircuit;
}

/**
 * Run the full Noir execute -> UltraHonk prove pipeline for one circuit + input set. Returns the
 * assembled proof blob (hex), the per-field public inputs (hex, 32B each), and a keccak256 proof
 * id, or an `{ ok: false }` result describing what went wrong.
 */
export async function runProve(req: ProveRequest, baseUrl = '/'): Promise<ProveResponse> {
  try {
    const [{ Noir }, { Barretenberg, UltraHonkBackend }] = await Promise.all([
      import('@noir-lang/noir_js'),
      import('@aztec/bb.js'),
    ]);

    const circuitUrl = `${baseUrl}circuits/${req.circuitName}.json`;
    const response = await fetch(circuitUrl);
    if (!response.ok) {
      throw new Error(`Failed to load circuit: ${req.circuitName} (HTTP ${response.status})`);
    }
    const circuitBytes = new Uint8Array(await response.arrayBuffer());
    const circuit = verifyAndParseCircuit(circuitBytes);

    const noir = new Noir(circuit);
    const { witness } = await noir.execute(req.inputs);

    const api = await Barretenberg.new();
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const proof = await backend.generateProof(witness, {
      verifierTarget: MANIFEST.verifierTarget,
    });

    const proofBytes: Uint8Array = proof.proof;
    // NoirService takes public inputs from the proof object (covers both input params and return
    // values), rather than re-deriving them from the ABI — mirror that here.
    const publicInputValues: string[] = (proof as { publicInputs?: string[] }).publicInputs ?? [];
    const publicInputFields = publicInputValues.map(encodeFieldBE);

    const blob = buildProofBlob(publicInputFields, proofBytes);
    const proofId = toHex(keccak_256(blob));

    return {
      ok: true,
      blobHex: toHex(blob),
      publicInputsHex: publicInputFields.map(toHex),
      proofId,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function resolveBaseUrl(): string {
  // import.meta.env is a Vite/Astro-ism; guard the lookup so this module still type-checks (and
  // degrades gracefully) if it's ever loaded outside Astro's client build pipeline.
  const meta = import.meta as ImportMeta & { env?: { BASE_URL?: string } };
  return meta.env?.BASE_URL ?? '/';
}

// --- Module worker wiring ---
//
// `self` is intentionally typed with a narrow local ambient declaration rather than the
// `webworker` lib: this project's tsconfig pulls in the DOM lib (for the rest of the frontend),
// and TypeScript cannot have both the DOM and WebWorker libs' conflicting `self` globals in one
// program. Declaring `self` locally (this file has imports, so it's a module — the declaration is
// module-scoped, not global) shadows the ambient DOM typing just for the calls this file makes,
// without pulling in `webworker` project-wide.
declare const self: {
  onmessage: ((event: MessageEvent<ProveRequest>) => unknown) | null;
  postMessage: (message: ProveResponse) => void;
  document?: unknown;
};

// Only self-wire when actually loaded as a worker: prover.ts (the single-threaded fallback path)
// imports this same module directly on the main thread when `Worker` is unavailable, and must NOT
// have this module clobber `window.onmessage` as a side effect of that import. A worker global
// scope has no `document`; `window` does — the standard feature-detection idiom for "am I in a
// worker" without pulling in the `webworker` lib (see the `self` typing note above).
const runningInWorkerScope = typeof self !== 'undefined' && typeof self.document === 'undefined';

if (runningInWorkerScope && 'onmessage' in self) {
  self.onmessage = (event: MessageEvent<ProveRequest>) => {
    void runProve(event.data, resolveBaseUrl()).then((result) => {
      self.postMessage(result);
    });
  };
}
