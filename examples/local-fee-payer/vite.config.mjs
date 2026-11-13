import { defineConfig } from 'vite';
import { resolve } from 'node:path';
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
  plugins: [{ name: 'wallet-frame-boundary', configureServer(server) { server.middlewares.use(walletHeaders); }, configurePreviewServer(server) { server.middlewares.use(walletHeaders); } }],
});
