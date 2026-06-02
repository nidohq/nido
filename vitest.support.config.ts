import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/support/**/*.test.ts'],
    environment: 'node',
  },
});
