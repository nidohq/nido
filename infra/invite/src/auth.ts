import type { NextFunction, Request, Response } from "express";

/** Shared-secret gate meant to admit only the Nido frontend. It cannot
 *  actually stop a determined caller: the key has to ship inside the
 *  frontend's JS bundle (a static site, no backend of its own) for the
 *  dApp to call this service at all, so anyone can read it out of the page
 *  source the same way `infra/relayer/Caddyfile`'s own API key is public —
 *  that file documents the identical caveat. This only raises the bar past
 *  casual/automated scanning, same as the relayer's.
 *
 *  Unset `API_KEY` (local dev) skips the check entirely. */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_KEY;
  if (!expected) {
    next();
    return;
  }
  if (req.header("x-api-key") !== expected) {
    res.status(401).json({ ok: false, reason: "unauthorized" });
    return;
  }
  next();
}
