import { defineConfig } from 'vitest/config';

// Unit tests for the pure timing core (instrument.ts). vitest is provided by the
// workspace root; run from the repo root with:
//   npx vitest run --root infra/relayer/plugins/channels
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});
