import { describe, it, expect } from 'vitest';
import { getInitScript } from './bundle';

describe('bundle', () => {
  it('produces a self-contained IIFE string', async () => {
    const script = await getInitScript();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(1000);
    // Bundled, not an ESM module (no top-level import/export left).
    expect(script).not.toMatch(/^\s*import\s/m);
    expect(script).toContain('__testAuthenticator');
  });
});
