# nido-demo-service

Runs **locally on the laptop at a demo booth** — never deployed to Fly (see
`demo-plan.md` at the repo root for the full flow and why the connections
only ever go this direction: the laptop can't be reached from the outside,
so it always calls out to `infra/invite`, never the other way around).

Two roles in one process:

- **Demo Server + InvitationHandler** — `GET /` renders a page with a
  "Create Invitation" button for the Admin; `POST /invitations` calls
  `infra/invite`'s Builder (`POST /codes`), builds the `/demo/start?invitationCode=...`
  URL and its QR code (`src/invitationHandler.ts`), prints an invitation card,
  and shows the same QR on screen so staff/visitor can scan it even without
  working printer hardware.
- **ReceiptPoller** (`src/receiptPoller.ts`) — a background loop that pulls
  from `infra/invite`'s `/pending-print/next` + `/pending-print/:code/ack`
  (not a bulk code listing — see that service's README for why) and prints a
  receipt once a visitor's wallet is confirmed on chain.

## Printer

`src/printer.ts` defines a `Printer` interface with one method, `print(job)`.
The only implementation right now, `FilePrinter`, just writes each job to a
timestamped `.txt` (+ `.png` for the QR) under `PRINT_OUTPUT_DIR` and logs it
— there's no real printer hardware wired up yet. Swap in a real driver (ESC/POS
receipt printer, a label printer, whatever ends up at the booth) by
implementing the same interface; nothing else in this service needs to
change.

## Env vars

| Var | Default | What |
| --- | --- | --- |
| `PORT` | `4000` | This service's own HTTP port |
| `INVITE_API_URL` | `http://localhost:8080` | Base URL of `infra/invite` |
| `INVITE_API_KEY` | unset | Must match `infra/invite`'s `API_KEY` secret once that's set |
| `FRONTEND_BASE_URL` | `https://nido.fyi` | Where the QR code points visitors |
| `RECEIPT_POLL_INTERVAL_MS` | `5000` | How often ReceiptPoller checks for confirmed signups |
| `PRINT_OUTPUT_DIR` | `./print-jobs` | Where `FilePrinter` writes its stand-in output |

## Local dev

```bash
npm install
npm run dev     # tsx watch src/index.ts — point INVITE_API_URL at a locally-running infra/invite
npm test
```
