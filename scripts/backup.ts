// Consistent online backup of LotHold state.
//   node --env-file=.env scripts/backup.ts <backupDir>
// Produces <backupDir>/lothold-<timestamp>/ with:
//   lothold.sqlite   – transactionally consistent copy made with VACUUM INTO (safe while the server runs)
//   evidence/        – encrypted evidence and documents (copied after the database snapshot)
//   MANIFEST.json    – file list with SHA-256 values and the integrity-check result
// The EVIDENCE_ENCRYPTION_KEY and DOWNLOAD_SIGNING_KEY are NOT included: store .env separately and securely.
// Raster snapshots are not included either; re-create them with `npm run data:fetch` (hash-pinned).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const outRoot = process.argv[2];
if (!outRoot) throw new Error('usage: node scripts/backup.ts <backupDir>');
const dbPath = resolve(process.env.DATABASE_PATH ?? 'data/lothold.sqlite');
const evidenceDir = resolve(process.env.EVIDENCE_DIR ?? 'data/evidence');
if (!existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = resolve(outRoot, `lothold-${stamp}`);
mkdirSync(dir, { recursive: true });

const target = join(dir, 'lothold.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 10000');
db.prepare('VACUUM INTO ?').run(target);
db.close();

const check = new DatabaseSync(target);
const integrity = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
const fk = check.prepare('PRAGMA foreign_key_check').all();
const counts = Object.fromEntries(['shipments', 'uploads', 'documents', 'review_decisions', 'approvals', 'audit_events', 'allocations', 'chain_txs'].map((t) => [t, (check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
check.close();

if (existsSync(evidenceDir)) cpSync(evidenceDir, join(dir, 'evidence'), { recursive: true });

const files: { path: string; bytes: number; sha256: string }[] = [];
const walk = (p: string) => {
  for (const name of readdirSync(p)) {
    const f = join(p, name);
    if (statSync(f).isDirectory()) walk(f);
    else files.push({ path: relative(dir, f).replace(/\\/g, '/'), bytes: statSync(f).size, sha256: createHash('sha256').update(readFileSync(f)).digest('hex') });
  }
};
walk(dir);
const manifest = { createdAt: new Date().toISOString(), source: { dbPath, evidenceDir }, integrity, foreignKeyViolations: fk.length, counts, files };
writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify({ backup: dir, integrity, foreignKeyViolations: fk.length, counts, files: files.length }, null, 1));
if (integrity !== 'ok' || fk.length) process.exit(1);
