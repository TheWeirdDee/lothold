// Durable job queue in SQLite. Jobs survive restarts: a crashed worker's lease expires and the job is re-run.
import { type DB, get, id, now, run } from './db.ts';

export type JobHandler = (payload: any, ctx: { jobId: string; attempt: number }) => Promise<void>;
const LEASE_MS = 120_000;

export function enqueue(db: DB, type: string, payload: unknown, dedupeKey: string | null = null, maxAttempts = 3) {
  const t = now();
  if (dedupeKey) {
    const existing = get<{ id: string; status: string }>(db, 'SELECT id, status FROM jobs WHERE dedupe_key = ?', dedupeKey);
    if (existing) {
      if (existing.status === 'failed') run(db, `UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, last_error = NULL, updated_at = ? WHERE id = ?`, t, t, existing.id);
      return existing.id;
    }
  }
  const jid = id();
  run(db, `INSERT INTO jobs (id, type, dedupe_key, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`, jid, type, dedupeKey, JSON.stringify(payload), maxAttempts, t, t, t);
  return jid;
}

function claim(db: DB): { id: string; type: string; payload_json: string; attempts: number; max_attempts: number } | undefined {
  const t = now();
  const lease = new Date(Date.now() + LEASE_MS).toISOString();
  return get(
    db,
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ?
     WHERE id = (SELECT id FROM jobs WHERE (status = 'queued' AND run_after <= ?) OR (status = 'running' AND locked_until < ?) ORDER BY created_at LIMIT 1)
     RETURNING id, type, payload_json, attempts, max_attempts`,
    lease, t, t, t,
  );
}

export function startWorker(db: DB, handlers: Record<string, JobHandler>, opts: { intervalMs?: number; log?: (o: object) => void } = {}) {
  const log = opts.log ?? ((o) => console.log(JSON.stringify(o)));
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = async () => {
    if (stopped) return;
    const job = claim(db);
    if (!job) return;
    const h = handlers[job.type];
    const started = Date.now();
    try {
      if (!h) throw new Error(`no handler for ${job.type}`);
      await h(JSON.parse(job.payload_json), { jobId: job.id, attempt: job.attempts });
      run(db, `UPDATE jobs SET status = 'succeeded', locked_until = NULL, last_error = NULL, updated_at = ? WHERE id = ?`, now(), job.id);
      log({ event: 'job.succeeded', type: job.type, jobId: job.id, ms: Date.now() - started });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      const final = job.attempts >= job.max_attempts;
      const backoff = new Date(Date.now() + 2 ** job.attempts * 2_000).toISOString();
      run(db, `UPDATE jobs SET status = ?, locked_until = NULL, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?`, final ? 'failed' : 'queued', msg, backoff, now(), job.id);
      log({ event: final ? 'job.failed' : 'job.retry', type: job.type, jobId: job.id, attempt: job.attempts, error: msg });
    }
  };
  const loop = async () => {
    while (!stopped) {
      running = tick();
      await running;
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 400));
    }
  };
  void loop();
  return {
    async stop() {
      stopped = true;
      await running;
    },
    /** Test helper: process until the queue is empty. */
    async drain() {
      for (let i = 0; i < 200; i++) {
        const pending = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')`)!.n;
        if (!pending) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    },
  };
}
