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
`src/printerFactory.ts` picks the implementation from `PRINTER_DRIVER`:

- **Unset (local dev, the default)** — `FilePrinter` (`src/printer.ts`), which
  writes each job to a timestamped `.txt` (+ `.png` for the QR) under
  `PRINT_OUTPUT_DIR` and logs it. No hardware needed.
- **`usb`** — `EscposUsbPrinter` (`src/escposPrinter.ts`), which talks ESC/POS
  directly to a USB thermal receipt printer via raw bulk transfers (vendor/
  product ID, not a device path — same approach already validated against
  this hardware in `../fordefi-waas/client/receipt.ts`, not the
  `escpos`/`node-thermal-printer` libraries). Unlike that reference code, it
  throws instead of silently no-op'ing when the device isn't found — see the
  doc comment on `EscposUsbPrinter` for why that matters for ReceiptPoller's
  ack semantics.

Both implement the same interface, so swapping drivers needs no other code
changes; adding a third (a label printer, say) is the same pattern.

## Env vars

| Var | Default | What |
| --- | --- | --- |
| `PORT` | `4000` | This service's own HTTP port |
| `INVITE_API_URL` | `http://localhost:8080` | Base URL of `infra/invite` |
| `INVITE_API_KEY` | unset | Must match `infra/invite`'s `API_KEY` secret once that's set |
| `FRONTEND_BASE_URL` | `https://nido.fyi` | Where the QR code points visitors |
| `RECEIPT_POLL_INTERVAL_MS` | `5000` | How often ReceiptPoller checks for confirmed signups |
| `PRINT_OUTPUT_DIR` | `./print-jobs` | Where `FilePrinter` writes its stand-in output |
| `PRINTER_DRIVER` | unset (`FilePrinter`) | Set to `usb` to print to the real ESC/POS hardware |
| `PRINTER_VENDOR_ID` | `0x0416` | USB vendor ID (`usb` driver only) |
| `PRINTER_PRODUCT_ID` | `0x5011` | USB product ID (`usb` driver only) |
| `PRINTER_WARMUP_MS` | `3000` | Delay before each print, matching the reference client (`usb` driver only) |
| `PRINTER_IMAGE_WIDTH_PX` | `384` | Raster width the QR image is resized to before printing (`usb` driver only) |

## Local dev

```bash
npm install
npm run dev     # tsx watch src/index.ts — point INVITE_API_URL at a locally-running infra/invite
npm test
```
