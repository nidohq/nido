#!/usr/bin/env node
// Automated Chromium rows of the WebAuthn-on-onion matrix (#139).
// Uses a CDP virtual authenticator (ctap2/internal, UV) so no physical key is
// needed — this tests exactly what the spike asks: does the *browser* allow a
// WebAuthn ceremony on a .onion origin. Runs through the spike's tor SOCKS.
//
//   node auto-test.mjs [path-to-chrome]
//
// TLS rows validate against the real trust store (no ignoreHTTPSErrors), so a
// pass also proves the local-CA trust path works.

import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const ADDR = readFileSync(new URL("./data/onion/hostname", import.meta.url), "utf8").trim();
const CHROME = process.argv[2] ?? "/home/willem/.nix-profile/bin/google-chrome";

const TARGETS = [
  { name: "https bare", url: `https://${ADDR}/` },
  { name: "https subdomain", url: `https://test.${ADDR}/` },
  { name: "http bare", url: `http://${ADDR}/` },
  { name: "http subdomain", url: `http://test.${ADDR}/` },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--proxy-server=socks5://127.0.0.1:9052",
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
  ],
});
console.log(`chrome: ${CHROME}`);
console.log(`onion:  ${ADDR}\n`);

const results = [];
for (const t of TARGETS) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const row = { target: t.name, url: t.url };
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await page.goto(t.url, { timeout: 120000, waitUntil: "domcontentloaded" });
    row.isSecureContext = await page.evaluate(() => window.isSecureContext);
    row.pkc = await page.evaluate(() => typeof window.PublicKeyCredential);

    const logAfter = async (btn, marker) => {
      await page.click(btn);
      await page.waitForFunction(
        (m) => document.getElementById("log").textContent.includes(m),
        marker,
        { timeout: 30000 }
      );
      const log = await page.evaluate(() => document.getElementById("log").textContent);
      return log.split("\n").filter((l) => l.includes(marker)).map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim());
    };

    if (row.pkc === "undefined") {
      row.create = "API absent";
      row.assert = "API absent";
    } else {
      row.create = (await logAfter("#create", "CREATE ")).join(" | ");
      if (row.create.includes("CREATE OK")) {
        row.assert = (await logAfter("#assert", "ASSERT ")).join(" | ");
      } else {
        row.assert = "skipped (create failed)";
      }
    }
  } catch (e) {
    row.error = `${e.name}: ${e.message.split("\n")[0]}`;
  } finally {
    await context.close();
  }
  results.push(row);
  console.log(JSON.stringify(row, null, 2));
}

await browser.close();

console.log("\n=== summary ===");
for (const r of results) {
  const verdict = r.create?.includes("CREATE OK") && r.assert?.includes("ASSERT OK")
    ? "PASS"
    : "FAIL";
  console.log(`${verdict}  ${r.target}  secureCtx=${r.isSecureContext} PKC=${r.pkc}  ${r.create ?? r.error ?? ""}`);
}
