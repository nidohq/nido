import express from "express";
import { InviteClient } from "./inviteClient.js";
import { buildInvitation } from "./invitationHandler.js";
import { createPrinter } from "./printerFactory.js";
import { startReceiptPolling } from "./receiptPoller.js";
import { requestLogger } from "./requestLogger.js";

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

// Nido's own warm-nest palette (packages/frontend/src/styles/nido.css), so
// the booth operator's screen looks like the rest of the product instead of
// bare browser defaults. This is the only page, so one inlined <style> is
// simpler than a build step for a two-screen admin tool.
const PAGE_STYLE = `
  :root { color-scheme: light; }
  body {
    font-family: "Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #FFF8F0;
    color: #2A1A12;
    min-height: 100vh;
    margin: 0;
    display: grid;
    place-items: center;
    padding: 2rem;
  }
  .card {
    background: #fff;
    border: 1px solid #efe2d2;
    border-radius: 20px;
    box-shadow: 0 10px 30px rgba(42, 26, 18, 0.08);
    padding: 3rem 2.5rem;
    max-width: 380px;
    width: 100%;
    text-align: center;
  }
  h1 { font-family: "Fraunces", serif; font-weight: 800; font-size: 1.6rem; margin: 0 0 1.75rem; }
  .btn {
    display: inline-block;
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
  img { border-radius: 12px; margin: 0.5rem 0 1.25rem; }
  code {
    display: block;
    word-break: break-all;
    font-size: 0.8rem;
    color: #7a6655;
    margin-bottom: 1.5rem;
  }
  a.link { color: #cf4a1e; font-weight: 600; text-decoration: none; }
`;

const page = (body: string) => `<!doctype html>
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
  <body><div class="card">${body}</div></body>
</html>`;

app.get("/", (_req, res) => {
  res.type("html").send(
    page(`
    <form method="POST" action="/invitations">
      <button type="submit" class="btn">Create Invitation</button>
    </form>
  `),
  );
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
      <h1>Scan this to create your Nido!</h1>
      <img src="${invitation.qrDataUrl}" alt="QR code" width="260" height="260" />
      <code>${invitation.url}</code>
      <a class="link" href="/">Create another</a>
    `),
    );
  })().catch((err) => {
    console.error("invitation creation failed:", err);
    res.status(500).send("Something went wrong creating the invitation — check the server logs.");
  });
});

startReceiptPolling(client, printer, RECEIPT_POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`nido-demo-service listening on :${PORT} (invite API: ${INVITE_API_URL})`);
});
