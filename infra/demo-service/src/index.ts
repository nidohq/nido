import express from "express";
import { InviteClient } from "./inviteClient.js";
import { buildInvitation } from "./invitationHandler.js";
import { FilePrinter } from "./printer.js";
import { startReceiptPolling } from "./receiptPoller.js";

const PORT = Number(process.env.PORT ?? 4000);
const INVITE_API_URL = (process.env.INVITE_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const INVITE_API_KEY = process.env.INVITE_API_KEY;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? "https://nido.fyi";
const RECEIPT_POLL_INTERVAL_MS = Number(process.env.RECEIPT_POLL_INTERVAL_MS ?? 5000);
const PRINT_OUTPUT_DIR = process.env.PRINT_OUTPUT_DIR ?? "./print-jobs";

const client = new InviteClient(INVITE_API_URL, INVITE_API_KEY);
const printer = new FilePrinter(PRINT_OUTPUT_DIR);

const app = express();

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
  <body style="font-family: sans-serif; text-align: center; padding: 3rem;">
    <h1>Nido Demo</h1>
    <form method="POST" action="/invitations">
      <button type="submit" style="font-size: 1.5rem; padding: 1rem 2rem;">Create Invitation</button>
    </form>
  </body>
</html>`);
});

// Admin: "press button to create an invitation & QR code" (demo-plan.md).
app.post("/invitations", (_req, res) => {
  (async () => {
    const { code } = await client.createCode();
    const invitation = await buildInvitation(code, FRONTEND_BASE_URL);

    await printer.print({
      title: "Scan to create your Nido!",
      lines: [invitation.url],
      qrDataUrl: invitation.qrDataUrl,
    });

    res.type("html").send(`<!doctype html>
<html>
  <body style="font-family: sans-serif; text-align: center; padding: 3rem;">
    <h1>Scan this to create your Nido!</h1>
    <img src="${invitation.qrDataUrl}" alt="QR code" width="300" height="300" />
    <p><code>${invitation.url}</code></p>
    <p><a href="/">Create another</a></p>
  </body>
</html>`);
  })().catch((err) => {
    console.error("invitation creation failed:", err);
    res.status(500).send("Something went wrong creating the invitation — check the server logs.");
  });
});

startReceiptPolling(client, printer, RECEIPT_POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`nido-demo-service listening on :${PORT} (invite API: ${INVITE_API_URL})`);
});
