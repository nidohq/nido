import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The worker proxy and the relayer's funder plugin have no test setup of
    // their own; their tests run here.
    include: [
      'tests/support/**/*.test.ts',
      'frontend/worker-proxy-nido/**/*.test.ts',
      'infra/relayer/plugins/funder/**/*.test.ts',
    ],
    environment: 'node',
  },
});
