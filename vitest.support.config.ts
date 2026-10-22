import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The worker proxy has no package of its own; its test runs here.
    include: ['tests/support/**/*.test.ts', 'frontend/worker-proxy-nido/**/*.test.ts'],
    environment: 'node',
  },
});
