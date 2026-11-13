import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Perch's source at Nido's pin, the rev of the root Cargo.toml's Perch git
 * dependencies, for tests that read Perch's deployment manifests, testdata,
 * or Rust constants. scripts/perch-src.sh fetches it into target/perch-src/
 * on first use (NIDO_PERCH_DIR names another checkout).
 */

const script = fileURLToPath(new URL('../../scripts/perch-src.sh', import.meta.url));
let dir: string | undefined;

/** The path of `path` inside Perch's source at the pin. */
export function perchSrc(path = ''): string {
  dir ??= execFileSync('bash', [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  return join(dir, path);
}

/** `path` inside Perch's source at the pin, as text. */
export const readPerch = (path: string): string => readFileSync(perchSrc(path), 'utf8');
