// ENGINEERING TEST: online backup and restore of database + encrypted evidence.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupEnv, client, fixture } from './harness.ts';

const env = setupEnv();
const { openDb, get } = await import('../../server/db.ts');
const { createApp } = await import('../../server/app.ts');
const { readBytes } = await import('../../server/security.ts');

describe('backup and restore', () => {
  it('restores a consistent database and decryptable evidence from an online backup', async () => {
    const db = openDb(env.dbPath);
    const app = createApp(db);
    const c = client(app);
    await c.register('ENG ORG BACKUP');
    const sid = (await c.req('POST', '/api/shipments', { reference: 'ENG-BACKUP' })).json.id;
    const up = await c.upload(sid, 'sources_csv', 'eng.csv', fixture('ENGINEERING_TEST_sources.csv'));
    await c.req('POST', `/api/uploads/${up.json.uploadId}/confirm`);
    expect((await c.req('POST', `/api/shipments/${sid}/documents/supplier_request_pdf`)).status).toBe(201);

    // Backup while the source database is still open (online).
    const out = join(env.dir, 'backups');
    const r = spawnSync(process.execPath, ['scripts/backup.ts', out], { env: { ...process.env, DATABASE_PATH: env.dbPath }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    db.close();

    const snap = join(out, readdirSync(out)[0]!);
    const restored = openDb(join(snap, 'lothold.sqlite'));
    process.env.EVIDENCE_DIR = join(snap, 'evidence');
    const row = get<{ org_id: string; storage_key: string }>(restored, 'SELECT org_id, storage_key FROM uploads WHERE id = ?', up.json.uploadId)!;
    expect(readBytes(row.org_id, row.storage_key).toString()).toBe(fixture('ENGINEERING_TEST_sources.csv'));
    const doc = get<{ storage_key: string }>(restored, `SELECT storage_key FROM documents WHERE shipment_id = ?`, sid)!;
    expect(readBytes(row.org_id, doc.storage_key).subarray(0, 5).toString()).toBe('%PDF-');
    expect(get<{ n: number }>(restored, 'SELECT COUNT(*) AS n FROM audit_events')!.n).toBeGreaterThan(3);
    restored.close();
  });
});
