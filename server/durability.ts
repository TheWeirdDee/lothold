// Bounded free-pilot storage: local SQLite is a cache. Success responses wait for
// an encrypted private Storage object AND a fenced Postgres pointer commit.
// This preserves existing auth/SQL semantics without claiming async replication
// is durable. It is intentionally limited to small judging workspaces.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DB } from './db.ts';
import { secrets, readBytes } from './security.ts';

export type Checkpoint = { owner: string; revision: number; object_key: string | null; sha256: string | null; discarded_key?: string | null };
export interface CheckpointTransport {
  claim(owner: string): Promise<Checkpoint>;
  status(): Promise<Checkpoint>;
  put(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  commit(owner: string, revision: number, key: string, sha: string): Promise<Checkpoint>;
  remove(key: string): Promise<void>;
}
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export class PersistenceError extends Error {
  constructor(message = 'Durable storage could not confirm this operation. Its outcome is uncertain; check the current record before retrying.') { super(message); }
}
function seal(bytes: Buffer, namespace: string): Buffer {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', secrets.evidenceKey(), iv);
  c.setAAD(Buffer.from(`LotHold checkpoint:${namespace}`));
  const encrypted = Buffer.concat([c.update(bytes), c.final()]);
  return Buffer.concat([Buffer.from('LHC1'), iv, c.getAuthTag(), encrypted]);
}
function unseal(bytes: Buffer, namespace: string): Buffer {
  if (bytes.subarray(0, 4).toString() !== 'LHC1') throw new PersistenceError('Unknown remote checkpoint format.');
  const d = createDecipheriv('aes-256-gcm', secrets.evidenceKey(), bytes.subarray(4, 16));
  d.setAAD(Buffer.from(`LotHold checkpoint:${namespace}`)); d.setAuthTag(bytes.subarray(16, 32));
  return Buffer.concat([d.update(bytes.subarray(32)), d.final()]);
}

export function supabaseTransport(url: string, serviceKey: string, bucket: string, namespace: string): CheckpointTransport {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:') throw new Error('Supabase URL must use HTTPS.');
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const request = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(new URL(path, endpoint), { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(45000) });
    // Never include response bodies or URLs with credentials in errors/logs.
    if (!r.ok) throw new PersistenceError(`Durable storage returned HTTP ${r.status}; the operation was not confirmed.`);
    return r;
  };
  const rpc = async (name: string, data: object): Promise<Checkpoint> => (await request(`/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })).json();
  const objectPath = (key: string) => `/storage/v1/object/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return {
    claim: (owner) => rpc('lothold_claim', { p_namespace: namespace, p_owner: owner }),
    status: () => rpc('lothold_status', { p_namespace: namespace }),
    async put(key, bytes) { await request(objectPath(key), { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false' }, body: new Uint8Array(bytes) }); },
    async read(key) { return Buffer.from(await (await request(objectPath(key))).arrayBuffer()); },
    commit: (owner, revision, key, sha) => rpc('lothold_commit', { p_namespace: namespace, p_owner: owner, p_revision: revision, p_object_key: key, p_sha256: sha }),
    async remove(key) { await request(`/storage/v1/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) }); },
  };
}

export class DurableCheckpoint {
  readonly transport: CheckpointTransport;
  readonly namespace: string;
  readonly path: string;
  readonly maxBytes: number;
  readonly owner = randomUUID();
  private revision = 0;
  private db: DB | null = null;
  private savedChanges = -1;
  private queue: Promise<void> = Promise.resolve();
  private available = false;
  constructor(transport: CheckpointTransport, namespace: string, path: string, maxBytes = 32 * 1024 * 1024) {
    this.transport = transport; this.namespace = namespace; this.path = path; this.maxBytes = maxBytes;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)) throw new Error('Invalid checkpoint namespace.');
  }
  async restore() {
    const c = await this.transport.claim(this.owner); this.revision = Number(c.revision);
    if (c.owner !== this.owner || !Number.isSafeInteger(this.revision)) throw new PersistenceError('Remote writer claim failed.');
    if (c.object_key) {
      if (!c.object_key.startsWith(this.namespace + '/')) throw new PersistenceError('Remote checkpoint belongs to another instance.');
      const encrypted = await this.transport.read(c.object_key);
      if (encrypted.length > this.maxBytes + 32 || hash(encrypted) !== c.sha256) throw new PersistenceError('Remote checkpoint failed integrity verification.');
      const bytes = unseal(encrypted, this.namespace);
      if (bytes.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new PersistenceError('Remote checkpoint is not a SQLite database.');
      mkdirSync(dirname(resolve(this.path)), { recursive: true });
      // Only in explicit cloud mode, before the database is opened. Local files
      // are a disposable cache; the committed remote pointer is authoritative.
      for (const suffix of ['-wal', '-shm']) rmSync(this.path + suffix, { force: true });
      const recovered = this.path + '.recovered';
      writeFileSync(recovered, bytes, { mode: 0o600 }); renameSync(recovered, this.path);
    } else if (existsSync(this.path)) throw new PersistenceError('Refusing to initialise cloud storage from an existing local database. Use a fresh cache path or a separately verified migration.');
  }
  attach(db: DB) {
    this.db = db;
    if ((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new PersistenceError('Recovered database integrity check failed.');
    const evidence = hash(secrets.evidenceKey()), signing = hash(secrets.signingKey());
    const identity = db.prepare('SELECT * FROM cloud_identity WHERE id=1').get() as { evidence_fingerprint: string; signing_fingerprint: string } | undefined;
    if (identity && (identity.evidence_fingerprint !== evidence || identity.signing_fingerprint !== signing)) throw new PersistenceError('Cloud key continuity failed. Restore the original encryption and signing keys.');
    if (!identity) db.prepare('INSERT INTO cloud_identity VALUES (1,?,?)').run(evidence, signing);
    this.checkEvidence(true);
  }
  private checkEvidence(decrypt: boolean) {
    const rows = this.db!.prepare(`SELECT u.org_id, u.storage_key, u.sha256, u.bytes FROM uploads u
      UNION ALL SELECT s.org_id, d.storage_key, d.sha256, d.bytes FROM documents d JOIN shipments s ON s.id=d.shipment_id`).all() as { org_id: string; storage_key: string; sha256: string; bytes: number }[];
    for (const r of rows) {
      const blob = this.db!.prepare('SELECT org_id FROM evidence_blobs WHERE storage_key=?').get(r.storage_key) as {org_id:string}|undefined;
      if (!blob || blob.org_id !== r.org_id) throw new PersistenceError('Checkpoint references missing or mismatched evidence.');
      if (decrypt) { const bytes=readBytes(r.org_id,r.storage_key,this.db!); if (bytes.length !== r.bytes || hash(bytes) !== r.sha256) throw new PersistenceError('Recovered evidence failed decryption/hash verification.'); }
    }
  }
  ready() { return this.available; }
  async assertOwner() {
    const c = await this.transport.status();
    if (c?.owner !== this.owner) { this.available = false; throw new PersistenceError('This backend was replaced by another deployment. Retry against the current backend.'); }
  }
  admit(requestBytes: number) {
    const db = this.db!;
    const pages = Number((db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count);
    const pageSize = Number((db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size);
    if (requestBytes > 1024 * 1024 || pages * pageSize + Math.max(128 * 1024, requestBytes * 8) + 1024 * 1024 > this.maxBytes)
      throw new PersistenceError('The free pilot storage budget cannot safely accept this request. Use files below 1 MB and a small engineering workspace; no success was recorded.');
  }
  flush(): Promise<void> {
    const result = this.queue.catch(() => {}).then(() => this.save());
    this.queue = result; return result;
  }
  private async save() {
    const db = this.db!;
    const changes = () => Number((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n);
    if (this.savedChanges === changes()) return;
    const target = `${this.path}.checkpoint-${randomUUID()}`;
    try {
      this.checkEvidence(false);
      db.prepare('VACUUM INTO ?').run(target);
      const savedAt = changes();
      const raw = readFileSync(target);
      if (raw.length > this.maxBytes) throw new PersistenceError('The free pilot checkpoint exceeds its bounded storage budget. This operation is not confirmed.');
      const bytes = seal(raw, this.namespace), sha = hash(bytes);
      const key = `${this.namespace}/${this.owner}-${this.revision + 1}-${randomUUID()}.bin`;
      const began=performance.now();
      await this.transport.put(key, bytes);
      // Immutable object must be readable with its exact encrypted digest BEFORE
      // the Postgres pointer can make it authoritative. Interrupted uploads stay unpublished.
      if (hash(await this.transport.read(key)) !== sha) throw new PersistenceError('Uploaded checkpoint could not be read back intact.');
      let committed: Checkpoint;
      try { committed = await this.transport.commit(this.owner, this.revision, key, sha); }
      catch {
        // A lost HTTP response is ambiguous. A read-back can confirm exactly this
        // checkpoint; never blindly re-claim ownership or overwrite newer data.
        committed = await this.transport.status();
        if (committed?.owner !== this.owner || committed.object_key !== key || committed.sha256 !== sha || Number(committed.revision) !== this.revision + 1) throw new PersistenceError();
      }
      if (committed.owner !== this.owner || committed.object_key !== key || Number(committed.revision) !== this.revision + 1) throw new PersistenceError();
      this.revision = Number(committed.revision); this.savedChanges = savedAt; this.available = true;
      console.log(JSON.stringify({event:'checkpoint.published',namespace:this.namespace,revision:this.revision,bytes:bytes.length,ms:Math.round(performance.now()-began)}));
      if (committed.discarded_key?.startsWith(this.namespace + '/')) void this.transport.remove(committed.discarded_key).catch(() => {});
    } catch (e) { this.available = false; throw e instanceof PersistenceError ? e : new PersistenceError(); }
    finally { rmSync(target, { force: true }); }
  }
}

export async function cloudDurabilityFromEnv(): Promise<DurableCheckpoint | null> {
  if (process.env.DURABLE_STORE !== 'supabase') return null;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, DATABASE_PATH } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_STORAGE_BUCKET || !DATABASE_PATH || process.env.EVIDENCE_STORE !== 'sqlite') throw new Error('Cloud mode requires Supabase server settings, a fresh DATABASE_PATH cache, and EVIDENCE_STORE=sqlite.');
  const namespace = process.env.SNAPSHOT_NAMESPACE ?? 'judging';
  const store = new DurableCheckpoint(supabaseTransport(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, namespace), namespace, DATABASE_PATH);
  await store.restore(); return store;
}
