import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom so the @creit.tech/stellar-wallets-kit module imports (which touch
    // DOM/window at module scope) don't blow up on import. The unit tests
    // themselves exercise the pure logic with injected fakes.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
