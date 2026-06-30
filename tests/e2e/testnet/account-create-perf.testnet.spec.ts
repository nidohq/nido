import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { cdpTest as test, expect, newCdpRunCtx } from '../../support/perf/cdpFixture';
import { collectPerfMarks, startRelayCapture, txIdFromMarks } from '../../support/perf/collect';
import { buildTrace, aggregate, toMarkdownTable } from '../../support/perf/report';
import { buildArtifact, writePerfArtifact } from '../../support/perf/artifacts';
import type { Trace } from '../../support/perf/schema';

const PORT = Number(process.env.E2E_PORT || 4399);
const RUNS = Math.max(1, Number(process.env.PERF_RUNS || 5));

// Goal #1: the full account-creation lifecycle driven by the REAL Chromium
// virtual authenticator (real WebAuthn ceremony) against REAL testnet — the
// combination that didn't exist before. Doubles as the first real-CDP-on-
// testnet correctness check. Goal #2: emit a per-phase `% of total` table from
// the always-on `nido:perf:*` seams, aggregated over N runs.
//
// Investigation tool, NOT a CI gate — it never fails on slowness, only on a
// broken create flow or absent timing data. Quarantined under testnet-chromium.
test.describe('@testnet create-run perf', () => {
  // CDP virtual authenticator (newCDPSession) is Chromium-only — skip, don't
  // fail, under testnet-webkit (which also matches this dir).
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');

  // Each create-run is a friendbot fund + factory deploy + ~82s poll ceiling +
  // funding drain; budget generously and scale with the run count.
  test.describe.configure({ timeout: 200_000 * RUNS });

  test(`create lifecycle × ${RUNS} (real CDP authenticator on testnet)`, async ({ browser }, testInfo) => {
    const traces: Trace[] = [];

    for (let i = 0; i < RUNS; i++) {
      const { context, page, cdp } = await newCdpRunCtx(browser);
      const net = await startRelayCapture(cdp);
      try {
        await driveCreateRun(page, PORT);
        const marks = await collectPerfMarks(page);
        const trace = buildTrace({
          runId: `run-${i + 1}`,
          txId: txIdFromMarks(marks),
          marks,
          startedAt: new Date().toISOString(),
        });
        traces.push(trace);
        const relay = net.stop();
        testInfo.annotations.push({
          type: 'perf-run',
          description: `run ${i + 1}: total ${Math.round(trace.totalMs)}ms · ${marks.length} marks · ${relay.length} /relay reqs · tx ${trace.txId ?? '—'}`,
        });
      } finally {
        await context.close();
      }
    }

    expect(traces.length).toBe(RUNS);

    const agg = aggregate(traces);
    const markdown = toMarkdownTable(agg);
    // Surfaced in the playwright `list` reporter output — the headline deliverable.
    // eslint-disable-next-line no-console
    console.log(`\n${markdown}\n`);

    const isoTs = new Date().toISOString();
    const file = writePerfArtifact(
      buildArtifact({ traces, aggregate: agg, markdown, isoTs }),
      join(process.cwd(), 'perf-results'),
      isoTs,
    );
    testInfo.annotations.push({ type: 'perf-artifact', description: file });
    await testInfo.attach('create-perf.md', { body: markdown, contentType: 'text/markdown' });

    // Correctness assertions: every run completed AND produced a real timeline.
    expect(agg.totalMedianMs).toBeGreaterThan(0);
    expect(agg.phases.length).toBeGreaterThan(0);
  });
});

/**
 * One create-run, via the real create flow:
 *
 *   /new-account/?setup=1&salt=<rand>   reserve the C-address (relayer)
 *     → click "Continue"                redirect to <cAddress>.localhost/new-account/?…&autopass=1
 *     → autopass auto-attempts the passkey; if it can't (no post-redirect user
 *       activation) the passkey step is shown and we tap #register-btn
 *     → real ceremony → auto-deploy → #done-section
 *
 * The home page is now an info-only landing whose create entry points open the
 * "My Nido" menu; going straight to /new-account/?setup=1 is the same flow the
 * menu's create button reaches via createNido(). A unique salt per run mints a
 * fresh throwaway testnet account. The `nido:perf:*` marks land on the subdomain
 * page this leaves `page` on. Returns the account subdomain hostname.
 */
async function driveCreateRun(page: Page, port: number): Promise<string> {
  const salt = randomBytes(32).toString('hex'); // 64 hex → unique account per run

  await page.goto(`http://localhost:${port}/new-account/?setup=1&salt=${salt}`, {
    waitUntil: 'domcontentloaded',
  });

  // Reservation reserves the C-address, then enables "Continue".
  const continueBtn = page.locator('#preparing-continue');
  await expect(continueBtn).toBeEnabled({ timeout: 60_000 });
  await continueBtn.click();

  // Redirect to the account's own subdomain (<cAddress>.localhost) new-account page.
  await page.waitForURL(
    (url) => /^c[a-z2-7]{55}$/.test(url.hostname.split('.')[0]) && url.pathname.includes('/new-account/'),
    { timeout: 60_000 },
  );

  // Real ceremony: the virtual authenticator (installed on this page's target by
  // newCdpRunCtx) satisfies navigator.credentials.create() with no shim. Either
  // autopass already advanced to done, or the passkey step awaits a manual tap.
  const done = page.locator('#done-section');
  const registerBtn = page.locator('#register-btn');
  await expect(done.or(registerBtn).first()).toBeVisible({ timeout: 60_000 });
  if (!(await done.isVisible())) {
    await registerBtn.click();
  }
  await expect(done).toBeVisible({ timeout: 120_000 });

  return new URL(page.url()).hostname;
}
