# nido-invite

Invitation-code service for in-person demo events (see `demo-plan.md` at the
repo root for the full flow diagram). Four roles in one process:

- **Builder** — `POST /codes`: generates a fresh code and returns it to the client (the local Demo Server) to
  print on a QR code.
- **Checker** — `POST /codes/:code/check` (body `{ address }`): the dApp calls
  this before proceeding with account creation. Validates the code and
  atomically binds `address` (the setup-key-predicted C-address, known before
  `create_account` runs — see `contracts/factory`) to it in the same call, so
  two concurrent requests can't bind two different addresses to one code.
- **Poller** — background loop, no HTTP surface: watches the chain directly
  for each claimed code's bound address to be both **deployed and funded**
  (`src/chain.ts`'s `accountExists` + `isFunded`), and marks the code `used`
  only once both are true. Deployment alone isn't enough — it goes true the
  moment `create_account` confirms, well before the separate, sometimes-slow
  async funding step finishes, which used to print the confirmation receipt
  before the account was actually ready. This confirms completion
  independently of the browser — a crashed tab or an unreported failure just
  leaves the code `expired`, not falsely `used`. Stays remote deliberately —
  it's the one piece that needs chain access, and the local Demo Server (on a
  laptop, possibly behind NAT) is a worse place for that than this
  already-public, already-deployed service.
- **PendingPrint** — `GET /pending-print/next` + `POST /pending-print/:code/ack`:
  the local Demo Server's receipt-printing poller pulls from this instead of
  the remote service trying to reach back into the local machine (which
  generally can't be reached from the outside at all). `next` is read-only
  and returns the oldest `used`-but-unprinted code (FIFO by `usedAt`); `ack`
  marks it delivered only *after* the local printer confirms the job
  completed. Splitting those into two calls means a local-server crash
  between them just reprints the same receipt next time — a rare duplicate
  is far better than a silently dropped one.

A code moves `issued` → `claimed` → `used`, or → `expired` if the TTL
(`CODE_TTL_MS`, default 1 week) lapses first. `used` codes also carry a
`deliveredAt`, set once PendingPrint's `ack` fires.

## Store

`src/storeFactory.ts` picks the backend from `DATABASE_URL`:

- **Unset (local dev)** — `MemoryStore` (`src/memoryStore.ts`), a plain `Map`.
  Every code is lost when the process restarts; that's fine for iterating
  locally.
- **Set (deployed)** — `PostgresStore` (`src/postgresStore.ts`), plain `pg`
  against one `codes` table, created on boot if missing.

## Auth

All `/codes*` routes (not `/health`) require an `x-api-key` header matching
the `API_KEY` secret (`src/auth.ts`). This is a soft gate, not a real access
boundary: the key has to ship inside the frontend's JS bundle for the
(static, backend-less) dApp to call this service at all, so anyone can read
it out of the page source — the same caveat `infra/relayer/Caddyfile`
documents for its own key. It only raises the bar past casual/automated
scanning. Unset locally, the check is skipped entirely.

## Known spike limitations

- No rate limiting.
- `PostgresStore` hasn't been exercised against a real database yet — only
  type-checked and covered indirectly by `MemoryStore`'s tests (both
  implement the same `CodeStore` interface). Worth a manual pass against a
  real Postgres before the first real demo event.

## Local dev

```bash
npm install
npm run dev     # tsx watch src/index.ts
npm test
```

## Deploy

```bash
fly postgres create                  # one-time, if nido-invite's Postgres doesn't exist yet
fly postgres attach <postgres-app>   # injects DATABASE_URL as a secret
fly secrets set API_KEY=$(openssl rand -hex 32)
fly deploy
```
