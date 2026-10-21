import type { NextFunction, Request, Response } from "express";

/** One line per request (method, path, status, duration) to stdout — no
 *  external logging library, this is a small spike service. Logs on
 *  `res.on("finish")` so it captures the real status code Express ends up
 *  sending, including from error handlers, not just what a route handler set. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
}
