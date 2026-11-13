import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { demoConfig } from '../src/demo-config.mjs';
const config = demoConfig(process.env.FEE_PREVIEW_NUMBER || '');
const build = spawnSync('cargo', ['+1.97.1', 'build', '--manifest-path', 'runtime/Cargo.toml', '--locked', '--release', '--target', 'wasm32-wasip1'], {
  stdio: 'inherit', env: { ...process.env, RUSTFLAGS: '-C link-arg=--max-memory=67108864',
    NIDO_FEE_WALLET_ORIGIN: config.walletOrigin, NIDO_FEE_WALLET_RP_ID: config.walletRpId, NIDO_FEE_BUDGET_NETWORK: config.network },
});
if (build.status !== 0) process.exit(build.status || 1);
mkdirSync('public/runtime', { recursive: true });
copyFileSync('runtime/target/wasm32-wasip1/release/nido-wallet-checker.wasm', 'public/runtime/wallet-checker.wasm');
const binary = readFileSync('public/runtime/wallet-checker.wasm');
const module = await WebAssembly.compile(binary);
const manifest = { name: 'nido-wallet-checker', abi: 'wasi_snapshot_preview1', cedar: '4.14.1', stellarXdr: '28.0.1',
  walletOrigin:config.walletOrigin, walletRpId:config.walletRpId, budgetNetwork:config.network,
  sha256: createHash('sha256').update(binary).digest('hex'), bytes: binary.length, maxMemoryBytes: 67108864,
  imports: WebAssembly.Module.imports(module),
  sourceSha256: Object.fromEntries(['runtime/src/main.rs', 'runtime/fee-policy.cedar', 'runtime/Cargo.toml', 'runtime/Cargo.lock'].map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])) };
writeFileSync('public/runtime/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
