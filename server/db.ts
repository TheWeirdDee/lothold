// SQLite persistence (node:sqlite). WAL mode, foreign keys on, append-only audit tables enforced by triggers.
// Inventory mutations run inside BEGIN IMMEDIATE transactions so concurrent reservations serialise.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type DB = DatabaseSync;

const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  chain_enabled INTEGER NOT NULL DEFAULT 0 CHECK (chain_enabled IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reviewer','admin')),
  created_at TEXT NOT NULL
);
CREATE INDEX users_org ON users(org_id);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE shipments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  reference TEXT NOT NULL CHECK (length(reference) BETWEEN 1 AND 50),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, reference)
);
CREATE TABLE shipment_field_values (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  field TEXT NOT NULL,
  value TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual','extraction')),
  extraction_id TEXT REFERENCES extractions(id),
  revision INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (shipment_id, field, revision)
);
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  kind TEXT NOT NULL CHECK (kind IN ('sources_csv','plots_geojson','document','review_evidence')),
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  media_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  parser TEXT,
  parser_version TEXT,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed','rejected','stored')),
  parse_error TEXT,
  parsed_json TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL,
  UNIQUE (shipment_id, kind, sha256)
);
CREATE INDEX uploads_shipment ON uploads(shipment_id, kind);
-- Which upload is the active, human-confirmed source of each kind. Append-only; latest row wins.
CREATE TABLE confirmations (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  kind TEXT NOT NULL CHECK (kind IN ('sources_csv','plots_geojson')),
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  confirmed_by TEXT NOT NULL REFERENCES users(id),
  confirmed_at TEXT NOT NULL,
  seq INTEGER NOT NULL,
  UNIQUE (shipment_id, kind, seq)
);
CREATE TABLE env_results (
  id TEXT PRIMARY KEY,
  geometry_hash TEXT NOT NULL,
  method_version TEXT NOT NULL,
  datasets_key TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (geometry_hash, method_version, datasets_key)
);
CREATE TABLE source_lots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  supplier_id TEXT NOT NULL,
  source_lot_ref TEXT NOT NULL,
  declared_grams INTEGER NOT NULL CHECK (declared_grams > 0),
  first_upload_id TEXT NOT NULL REFERENCES uploads(id),
  created_at TEXT NOT NULL,
  chain_batch_key TEXT,
  UNIQUE (org_id, supplier_id, source_lot_ref)
);
CREATE TABLE allocations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  source_lot_id TEXT NOT NULL REFERENCES source_lots(id),
  grams INTEGER NOT NULL CHECK (grams > 0),
  sources_upload_id TEXT NOT NULL REFERENCES uploads(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('reserved','released')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  released_at TEXT
);
CREATE UNIQUE INDEX allocations_active ON allocations(shipment_id, source_lot_id) WHERE status = 'reserved';
CREATE INDEX allocations_lot ON allocations(source_lot_id, status);
CREATE TABLE chain_txs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  shipment_id TEXT REFERENCES shipments(id),
  allocation_id TEXT REFERENCES allocations(id),
  source_lot_id TEXT REFERENCES source_lots(id),
  action TEXT NOT NULL CHECK (action IN ('registerBatch','authorizeReserver','reserve')),
  idempotency_key TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  signer TEXT NOT NULL,
  args_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','preflight_rejected','pending','confirmed','reverted','rpc_error')),
  tx_hash TEXT,
  block_number INTEGER,
  detail TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX chain_txs_status ON chain_txs(status);
CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  finding_key TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('investigated_not_blocking','keep_on_hold')),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 4000),
  evidence_upload_id TEXT REFERENCES uploads(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  snapshot_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX review_decisions_shipment ON review_decisions(shipment_id, created_at);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  snapshot_digest TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE extractions (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  provider TEXT NOT NULL,
  model TEXT,
  config_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed','unavailable')),
  candidates_json TEXT,
  validation_json TEXT,
  error TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  kind TEXT NOT NULL CHECK (kind IN ('supplier_request_pdf','review_draft_pdf','dds_xml')),
  snapshot_digest TEXT NOT NULL,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  validation_json TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX documents_shipment ON documents(shipment_id, kind, created_at);
CREATE TABLE audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  org_id TEXT,
  shipment_id TEXT,
  actor_id TEXT,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_shipment ON audit_events(shipment_id, seq);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX jobs_ready ON jobs(status, run_after);
CREATE TABLE rate_events (
  bucket TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE INDEX rate_events_bucket ON rate_events(bucket, at_ms);

-- Append-only enforcement.
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON review_decisions BEGIN SELECT RAISE(ABORT, 'review_decisions is append-only'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON review_decisions BEGIN SELECT RAISE(ABORT, 'review_decisions is append-only'); END;
CREATE TRIGGER approvals_no_update BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT, 'approvals is append-only'); END;
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals BEGIN SELECT RAISE(ABORT, 'approvals is append-only'); END;
CREATE TRIGGER confirmations_no_update BEFORE UPDATE ON confirmations BEGIN SELECT RAISE(ABORT, 'confirmations is append-only'); END;
CREATE TRIGGER fields_no_update BEFORE UPDATE ON shipment_field_values BEGIN SELECT RAISE(ABORT, 'field values are append-only'); END;
CREATE TRIGGER uploads_bytes_immutable BEFORE UPDATE OF sha256, storage_key, bytes ON uploads BEGIN SELECT RAISE(ABORT, 'upload bytes are immutable'); END;
CREATE TRIGGER source_lots_declared_immutable BEFORE UPDATE OF declared_grams ON source_lots BEGIN SELECT RAISE(ABORT, 'declared quantity is immutable'); END;
`,
  },
  {
    id: 2,
    name: 'audited source-lot total corrections',
    // The first declared total stays immutable; a correction is a new, append-only record with rationale and
    // evidence, and the latest correction (by seq) is the effective declared total.
    sql: `
CREATE TABLE source_lot_corrections (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  source_lot_id TEXT NOT NULL REFERENCES source_lots(id),
  seq INTEGER NOT NULL,
  previous_grams INTEGER NOT NULL,
  new_grams INTEGER NOT NULL CHECK (new_grams > 0),
  from_upload_id TEXT NOT NULL REFERENCES uploads(id),
  rationale TEXT NOT NULL,
  evidence_upload_id TEXT NOT NULL REFERENCES uploads(id),
  corrected_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (source_lot_id, seq)
);
CREATE TRIGGER lot_corrections_no_update BEFORE UPDATE ON source_lot_corrections BEGIN SELECT RAISE(ABORT, 'source_lot_corrections is append-only'); END;
CREATE TRIGGER lot_corrections_no_delete BEFORE DELETE ON source_lot_corrections BEGIN SELECT RAISE(ABORT, 'source_lot_corrections is append-only'); END;
`,
  },
  {
    id: 3,
    name: 'optional in-database evidence store',
    // Used only with EVIDENCE_STORE=sqlite: the same encrypted objects as on disk, stored with the database so a
    // host without a persistent disk can replicate everything (e.g. with Litestream). Written once, never changed.
    sql: `
CREATE TABLE evidence_blobs (
  storage_key TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER evidence_blobs_no_update BEFORE UPDATE ON evidence_blobs BEGIN SELECT RAISE(ABORT, 'evidence objects are immutable'); END;
`,
  },
];

/** SQL expression for a source lot's effective declared total (latest audited correction, else the first total). */
export const EFFECTIVE_DECLARED_SQL = `COALESCE((SELECT c.new_grams FROM source_lot_corrections c WHERE c.source_lot_id = source_lots.id ORDER BY c.seq DESC LIMIT 1), source_lots.declared_grams)`;

export function openDb(path = process.env.DATABASE_PATH ?? 'data/lothold.sqlite'): DB {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    tx(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, now());
    });
  }
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) throw new Error(`foreign key check failed: ${JSON.stringify(fk.slice(0, 3))}`);
}

export function now(): string {
  return new Date().toISOString();
}
export function id(): string {
  return randomUUID();
}

let depth = 0;
/** Runs fn in an IMMEDIATE transaction (write lock taken up front). Nested calls join the outer transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export function get<T>(db: DB, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function all<T>(db: DB, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function run(db: DB, sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

export function audit(db: DB, e: { orgId?: string | null; shipmentId?: string | null; actorId?: string | null; type: string; data?: unknown }) {
  run(db, 'INSERT INTO audit_events (id, org_id, shipment_id, actor_id, type, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id(), e.orgId ?? null, e.shipmentId ?? null, e.actorId ?? null, e.type, JSON.stringify(e.data ?? {}), now());
}
