import express from "express";
import { fetchXlmBalance } from "./horizonBalance.js";
import { InviteClient } from "./inviteClient.js";
import { buildInvitation } from "./invitationHandler.js";
import { createPrinter } from "./printerFactory.js";
import { RELAYER_KEYS, type StellarNetwork } from "./relayerKeys.js";
import { startReceiptPolling } from "./receiptPoller.js";
import { requestLogger } from "./requestLogger.js";

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

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
  <body style="font-family: sans-serif; text-align: center; padding: 3rem;">
    <h1>Nido Demo</h1>
    <form method="POST" action="/invitations">
      <button type="submit" style="font-size: 1.5rem; padding: 1rem 2rem;">Create Invitation</button>
    </form>
    <p><a href="/relayer-accounts">Relayer account balances</a></p>
  </body>
</html>`);
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

app.post("/invitations", (_req, res) => {
  (async () => {
    const { code } = await client.createCode();
    const invitation = await buildInvitation(code, FRONTEND_BASE_URL);

    // Printing the invitation QR itself is on hold for now — the confirmation
    // receipt (receiptPoller.ts) is the one in active use. The admin page
    // below still shows the QR on screen so staff can hand it off either way.

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
