# nido-invite

Invitation-code service for in-person demo events (see `demo-plan.md` at the
repo root for the full flow diagram). Three roles in one process:

- **Builder** — `POST /codes`: mints a fresh code for the local Demo Server to
  print on a QR code.
- **Checker** — `POST /codes/:code/check` (body `{ address }`): the dApp calls
  this before proceeding with account creation. Validates the code and
  atomically binds `address` (the setup-key-predicted C-address, known before
  `create_account` runs — see `contracts/factory`) to it in the same call, so
  two concurrent requests can't bind two different addresses to one code.
- **Poller** — background loop, no HTTP surface: watches the chain directly
  for each claimed code's bound address to actually exist, and marks the code
  `used` once it does. This confirms completion independently of the
  browser — a crashed tab or an unreported failure just leaves the code
  `expired`, not falsely `used`.

A code moves `issued` → `claimed` → `used`, or → `expired` if the TTL
(`CODE_TTL_MS`, default 30 min) lapses first.

## Known spike limitations

- **Store is in-memory** (`src/store.ts`) — every code is lost on
  restart/redeploy. Fine for the span of one demo event; swap for Redis
  (`infra/relayer-redis` already runs one) or SQLite before this needs to
  survive longer.
- No auth on any endpoint yet — anyone who can reach the Fly app can mint or
  claim codes. Acceptable only because the codes themselves gate nothing of
  value beyond "allowed to try creating a wallet."
- No rate limiting.

## Local dev

```bash
npm install
npm run dev     # tsx watch src/index.ts
npm test
```

## Deploy

```bash
fly deploy
```
