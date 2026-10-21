```mermaid
graph TD
    Visitor
    Admin
    Frontend["nido.fyi frontend"]

    subgraph InviteSvc["infra/invite/ — Fly app (this repo)"]
        Builder["Builder<br/>(issue codes)"]
        Checker["Checker<br/>(validate + bind C-address)"]
        Poller["Poller<br/>(watches Stellar for claimed addresses)"]
        PendingPrint["PendingPrint API<br/>(GET /pending-print/next,<br/>POST /pending-print/:code/ack)"]
        Store[("Store (Postgres)<br/>issued / claimed / used / expired<br/>+ deliveredAt")]
        Builder --> Store
        Checker --> Store
        Poller --> Store
        PendingPrint --> Store
    end

    subgraph Demo["Demo service — runs locally on Elizabeth's computer"]
        Server["Demo Server"]
        Printer["Printer"]
        InvitationHandler["InvitationHandler<br/>creates the QR code"]
        ReceiptPoller["ReceiptPoller<br/>polls PendingPrint for confirmed signups"]
        Server -->|"create code"| Builder
        Server --> InvitationHandler
        InvitationHandler --> Printer
        InvitationHandler --> |"here's the QR code"| Server
        ReceiptPoller -->|"GET /pending-print/next"| PendingPrint
        ReceiptPoller --> Printer
        ReceiptPoller -->|"POST .../ack"| PendingPrint
    end

    Visitor -->|"Hi, can I have a Nido?"| Admin
    Admin -->|"press button to create an invitation & QR code"| Server
    Server -->|"Here's your QR code, scan it!</br>invitation code is embeded"| Visitor
    Visitor -->|"/demo/start?invitationCode=xxx"| Frontend
    Frontend -->|"check code + predicted C-address<br/>before allowing account creation"| Checker

    Poller --> Stellar
```

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
