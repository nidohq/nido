import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { createStore } from "./storeFactory.js";
import { issueCode } from "./builder.js";
import { checkAndClaim } from "./checker.js";
import { startPolling } from "./poller.js";
import { requireApiKey } from "./auth.js";

const PORT = Number(process.env.PORT ?? 8080);
const CODE_TTL_MS = Number(process.env.CODE_TTL_MS ?? 7 * 24 * 60 * 60 * 1000); // 1 week
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);

// Express 4 doesn't catch a rejected promise from an async handler itself —
// without this, a DB error partway through a request just hangs it forever
// instead of answering with a 500.
function asyncHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

async function main() {
  const store = await createStore();

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use(requireApiKey);

  // Builder: called by the local Demo Server to mint a code for a visitor.
  app.post(
    "/codes",
    asyncHandler(async (_req, res) => {
      res.status(201).json(await issueCode(store, CODE_TTL_MS));
    }),
  );

  // Checker: called by the dApp before it proceeds with account creation.
  app.post(
    "/codes/:code/check",
    asyncHandler(async (req, res) => {
      const address = req.body?.address;
      if (typeof address !== "string" || !address) {
        res.status(400).json({ ok: false, reason: "missing_address" });
        return;
      }

      const result = await checkAndClaim(store, req.params.code, address);
      res.status(result.ok ? 200 : 409).json(result);
    }),
  );

  // Status lookup: used by the local InvitationHandler/Poller debugging, and
  // by the dApp if it wants to confirm its own code reached "used".
  app.get(
    "/codes/:code",
    asyncHandler(async (req, res) => {
      const record = await store.get(req.params.code);
      if (!record) {
        res.status(404).json({ ok: false, reason: "not_found" });
        return;
      }
      res.json(record);
    }),
  );

  app.get(
    "/codes",
    asyncHandler(async (_req, res) => {
      res.json(await store.all());
    }),
  );

  // Called by the local Demo Server's receipt poller. Read-only: returns the
  // oldest confirmed-but-unprinted code without marking anything, so a crash
  // between this call and the printer actually finishing just means the same
  // code comes back next time — missing a receipt is worse than a rare
  // duplicate, so this deliberately favors at-least-once over exactly-once.
  app.get(
    "/pending-print/next",
    asyncHandler(async (_req, res) => {
      const record = await store.nextPendingPrint();
      if (!record) {
        res.status(204).end();
        return;
      }
      res.json(record);
    }),
  );

  // Called only after the printer confirms the job actually completed.
  app.post(
    "/pending-print/:code/ack",
    asyncHandler(async (req, res) => {
      const record = await store.get(req.params.code);
      if (!record) {
        res.status(404).json({ ok: false, reason: "not_found" });
        return;
      }
      if (record.status !== "used") {
        res.status(409).json({ ok: false, reason: "not_pending_print" });
        return;
      }
      await store.put({ ...record, deliveredAt: Date.now() });
      res.json({ ok: true });
    }),
  );

  startPolling(store, POLL_INTERVAL_MS);

  app.listen(PORT, () => {
    console.log(`nido-invite listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
