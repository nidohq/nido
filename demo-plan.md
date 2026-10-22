```mermaid
graph TD
    Visitor
    Admin
    Frontend["nido.fyi frontend<br/>/demo/start"]
    Stellar[("Stellar")]

    subgraph InviteSvc["infra/invite/ — Fly app (this repo)"]
        Builder["Builder<br/>issues codes"]
        Checker["Checker<br/>validates code,<br/>binds predicted C-address"]
        Poller["Poller<br/>watches Stellar: deployed AND funded?"]
        PendingPrint["PendingPrint API<br/>GET /pending-print/next<br/>POST /pending-print/:code/ack"]
        Store[("Store (Postgres)<br/>issued → claimed → used<br/>(+ expired, + deliveredAt)")]
        Builder --> Store
        Checker --> Store
        Poller --> Store
        PendingPrint --> Store
    end

    subgraph Demo["infra/demo-service/ — runs locally on the laptop at the booth"]
        Server["Demo Server"]
        InvitationHandler["InvitationHandler<br/>builds the QR"]
        ReceiptPoller["ReceiptPoller<br/>drains PendingPrint"]
        Printer["Printer<br/>CUPS raw queue → ESC/POS<br/>Nido mark + Aha logo on every receipt"]
        Server -->|"create code"| Builder
        Server --> InvitationHandler
        InvitationHandler -.->|"QR shown on screen<br/>(printing it: on hold)"| Server
        ReceiptPoller -->|"GET .../next"| PendingPrint
        ReceiptPoller -->|"confirmation receipt"| Printer
        ReceiptPoller -->|"POST .../ack"| PendingPrint
    end

    Visitor -->|"Hi, can I have a Nido?"| Admin
    Admin -->|"press button"| Server
    Server -->|"scan this QR<br/>(invitation code embedded)"| Visitor
    Visitor -->|"/demo/start?invitationCode=xxx"| Frontend
    Frontend -->|"predict C-address, then<br/>check code + address"| Checker

    Poller --> Stellar
```

Invitation-code printing (`InvitationHandler → Printer`) is wired but paused —
the QR still shows on the Demo Server's own screen, so the flow works without
it. The confirmation receipt (`ReceiptPoller → Printer`) is the one in active
use; see `infra/demo-service/README.md`'s "Printer" section for the ESC/POS
hardware driver (CUPS, not raw USB — macOS won't allow the latter reliably)
and the branding on every receipt.

## Why the Poller stays remote and Printer confirmation is pulled, not pushed

The remote `infra/invite` service can't reach into the local Demo Server's
laptop at a conference booth (no inbound route — NAT, firewalls, "not on
Fly's network" in general). So nothing here ever has the remote side
initiate a connection to the local side. Instead:

- The **Poller** (chain-watching) stays remote, next to the Postgres Store it
  already reads and writes — it's the one piece that genuinely needs Stellar
  RPC access, and the already-public, already-deployed Fly app is a better
  place for that than a laptop.
- The local **ReceiptPoller** pulls from a small dedicated API
  (`/pending-print/next` + `/pending-print/:code/ack`) instead of the local
  side polling a bulk `GET /codes` and re-deriving which ones are ready —
  `next` already returns exactly the one thing it needs to act on next, in
  order.
- Splitting "what's next" from "mark it done" into two calls means a local
  crash between them just reprints the same receipt on restart rather than
  silently dropping it — nothing durable about "what's still pending" ever
  lives only in the local process's memory, so a laptop restart can't lose a
  visitor's receipt.
- The Poller checks the account is both **deployed and funded** before
  marking a code `used` — deployment alone used to flip it, which fired the
  confirmation receipt before the (separate, async) funding step had
  finished. See `infra/invite/src/chain.ts`'s `isFunded`.
