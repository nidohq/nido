import { build } from 'esbuild';
import { join } from 'node:path';

// Resolve this file's directory without `import.meta.url`. Both runtimes that
// load this module — Playwright's test loader and Vitest (`environment: node`)
// — transpile to a CJS context where `__dirname` is defined. Referencing
// `import.meta` here would instead force Playwright's loader into ESM mode,
// where `exports` is undefined, and the module fails to load.
const here = __dirname;
let cached: string | null = null;

/** Bundle the in-page TestAuthenticator into one IIFE string (memoized). */
export async function getInitScript(): Promise<string> {
  if (cached) return cached;
  const result = await build({
    entryPoints: [join(here, 'entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    legalComments: 'none',
  });
  cached = result.outputFiles[0].text;
  return cached;
}
