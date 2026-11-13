import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const deckPath = new URL('../../packages/frontend/public/local-fees/index.html', import.meta.url);
const authorityEvidencePath = new URL('../../packages/frontend/public/local-fees/authority-evidence.json', import.meta.url);
const walletHeaders = (req, res, next) => {
  if (req.url?.startsWith('/wallet.html') || req.url?.startsWith('/budget-wallet.html')) {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
  }
  next();
};
export default defineConfig({
  base: process.env.VITE_FEE_PREVIEW_NUMBER ? '/fee-demo/' : '/',
  build: { target: 'esnext', rolldownOptions: { input: { app: resolve('index.html'), wallet: resolve('wallet.html'), budget:resolve('budget-wallet.html'), testnet:resolve('testnet.html') } } },
  server: { host: '127.0.0.1', port: 5198, strictPort: true,
    proxy: { '/local-rpc': { target:'http://127.0.0.1:8022', rewrite:p=>p.replace('/local-rpc','/soroban/rpc') },
      '/local-budget': { target:'http://127.0.0.1:5200', rewrite:p=>p.replace('/local-budget','') } } },
  plugins: [
    // One HTML source serves both the Nido PR preview and the isolated lab.
    { name: 'architecture-slides',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url=req.url?.split('?')[0];
          if (!['/architecture.html','/authority-evidence.json'].includes(url)) return next();
          res.setHeader('Content-Type', url.endsWith('.json')?'application/json':'text/html; charset=utf-8');
          res.end(readFileSync(url.endsWith('.json')?authorityEvidencePath:deckPath));
        });
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'architecture.html', source: readFileSync(deckPath) });
        this.emitFile({ type: 'asset', fileName: 'authority-evidence.json', source: readFileSync(authorityEvidencePath) });
      },
    },
    { name: 'wallet-frame-boundary', configureServer(server) { server.middlewares.use(walletHeaders); }, configurePreviewServer(server) { server.middlewares.use(walletHeaders); } },
  ],
});
