import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchXlmBalance } from "./horizonBalance.js";
import { InviteClient } from "./inviteClient.js";
import { buildInvitation } from "./invitationHandler.js";
import { createPrinter } from "./printerFactory.js";
import { RELAYER_KEYS, type StellarNetwork } from "./relayerKeys.js";
import { startReceiptPolling } from "./receiptPoller.js";
import { requestLogger } from "./requestLogger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STELLAR_EXPERT_ACCOUNT_URL: Record<StellarNetwork, string> = {
  testnet: "https://stellar.expert/explorer/testnet/account",
  mainnet: "https://stellar.expert/explorer/public/account",
};

const PORT = Number(process.env.PORT ?? 4000);
const INVITE_API_URL = (process.env.INVITE_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const INVITE_API_KEY = process.env.INVITE_API_KEY;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? "http://localhost:4321";
const RECEIPT_POLL_INTERVAL_MS = Number(process.env.RECEIPT_POLL_INTERVAL_MS ?? 5000);
const PRINT_OUTPUT_DIR = process.env.PRINT_OUTPUT_DIR ?? "./print-jobs";

const client = new InviteClient(INVITE_API_URL, INVITE_API_KEY);
const printer = createPrinter(PRINT_OUTPUT_DIR);

const app = express();
app.use(requestLogger);
// Serves the Aha logo in the page footer (the same asset the printed
// receipt uses — see escposBytes.ts). Full-res (for thermal rasterization),
// so the page constrains its display size with CSS rather than shipping a
// web-sized copy.
app.use("/assets", express.static(join(__dirname, "../assets")));

// Nido's own warm-nest palette and halo/mark motifs (packages/frontend/src/
// styles/nido.css, components/Nest.astro), so the booth operator's screen
// looks like nido.fyi's own landing page instead of bare browser defaults.
// This is only two pages, so one inlined <style> is simpler than a build
// step for a two-screen admin tool.
const PAGE_STYLE = `
  :root { color-scheme: light; }
  body {
    font-family: "Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #FFF8F0;
    color: #2A1A12;
    min-height: 100vh;
    margin: 0;
    display: flex;
    padding: 2rem;
    position: relative;
    overflow-x: hidden;
    overflow-y: auto;
  }
  .halo {
    position: fixed;
    top: -220px;
    right: -180px;
    width: 460px;
    height: 460px;
    border-radius: 50%;
    pointer-events: none;
    background: radial-gradient(circle, rgba(242,92,42,.28), rgba(242,92,42,0) 68%);
    opacity: .5;
  }
  /* .stack is the single flex item that gets centered (via margin: auto)
     in body's flex layout; .card and .below-card then just stack in normal
     block flow inside it, so a below-card element lands under the card
     rather than beside it. */
  .stack {
    margin: auto;
    max-width: 380px;
    width: 100%;
  }
  .card {
    position: relative;
    background: #fff;
    border: 1px solid #efe2d2;
    border-radius: 20px;
    box-shadow: 0 10px 30px rgba(42, 26, 18, 0.08);
    padding: 3rem 2.5rem;
    text-align: center;
  }
  h1 { font-family: "Fraunces", serif; font-weight: 800; font-size: 1.8rem; margin: 0 0 0.4rem; }
  h1 em { font-style: italic; color: #cf4a1e; }
  h3 { font-size: 0.85rem; font-weight: 600; color: #7a6655; margin: 1rem 0; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 1.1rem;
    font-weight: 600;
    color: #fff;
    background: #cf4a1e;
    border: none;
    border-radius: 999px;
    padding: 0.9rem 2rem;
    cursor: pointer;
    text-decoration: none;
  }
  .btn:hover { background: #b83e14; }
  .qr-box {
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 6px 18px rgba(42, 26, 18, 0.1);
    padding: 1.25rem;
    margin: 0.5rem 0 1.25rem;
    display: inline-block;
  }
  img.qr { display: block; border-radius: 8px; }
  code {
    display: block;
    word-break: break-all;
    font-size: 0.8rem;
    color: #7a6655;
    margin-bottom: 1.5rem;
  }
  /* "Create another" is for the booth operator, not the visitor — tucked
     into the corner (a refresh does the same thing anyway) so it doesn't
     compete with the QR code. */
  a.admin-link {
    position: fixed;
    bottom: 1rem;
    right: 1.25rem;
    color: #c9bba9;
    font-size: 0.7rem;
    font-weight: 500;
    text-decoration: none;
  }
  a.admin-link:hover { color: #7a6655; }
  .below-card {
    position: relative;
    margin: 1.5rem auto 0;
    text-align: center;
  }
  .below-card button {
    background: none;
    border: none;
    padding: 0;
    color: #c9bba9;
    font-size: 0.7rem;
    font-weight: 500;
    cursor: pointer;
  }
  .below-card button:hover { color: #7a6655; }
  .below-card a {
    color: #c9bba9;
    font-size: 0.7rem;
    font-weight: 500;
    text-decoration: none;
  }
  .below-card a:hover { color: #7a6655; }
  .below-card > * + * { margin-top: 0.6rem; }
  .foot {
    position: relative;
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid #efe2d2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .foot span { font-size: 14px; font-weight: 600; color: #7a6655; letter-spacing: .02em; }
  .foot img { height: 84px; width: auto; }
  .nest { height: 96px; width: 96px; margin: 0 auto 1.25rem; display: block; }
  .nest-ring { transform-box: fill-box; transform-origin: center; }
  .nest-ring--outer { animation: nest-rot-o 2.88s ease-in-out infinite; }
  .nest-ring--inner { animation: nest-rot-i 2.16s ease-in-out infinite; }
  @keyframes nest-rot-o { 0% { transform: rotate(0deg); } 40% { transform: rotate(228deg); } 100% { transform: rotate(360deg); } }
  @keyframes nest-rot-i { 0% { transform: rotate(0deg); } 40% { transform: rotate(228deg); } 100% { transform: rotate(360deg); } }
  .btn-logo {
    display: block;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    margin: 0 auto;
    cursor: pointer;
  }
  .btn-logo .nest { height: 180px; width: 180px; margin: 0 auto; }
`;

// Dashed coral/honey rings around a teal dot — Nido's "Nest Ring" mark
// (components/Nest.astro), reproduced here as static markup (transparent
// background, unlike assets/nido-logo.png which bakes in a cream app-icon
// backdrop) since this service has no Astro build step.
const NEST_MARK = `
  <svg class="nest" viewBox="0 0 120 120" aria-hidden="true">
    <circle class="nest-ring nest-ring--outer" cx="60" cy="60" r="46" fill="none" stroke="#F25C2A" stroke-width="6" stroke-dasharray="14 9" stroke-linecap="round" />
    <circle class="nest-ring nest-ring--inner" cx="60" cy="60" r="31" fill="none" stroke="#F5A623" stroke-width="6" stroke-dasharray="11 8" stroke-linecap="round" />
    <circle cx="60" cy="60" r="11" fill="#0E9AA8" />
  </svg>
`;

const FOOTER = `
  <div class="foot">
    <span>Brought to you by</span>
    <img src="/assets/aha-logo.png" alt="Aha Labs" />
  </div>
`;

const page = (body: string, belowCard: string = "") => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Fraunces:wght@800&family=Hanken+Grotesk:wght@400;600&display=swap"
    />
    <style>${PAGE_STYLE}</style>
  </head>
  <body>
    <div class="halo"></div>
    <div class="stack">
      <div class="card">${body}${FOOTER}</div>
      ${belowCard ? `<div class="below-card">${belowCard}</div>` : ""}
    </div>
  </body>
</html>`;

app.get("/", (_req, res) => {
  res.type("html").send(
    page(
      `
    <form method="POST" action="/invitations">
      <button type="submit" class="btn-logo" aria-label="Create Invitation">
        ${NEST_MARK}
      </button>
    </form>
    <h3>Click the logo to create a new invitation</h3>
  `,
      `
    <form method="POST" action="/test-print">
      <button type="submit">Test printer</button>
    </form>
    <a href="/debug/codes">Debug: invite codes</a>
    <a href="/relayer-accounts">Relayer account balances</a>
  `,
    ),
  );
});

function relayerKeysTable(rows: Array<{ name: string; address: string; network: StellarNetwork; balance: string | null }>): string {
  return `<table style="border-collapse: collapse;">
      <tr>
        <th style="text-align: left; padding: 0.5rem;">Name</th>
        <th style="text-align: left; padding: 0.5rem;">Address</th>
        <th style="text-align: left; padding: 0.5rem;">XLM Balance</th>
        <th style="text-align: left; padding: 0.5rem;"></th>
      </tr>
      ${rows
        .map(
          (row) => `<tr>
        <td style="padding: 0.5rem;">${row.name}</td>
        <td style="padding: 0.5rem; font-family: monospace;">${row.address}</td>
        <td style="padding: 0.5rem;">${row.balance ?? "not funded"}</td>
        <td style="padding: 0.5rem;"><a href="${STELLAR_EXPERT_ACCOUNT_URL[row.network]}/${row.address}" target="_blank" rel="noopener">stellar.expert</a></td>
      </tr>`,
        )
        .join("\n")}
    </table>`;
}

app.get("/relayer-accounts", (_req, res) => {
  (async () => {
    const rows = await Promise.all(
      RELAYER_KEYS.map(async (key) => ({
        ...key,
        balance: await fetchXlmBalance(key.address, key.network).catch(() => "error fetching balance"),
      })),
    );
    res.type("html").send(`<!doctype html>
<html>
  <body style="font-family: sans-serif; padding: 3rem;">
    <h1>Relayer Key Balances</h1>
    <h2>Testnet</h2>
    ${relayerKeysTable(rows.filter((r) => r.network === "testnet"))}
    <h2>Mainnet</h2>
    <p><em>Mainnet signers aren't provisioned yet — addresses below are placeholders, not real relayer keys.</em></p>
    ${relayerKeysTable(rows.filter((r) => r.network === "mainnet"))}
    <p><a href="/">Back</a></p>
  </body>
</html>`);
  })().catch((err) => {
    console.error("relayer key balances failed:", err);
    res.status(500).send("Something went wrong loading balances — check the server logs.");
  });
});

// For debugging why a receipt didn't print: infra/invite's own view of every
// code's lifecycle (issued -> claimed -> used -> delivered), straight from
// the same /codes endpoint curl would hit, so there's no separate curl +
// jq step needed to see where a given code got stuck.
app.get("/debug/codes", (_req, res) => {
  (async () => {
    const codes = await client.listCodes();
    const fmt = (ms: number | undefined) => (ms ? new Date(ms).toLocaleString() : "");

    const rows = codes
      .map(
        (c) => `<tr>
        <td style="padding: 0.4rem; font-family: monospace;">${c.code}</td>
        <td style="padding: 0.4rem;">${c.status}</td>
        <td style="padding: 0.4rem; font-family: monospace;">${c.address ?? ""}</td>
        <td style="padding: 0.4rem; white-space: nowrap;">${fmt(c.issuedAt)}</td>
        <td style="padding: 0.4rem; white-space: nowrap;">${fmt(c.claimedAt)}</td>
        <td style="padding: 0.4rem; white-space: nowrap;">${fmt(c.usedAt)}</td>
        <td style="padding: 0.4rem; white-space: nowrap;">${fmt(c.deliveredAt)}</td>
      </tr>`,
      )
      .join("\n");

    res.type("html").send(`<!doctype html>
<html>
  <body style="font-family: sans-serif; padding: 2rem;">
    <h1>Invite Codes</h1>
    <p><a href="/">Back</a></p>
    <table style="border-collapse: collapse; width: 100%;">
      <tr>
        <th style="text-align: left; padding: 0.4rem;">Code</th>
        <th style="text-align: left; padding: 0.4rem;">Status</th>
        <th style="text-align: left; padding: 0.4rem;">Address</th>
        <th style="text-align: left; padding: 0.4rem;">Issued</th>
        <th style="text-align: left; padding: 0.4rem;">Claimed</th>
        <th style="text-align: left; padding: 0.4rem;">Used</th>
        <th style="text-align: left; padding: 0.4rem;">Delivered</th>
      </tr>
      ${rows}
    </table>
  </body>
</html>`);
  })().catch((err) => {
    console.error("listing codes failed:", err);
    res.status(500).send("Something went wrong loading codes — check the server logs.");
  });
});

app.post("/test-print", (_req, res) => {
  (async () => {
    await printer.print({
      title: "Printer Test",
      lines: [`Sent from the demo admin page.`, new Date().toISOString()],
    });

    res.type("html").send(
      page(`
      ${NEST_MARK}
      <h1>Test receipt sent</h1>
      <h3>Check the printer for output.</h3>
      <a class="admin-link" href="/">Back</a>
    `),
    );
  })().catch((err) => {
    console.error("printer test failed:", err);
    res.status(500).send("Printer test failed — check the server logs.");
  });
});

app.post("/invitations", (_req, res) => {
  (async () => {
    const { code } = await client.createCode();
    const invitation = await buildInvitation(code, FRONTEND_BASE_URL);

    // Printing the invitation QR itself is on hold for now — the confirmation
    // receipt (receiptPoller.ts) is the one in active use. The admin page
    // below still shows the QR on screen so staff can hand it off either way.

    res.type("html").send(
      page(`
      ${NEST_MARK}
      <h1>Welcome to <em>Nido</em>!</h1>
      <div class="qr-box">
        <img class="qr" src="${invitation.qrDataUrl}" alt="QR code" width="260" height="260" />
        <h3>Scan to create your Nido</h3>
      </div>
      <code>${invitation.url}</code>
      <a class="admin-link" href="/">Create another</a>
    `),
    );
  })().catch((err) => {
    console.error("invitation creation failed:", err);
    res.status(500).send("Something went wrong creating the invitation — check the server logs.");
  });
});

startReceiptPolling(client, printer, RECEIPT_POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`nido-demo-service listening on http://localhost:${PORT} (invite API: ${INVITE_API_URL})`);
});
