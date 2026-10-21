import pg from "pg";
import type { CodeRecord, CodeStatus } from "./types.js";
import type { CodeStore } from "./codeStore.js";

// Fly Postgres gives you plain Postgres, so plain `pg` talks to it directly —
// no ORM needed for one table.
const { Pool } = pg;

function rowToRecord(row: {
  code: string;
  status: CodeStatus;
  address: string | null;
  issued_at: string;
  claimed_at: string | null;
  used_at: string | null;
  delivered_at: string | null;
  expires_at: string;
}): CodeRecord {
  return {
    code: row.code,
    status: row.status,
    address: row.address ?? undefined,
    // BIGINT comes back as a string from `pg` (JS numbers can't safely hold
    // every 64-bit value); our ms-epoch timestamps fit in Number safely for
    // the next ~285,000 years, so a plain Number() conversion is fine.
    issuedAt: Number(row.issued_at),
    claimedAt: row.claimed_at === null ? undefined : Number(row.claimed_at),
    usedAt: row.used_at === null ? undefined : Number(row.used_at),
    deliveredAt: row.delivered_at === null ? undefined : Number(row.delivered_at),
    expiresAt: Number(row.expires_at),
  };
}

export class PostgresStore implements CodeStore {
  private pool: InstanceType<typeof Pool>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS codes (
        code TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        address TEXT,
        issued_at BIGINT NOT NULL,
        claimed_at BIGINT,
        used_at BIGINT,
        delivered_at BIGINT,
        expires_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS codes_status_idx ON codes (status);
      -- Backs nextPendingPrint's WHERE + ORDER BY in one index.
      CREATE INDEX IF NOT EXISTS codes_pending_print_idx ON codes (used_at) WHERE status = 'used' AND delivered_at IS NULL;
    `);
  }

  async put(record: CodeRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO codes (code, status, address, issued_at, claimed_at, used_at, delivered_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO UPDATE SET
         status = EXCLUDED.status,
         address = EXCLUDED.address,
         claimed_at = EXCLUDED.claimed_at,
         used_at = EXCLUDED.used_at,
         delivered_at = EXCLUDED.delivered_at,
         expires_at = EXCLUDED.expires_at`,
      [
        record.code,
        record.status,
        record.address ?? null,
        record.issuedAt,
        record.claimedAt ?? null,
        record.usedAt ?? null,
        record.deliveredAt ?? null,
        record.expiresAt,
      ],
    );
  }

  async get(code: string): Promise<CodeRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM codes WHERE code = $1", [code]);
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async listByStatus(status: CodeStatus): Promise<CodeRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM codes WHERE status = $1", [status]);
    return rows.map(rowToRecord);
  }

  async all(): Promise<CodeRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM codes");
    return rows.map(rowToRecord);
  }

  async nextPendingPrint(): Promise<CodeRecord | undefined> {
    const { rows } = await this.pool.query(
      "SELECT * FROM codes WHERE status = 'used' AND delivered_at IS NULL ORDER BY used_at ASC LIMIT 1",
    );
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }
}
