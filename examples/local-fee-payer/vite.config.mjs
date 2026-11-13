import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const deckPath = new URL('../../packages/frontend/public/local-fees/index.html', import.meta.url);
const walletHeaders = (req, res, next) => {
  if (req.url?.startsWith('/wallet.html') || req.url?.startsWith('/budget-wallet.html')) {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
  }
  next();
};
export default defineConfig({
  build: { target: 'esnext', rolldownOptions: { input: { app: resolve('index.html'), wallet: resolve('wallet.html'), budget:resolve('budget-wallet.html') } } },
  server: { host: '127.0.0.1', port: 5198, strictPort: true,
    proxy: { '/local-rpc': { target:'http://127.0.0.1:8022', rewrite:p=>p.replace('/local-rpc','/soroban/rpc') },
      '/local-budget': { target:'http://127.0.0.1:5200', rewrite:p=>p.replace('/local-budget','') } } },
  plugins: [
    // One HTML source serves both the Nido PR preview and the isolated lab.
    { name: 'architecture-slides',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== '/architecture.html') return next();
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(readFileSync(deckPath));
        });
      },
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'architecture.html', source: readFileSync(deckPath) }); },
    },
    { name: 'wallet-frame-boundary', configureServer(server) { server.middlewares.use(walletHeaders); }, configurePreviewServer(server) { server.middlewares.use(walletHeaders); } },
  ],
});
