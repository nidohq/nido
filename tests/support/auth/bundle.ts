import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
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
