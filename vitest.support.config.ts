import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The worker proxy and the relayer's funder plugin have no test setup of
    // their own; their tests run here, with the new-account funding step's
    // (its client half, which has no frontend dependencies).
    include: [
      'tests/support/**/*.test.ts',
      'frontend/worker-proxy-nido/**/*.test.ts',
      'infra/relayer/plugins/funder/**/*.test.ts',
      'packages/frontend/src/lib/newAccount/fundWallet.test.ts',
    ],
    environment: 'node',
  },
});
