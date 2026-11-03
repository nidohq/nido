import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS, docHref } from '../../../packages/frontend/src/lib/docs/nav';

// The Docs section as built: every page renders without script errors, has
// one h1 and marks itself in the sidebar, every same-site link and #anchor in
// the built HTML resolves, the site nav links to the docs, and the plain-text
// files for agents list every page. Static pages, no chain.

const DIST_DIR = join(process.cwd(), 'packages/frontend/dist');

/** The built file for a site path, or undefined when the build has none. */
function builtFile(path: string): string | undefined {
  const file = join(DIST_DIR, path, path.endsWith('/') ? 'index.html' : '');
  return existsSync(file) ? file : undefined;
}

const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test.describe('docs section @fast', () => {
  for (const doc of DOCS) {
    const path = docHref(doc.slug);

    test(`${path} renders with its sidebar entry current @fast`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: 'Docs' }).locator('[aria-current="page"]')).toHaveText(doc.label);
      expect(errors).toEqual([]);
    });
  }

  test('every same-site link and anchor in the built docs resolves @fast', () => {
    const broken: string[] = [];
    for (const doc of DOCS) {
      const from = docHref(doc.slug);
      const html = readFileSync(builtFile(from)!, 'utf-8');
      for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
        if (/^(https?:)?\/\//.test(href) || href.startsWith('mailto:')) continue;
        const [rawPath, anchor] = href.split('#');
        const path = rawPath === '' ? from : rawPath;
        const file = builtFile(path);
        if (!file) {
          broken.push(`${from} → ${href} (no page)`);
        } else if (anchor && file.endsWith('.html') && !ids(readFileSync(file, 'utf-8')).has(anchor)) {
          broken.push(`${from} → ${href} (no #${anchor})`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test('llms.txt and llms-full.txt list every page @fast', async ({ request }) => {
    const index = await (await request.get('/docs/llms.txt')).text();
    const full = await (await request.get('/docs/llms-full.txt')).text();
    expect(index).toMatch(/^# Nido docs/);
    for (const doc of DOCS) {
      expect(index).toContain(`(${docHref(doc.slug)})`);
      expect(full).toContain(`Page: ${docHref(doc.slug)}`);
    }
    expect(full).not.toContain('<span');
  });

  test('the landing page links to the docs @fast', async ({ page }) => {
    await page.goto('/');
    await page.locator('.lp-nav').getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs\/$/);
    await expect(page.locator('h1')).toHaveText('Build with Nido');
  });
});
