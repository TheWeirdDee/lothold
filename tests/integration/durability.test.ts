// Real SQLite/AES/auth tests against an in-memory remote protocol double.
// These do not claim that Supabase SQL/Storage has been provisioned or tested live.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setupEnv, client, CSV_HEADER } from './harness.ts';
import { openDb, get, type DB } from '../../server/db.ts';
import { createApp } from '../../server/app.ts';
import { DurableCheckpoint, type Checkpoint, type CheckpointTransport } from '../../server/durability.ts';
import { readBytes } from '../../server/security.ts';

const env = setupEnv(); const dbs: DB[] = [];
beforeEach(() => { process.env.EVIDENCE_STORE = 'sqlite'; });
afterAll(() => { dbs.forEach((db) => db.close()); delete process.env.EVIDENCE_STORE; });
class Remote implements CheckpointTransport {
  row: Checkpoint = { owner: '', revision: 0, object_key: null, sha256: null };
  objects = new Map<string, Buffer>();
  failPut = false; loseCommitResponse = false;
  async claim(owner: string) { this.row = { ...this.row, owner }; return { ...this.row }; }
  async status() { return { ...this.row }; }
  async put(key: string, bytes: Buffer) { if (this.failPut) throw new Error('offline'); this.objects.set(key, Buffer.from(bytes)); }
  async read(key: string) { return Buffer.from(this.objects.get(key)!); }
  async commit(owner: string, revision: number, object_key: string, sha256: string) {
    if (owner !== this.row.owner || revision !== this.row.revision) throw new Error('fenced');
    this.row = { owner, revision: revision + 1, object_key, sha256 };
    if (this.loseCommitResponse) { this.loseCommitResponse = false; throw new Error('response lost'); }
    return { ...this.row };
  }
  async remove(key: string) { this.objects.delete(key); }
}
async function instance(remote: Remote) {
  const store = new DurableCheckpoint(remote, 'engineering', join(env.dir, `${randomUUID()}.sqlite`));
  await store.restore(); const db = openDb(store.path); dbs.push(db); store.attach(db); await store.flush();
  return { store, db, app: createApp(db, { durability: store }) };
}
describe('free pilot durable acknowledgements', () => {
  it('restores accounts, org isolation, cases and encrypted bytes into a fresh cache', async () => {
    const remote = new Remote(), a = await instance(remote), reviewer = client(a.app);
    await reviewer.register('ENGINEERING DURABLE');
    const current = await reviewer.req('GET', '/api/auth/me'); const email = current.json.user.email;
    const s = await reviewer.req('POST', '/api/shipments', { reference: 'ENG-DURABLE' });
    const content = CSV_HEADER + '\nENG-S,ENGINEERING,ENG-L,100,10,kg,CI,ENG-P';
    const upload = await reviewer.upload(s.json.id, 'sources_csv', 'ENGINEERING.csv', content, 'text/csv');
    expect(upload.status).toBe(201);
    await reviewer.req('POST', `/api/uploads/${upload.json.uploadId}/confirm`);
    const row = get<{ storage_key: string; org_id: string }>(a.db, 'SELECT storage_key, org_id FROM uploads WHERE id = ?', upload.json.uploadId)!;
    expect(readBytes(row.org_id, row.storage_key, a.db).toString()).toBe(content);
    // The remote object encrypts the WHOLE database as well as individual evidence.
    const object = remote.objects.get(remote.row.object_key!)!;
    expect(object.includes(Buffer.from(email))).toBe(false);
    const b = await instance(remote), secondBrowser = client(b.app);
    const login = await secondBrowser.req('POST', '/api/auth/login', { email, password: 'engineering-test-pw' });
    expect(login.status).toBe(200);
    expect((await secondBrowser.req('GET', `/api/shipments/${s.json.id}`)).status).toBe(200);
    expect(readBytes(row.org_id, row.storage_key, b.db).toString()).toBe(content);
    const other = client(b.app); await other.register('OTHER ENGINEERING ORG');
    expect((await other.req('GET', `/api/shipments/${s.json.id}`)).status).toBe(404);
    // The old process cannot acknowledge data after another deployment takes over.
    expect((await reviewer.req('POST', '/api/shipments', { reference: 'ENG-OLD-WRITER' })).status).toBe(503);
  });
  it('does not acknowledge a successful local mutation when remote storage fails', async () => {
    const remote = new Remote(), a = await instance(remote), c = client(a.app);
    remote.failPut = true;
    const r = await c.req('POST', '/api/auth/register', { email: 'unconfirmed@example.test', password: 'engineering-test-pw', name: 'ENGINEERING', organisation: 'ENGINEERING' });
    expect(r.status).toBe(503); expect(r.json.error.code).toBe('durability_unavailable');
    expect(r.headers.get('set-cookie')).toBeNull();
    remote.failPut = false;
    const b = await instance(remote); // reads the last ACKNOWLEDGED state, not the dirty cache
    expect(get(b.db, 'SELECT 1 FROM users WHERE email = ?', 'unconfirmed@example.test')).toBeUndefined();
  });
  it('reconciles a lost commit response by reading the exact durable pointer', async () => {
    const remote = new Remote(), a = await instance(remote), c = client(a.app);
    remote.loseCommitResponse = true;
    const registered = await c.register('LOST RESPONSE ENGINEERING');
    expect(registered.status).toBe(201); expect(a.store.ready()).toBe(true);
  });
  it('rejects altered ciphertext and refuses to fall back to an empty workspace', async () => {
    const remote = new Remote(); await instance(remote);
    const bytes = remote.objects.get(remote.row.object_key!)!; bytes[bytes.length - 1]! ^= 1;
    await expect(instance(remote)).rejects.toThrow('integrity');
  });
  it('rejects changed signing keys and an interrupted upload never becomes authoritative', async () => {
    const remote = new Remote(), a = await instance(remote);
    const original=process.env.DOWNLOAD_SIGNING_KEY;
    try { process.env.DOWNLOAD_SIGNING_KEY='ab'.repeat(32); await expect(instance(remote)).rejects.toThrow('continuity'); }
    finally { process.env.DOWNLOAD_SIGNING_KEY=original; }
    const b=await instance(remote); const pointer=remote.row.object_key;
    const put=remote.put.bind(remote);
    remote.put=async(key,bytes) => { await put(key,bytes); throw new Error('interrupted response'); };
    b.db.prepare("INSERT INTO orgs(id,name,created_at) VALUES ('ENG-INTERRUPTED','ENGINEERING',datetime('now'))").run();
    await expect(b.store.flush()).rejects.toThrow(); expect(remote.row.object_key).toBe(pointer);
    remote.put=put;
    const c=await instance(remote);
    expect(get(c.db,"SELECT 1 FROM orgs WHERE id='ENG-INTERRUPTED'")).toBeUndefined();
  });
  it('refuses publication of a database referencing missing evidence', async () => {
    const remote=new Remote(), a=await instance(remote), c=client(a.app); await c.register('ENG CONSISTENCY');
    const shipment=await c.req('POST','/api/shipments',{reference:'ENG-CONSISTENCY'});
    await c.upload(shipment.json.id,'sources_csv','ENGINEERING.csv',CSV_HEADER+'\nENG-S,ENGINEERING,ENG-L,100,10,kg,CI,ENG-P','text/csv');
    const pointer=remote.row.object_key; a.db.exec('DELETE FROM evidence_blobs');
    await expect(a.store.flush()).rejects.toThrow('evidence'); expect(remote.row.object_key).toBe(pointer);
  });
  it('fences a writer replaced while its upload is in flight', async () => {
    const remote=new Remote(), a=await instance(remote);
    let reached!:()=>void, resume!:()=>void;
    const atUpload=new Promise<void>(r=>{reached=r;}), gate=new Promise<void>(r=>{resume=r;});
    const put=remote.put.bind(remote); let pause=true;
    remote.put=async(key,bytes)=>{await put(key,bytes); if(pause){pause=false; reached(); await gate;}};
    a.db.prepare("INSERT INTO orgs(id,name,created_at) VALUES ('ENG-STALE','ENGINEERING',datetime('now'))").run();
    const old=a.store.flush(); await atUpload;
    const winner=await instance(remote); resume();
    await expect(old).rejects.toThrow();
    expect(get(winner.db,"SELECT 1 FROM orgs WHERE id='ENG-STALE'")).toBeUndefined();
    await expect(a.store.assertOwner()).rejects.toThrow('replaced');
  });
  it('rejects encrypted snapshots restored with a different encryption key', async () => {
    const remote=new Remote(); await instance(remote);
    const original=process.env.EVIDENCE_ENCRYPTION_KEY;
    try { process.env.EVIDENCE_ENCRYPTION_KEY='cd'.repeat(32); await expect(instance(remote)).rejects.toThrow(); }
    finally {process.env.EVIDENCE_ENCRYPTION_KEY=original;}
  });

});
