# nido-demo-service

Runs **locally on the laptop at a demo booth** — never deployed to Fly (see
`demo-plan.md` at the repo root for the full flow and why the connections
only ever go this direction: the laptop can't be reached from the outside,
so it always calls out to `infra/invite`, never the other way around).

Two roles in one process:

- **Demo Server + InvitationHandler** — `GET /` renders a page with a
  "Create Invitation" button for the Admin; `POST /invitations` calls
  `infra/invite`'s Builder (`POST /codes`), builds the `/demo/start?invitationCode=...`
  URL and its QR code (`src/invitationHandler.ts`), and shows it on screen so
  staff can hand it off to a visitor. Printing the invitation card itself is
  on hold for now (see `src/index.ts`) — the confirmation receipt below is
  the one in active use.
- **ReceiptPoller** (`src/receiptPoller.ts`) — a background loop that pulls
  from `infra/invite`'s `/pending-print/next` + `/pending-print/:code/ack`
  (not a bulk code listing — see that service's README for why) and prints a
  receipt once a visitor's wallet is confirmed on chain.

`GET /relayer-accounts` shows the XLM balance (from Horizon testnet and
mainnet) and a stellar.expert link for each of the relayer's Turnkey-backed
signers (`src/relayerKeys.ts` — hardcoded from `infra/relayer/config/config.json`;
mainnet entries are placeholder keys, not real ones, until those signers are
provisioned), so staff can check at a glance whether the relayer is at risk
of running dry mid-demo.

`GET /debug/codes` (an "invite codes" link on the home page) shows
`infra/invite`'s own `/codes` listing — every code's status, address, and
issued/claimed/used/delivered timestamps — so a code stuck mid-flow (e.g.
`claimed` but never reaching `used`, or `used` with no `deliveredAt`) is
visible without a separate `curl` + the API key.

## Printer

`src/printer.ts` defines a `Printer` interface with one method, `print(job)`.
`src/escposBytes.ts` builds the actual ESC/POS byte stream for a job
(transport-agnostic). `src/printerFactory.ts` picks the implementation from
`PRINTER_DRIVER`:

- **Unset (local dev, the default)** — `FilePrinter` (`src/printer.ts`), which
  writes each job to a timestamped `.txt` (+ `.png` for the QR) under
  `PRINT_OUTPUT_DIR` and logs it. No hardware needed.
- **`cups`** — `CupsPrinter` (`src/cupsPrinter.ts`), which prints through a
  CUPS "raw"-equivalent queue (`scripts/setup-printer-queue.sh` registers
  one) via `lp -o raw`. **This is the one to use on macOS.** Confirmed by
  direct testing (both this code and `../fordefi-waas/client/receipt.ts`
  unmodified, under both Node and Bun): macOS's own generic USB-printer-class
  driver auto-claims the printer's interface the instant a raw USB client
  releases it — the first open per physical connection works, every one
  after fails with "could not open device for exclusive access", regardless
  of delay, with no userspace fix (no macOS equivalent of Linux's
  `detachKernelDriver`). Printing through CUPS (which already owns the
  device) sidesteps that conflict entirely instead of racing it.
- **`usb`** — `EscposUsbPrinter` (`src/escposPrinter.ts`), which talks ESC/POS
  directly to a USB thermal receipt printer via raw bulk transfers. Kept for
  platforms where the above macOS conflict doesn't apply; don't use it on
  macOS.

All three implement the same `Printer` interface, so swapping drivers needs
no other code changes. Both printer implementations throw instead of
silently no-op'ing when something's wrong (device/queue not found, `lp`
fails) — see their doc comments for why that matters for ReceiptPoller's ack
semantics.

### Receipt branding

`src/escposBytes.ts` builds every receipt with the same shape: the Nido mark
+ "Welcome to Nido!", then the job's own title/lines/QR, then a "brought to
you by" Aha logo (`assets/nido-logo.png`, `assets/aha-logo.png`). Known
issue, not yet resolved: the Nido logo garbles into noise on the real
hardware intermittently, non-deterministically — confirmed by repeat testing
that the *exact same bytes* print clean sometimes and garble other times,
with no pixel-size or timing variable found that makes it reliable. The Aha
logo and QR code have not shown this problem. If this resurfaces before a
live event, it's a known risk, not a regression — see `escposBytes.ts`'s doc
comments for the full investigation (SVG vs. PNG source, threshold, sizing).

### One-time hardware setup (macOS, `cups` driver)

```bash
./scripts/setup-printer-queue.sh              # registers queue "nido-receipt-printer"
PRINTER_DRIVER=cups npm run dev
```

`lpadmin -m raw` (CUPS's usual raw-queue shortcut) is explicitly blocked on
macOS ("Raw queues are no longer supported on macOS") even though
`lpinfo -m` still lists it as a model — the script works around this with a
minimal custom PPD whose only filter is a null passthrough. To remove the
queue later: `lpadmin -x nido-receipt-printer`.

### Testing the printer

`POST /test-print` (a "Test printer" link on the home page) sends a one-line
test receipt through whichever `Printer` the running server is actually
configured with (`PRINTER_DRIVER`) — unlike `scripts/test-printer.ts`, which
only exercises `EscposUsbPrinter` directly and needs no server running at
all.

## Env vars

| Var | Default | What |
| --- | --- | --- |
| `PORT` | `4000` | This service's own HTTP port |
| `INVITE_API_URL` | `http://localhost:8080` | Base URL of `infra/invite` |
| `INVITE_API_KEY` | unset | Must match `infra/invite`'s `API_KEY` secret once that's set |
| `FRONTEND_BASE_URL` | `https://nido.fyi` | Where the QR code points visitors |
| `RECEIPT_POLL_INTERVAL_MS` | `5000` | How often ReceiptPoller checks for confirmed signups |
| `PRINT_OUTPUT_DIR` | `./print-jobs` | Where `FilePrinter` writes its stand-in output |
| `PRINTER_DRIVER` | unset (`FilePrinter`) | `cups` (macOS) or `usb` (other platforms) for real hardware |
| `PRINTER_QUEUE_NAME` | `nido-receipt-printer` | CUPS queue name (`cups` driver only) |
| `PRINTER_VENDOR_ID` | `0x0416` | USB vendor ID (`usb` driver only) |
| `PRINTER_PRODUCT_ID` | `0x5011` | USB product ID (`usb` driver only) |
| `PRINTER_WARMUP_MS` | `3000` | Delay before each print, matching the reference client (`usb` driver only) |
| `PRINTER_IMAGE_WIDTH_PX` | `384` | Raster width the QR image is resized to before printing |

## Local dev

```bash
npm install
npm run dev     # tsx watch src/index.ts — point INVITE_API_URL at a locally-running infra/invite
npm test
```
