import express from "express";
import { Store } from "./store.js";
import { issueCode } from "./builder.js";
import { checkAndClaim } from "./checker.js";
import { startPolling } from "./poller.js";

const PORT = Number(process.env.PORT ?? 8080);
const CODE_TTL_MS = Number(process.env.CODE_TTL_MS ?? 30 * 60 * 1000); // 30 min
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);

const store = new Store();
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Builder: called by the local Demo Server to mint a code for a visitor.
app.post("/codes", (_req, res) => {
  res.status(201).json(issueCode(store, CODE_TTL_MS));
});

// Checker: called by the dApp before it proceeds with account creation.
app.post("/codes/:code/check", (req, res) => {
  const address = req.body?.address;
  if (typeof address !== "string" || !address) {
    res.status(400).json({ ok: false, reason: "missing_address" });
    return;
  }

  const result = checkAndClaim(store, req.params.code, address);
  res.status(result.ok ? 200 : 409).json(result);
});

// Status lookup: used by the local InvitationHandler/Poller debugging, and
// by the dApp if it wants to confirm its own code reached "used".
app.get("/codes/:code", (req, res) => {
  const record = store.get(req.params.code);
  if (!record) {
    res.status(404).json({ ok: false, reason: "not_found" });
    return;
  }
  res.json(record);
});

app.get("/codes", (req, res) => {
  const all = store.all();
  res.json(all);
});

startPolling(store, POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`nido-invite listening on :${PORT}`);
});
