// ENGINEERING REGRESSION TESTS for the build audit of 25 October 2026 (findings 1, 2, 3, 4, 8, 11, 12, 13, 17, 19).
// Isolated temporary database; no worker runs, so analysis jobs stay queued unless a test changes them.
// Every record is an engineering fixture; coordinates are probe boxes, not farms.
process.env.PUBLIC_ANALYSIS_CONCURRENCY = '0'; // every public analysis is "busy" in this file (finding 11)
import { afterAll, describe, expect, it } from 'vitest';
import { setupEnv, client, CSV_HEADER, CLEAR_PROBE, plotsFile, type Client } from './harness.ts';

const env = setupEnv();
const { openDb, run, get } = await import('../../server/db.ts');
const { createApp } = await import('../../server/app.ts');
const { housekeeping } = await import('../../server/security.ts');
const { verifyDatasets } = await import('../../server/handlers.ts');
await verifyDatasets(() => {});

const db = openDb(env.dbPath);
const app = createApp(db);
afterAll(() => db.close());

const fields = { activityType: 'IMPORT', hsCode: '1801', description: 'ENGINEERING TEST cocoa beans', netMassValue: '600', netMassUnit: 'kg', operatorName: 'ENGINEERING TEST OPERATOR', operatorEori: 'BE0000000000', countryOfActivity: 'BE' };
async function newCase(c: Client, ref: string) {
  const r = await c.req('POST', '/api/shipments', { reference: ref });
  await c.req('PATCH', `/api/shipments/${r.json.id}/fields`, fields);
  return r.json.id as string;
}
async function confirm(c: Client, sid: string, kind: string, name: string, content: string) {
  const u = await c.upload(sid, kind, name, content);
  return { uploadId: u.json.uploadId as string, confirm: await c.req('POST', `/api/uploads/${u.json.uploadId}/confirm`) };
}
const view = async (c: Client, sid: string) => (await c.req('GET', `/api/shipments/${sid}`)).json;
const evidence = async (c: Client, sid: string) => (await c.upload(sid, 'review_evidence', 'ENGINEERING_TEST_evidence.txt', 'ENGINEERING TEST evidence - not a real record')).json.uploadId as string;
const RATIONALE = 'Engineering test: the attached engineering file stands in for the supporting document.';

describe('build audit regressions', () => {
  it('finding 1: a queued anchoring job, or a reserve with an uncertain RPC result, blocks source revision', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (anchor lock)');
    const sid = await newCase(c, 'ENG-BA-01');
    await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_a.csv', `${CSV_HEADER}\nENG-S,ENGINEERING TEST,ENG-L1,1000,600,kg,CI,ENG-P\n`);
    expect((await c.req('POST', `/api/shipments/${sid}/reserve`)).status).toBe(200);
    const alloc = get<{ id: string; org_id: string; source_lot_id: string }>(db, `SELECT id, org_id, source_lot_id FROM allocations WHERE shipment_id = ? AND status = 'reserved'`, sid)!;
    // (a) anchoring requested, nothing submitted yet: the job row alone is the lock.
    run(db, `INSERT INTO jobs (id, type, dedupe_key, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at) VALUES ('eng-job-1', 'chain_anchor', 'chain_anchor:${alloc.id}', ?, 'queued', 0, 5, datetime('now'), datetime('now'), datetime('now'))`, JSON.stringify({ allocationId: alloc.id }));
    let b = await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_b.csv', `${CSV_HEADER}\nENG-S,ENGINEERING TEST,ENG-L1,1000,500,kg,CI,ENG-P\n`);
    expect(b.confirm.status).toBe(409);
    expect(b.confirm.json.error.code).toBe('anchored');
    // (b) job finished, but the reserve transaction ended in an uncertain rpc_error: still blocked.
    run(db, `UPDATE jobs SET status = 'failed' WHERE id = 'eng-job-1'`);
    run(db, `INSERT INTO chain_txs (id, org_id, shipment_id, allocation_id, source_lot_id, action, idempotency_key, network, chain_id, contract_address, signer, args_json, status, tx_hash, attempts, created_at, updated_at)
      VALUES ('eng-tx-1', ?, ?, ?, ?, 'reserve', 'eng-ba-key-1', 'engineering', 0, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '{}', 'rpc_error', '0x01', 1, datetime('now'), datetime('now'))`, alloc.org_id, sid, alloc.id, alloc.source_lot_id);
    b = await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_b.csv', `${CSV_HEADER}\nENG-S,ENGINEERING TEST,ENG-L1,1000,500,kg,CI,ENG-P\n`);
    expect(b.confirm.status).toBe(409);
    expect(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM allocations WHERE shipment_id = ? AND status = 'reserved'`, sid)!.n).toBe(1);
  });

  it('finding 2: a mistaken first lot total can be corrected with rationale and evidence, append-only and bounded', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (lot correction)');
    const one = await newCase(c, 'ENG-BA-02-1');
    await confirm(c, one, 'sources_csv', 'ENGINEERING_TEST_first.csv', `${CSV_HEADER}\nENG-S,ENGINEERING TEST,ENG-LOT-X,100,100,kg,CI,ENG-P\n`);
    const two = await newCase(c, 'ENG-BA-02-2');
    await confirm(c, two, 'sources_csv', 'ENGINEERING_TEST_corrected.csv', `${CSV_HEADER}\nENG-S,ENGINEERING TEST,ENG-LOT-X,2000,600,kg,CI,ENG-P\n`);
    const key = 'ALLOC-REG-MISMATCH:ENG-S::ENG-LOT-X';
    expect((await view(c, two)).evaluation.findings.map((f: any) => f.key)).toContain(key);
    const body = { supplierId: 'ENG-S', sourceLotRef: 'ENG-LOT-X', rationale: RATIONALE, evidenceUploadId: await evidence(c, two) };
    expect((await c.req('POST', `/api/shipments/${two}/source-lots/correct`, { ...body, rationale: 'too short' })).status).toBe(422);
    const ok = await c.req('POST', `/api/shipments/${two}/source-lots/correct`, body);
    expect(ok.status).toBe(201);
    const v = await view(c, two);
    expect(v.evaluation.findings.map((f: any) => f.key)).not.toContain(key);
    expect(v.allocation[0].declaredGrams).toBe(2_000_000);
    expect(() => run(db, 'UPDATE source_lot_corrections SET new_grams = 1')).toThrow(/append-only/);
    expect(get<{ g: number }>(db, `SELECT declared_grams AS g FROM source_lots WHERE source_lot_ref = 'ENG-LOT-X'`)!.g).toBe(100_000); // first total kept
    expect((await c.req('POST', `/api/shipments/${two}/source-lots/correct`, body)).status).toBe(409); // nothing left to correct
    // A correction below what another case already holds is refused.
    expect((await c.req('POST', `/api/shipments/${two}/reserve`)).status).toBe(200); // holds 600 kg of the 2 000 kg lot
    const three = await newCase(c, 'ENG-BA-02-3');
    await confirm(c, three, 'sources_csv', 'ENGINEERING_TEST_lower.csv', `${CSV_HEADER}\nENG-S,ENGINEERING TEST,ENG-LOT-X,500,500,kg,CI,ENG-P\n`);
    const low = await c.req('POST', `/api/shipments/${three}/source-lots/correct`, { ...body, evidenceUploadId: await evidence(c, three) });
    expect(low.status).toBe(409);
    expect(low.json.error.code).toBe('below_reserved');
  });

  it('finding 3: a decision on a failed analysis stays active, and a retry asks for a fresh decision', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (failed analysis)');
    const sid = await newCase(c, 'ENG-BA-03');
    await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_f.csv', `${CSV_HEADER}\nENG-S,ENGINEERING TEST,ENG-LF,1000,600,kg,CI,ENG-PF\n`);
    await confirm(c, sid, 'plots_geojson', 'ENGINEERING_TEST_f.geojson', plotsFile([{ ref: 'ENG-PF', geometry: CLEAR_PROBE }]));
    run(db, `UPDATE jobs SET status = 'failed', last_error = 'engineering test failure' WHERE type = 'forest_analysis'`);
    let v = await view(c, sid);
    expect(v.evaluation.readiness.environment).toBe('UNAVAILABLE');
    const d = await c.req('POST', `/api/shipments/${sid}/decisions`, { findingKey: 'ENV:ENG-PF', decision: 'investigated_not_blocking', rationale: RATIONALE, evidenceUploadId: await evidence(c, sid) });
    expect(d.status).toBe(201);
    v = await view(c, sid);
    expect(v.evaluation.readiness.environment).toBe('REVIEWED_WITH_EVIDENCE'); // the decision is active
    const retry = await c.req('POST', `/api/shipments/${sid}/plots/ENG-PF/retry-analysis`);
    expect(retry.status).toBe(202);
    v = await view(c, sid);
    expect(v.evaluation.readiness.environment).toBe('IN_PROGRESS'); // re-queued; the old decision no longer applies
  });

  it('finding 4: analysed cases disclose how recent the forest data is, without blocking', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (recency)');
    const sid = await newCase(c, 'ENG-BA-04');
    await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_r.csv', `${CSV_HEADER}\nENG-S,ENGINEERING TEST,ENG-LR,1000,600,kg,CI,ENG-PR\n`);
    await confirm(c, sid, 'plots_geojson', 'ENGINEERING_TEST_r.geojson', plotsFile([{ ref: 'ENG-PR', geometry: CLEAR_PROBE }]));
    run(db, `UPDATE jobs SET status = 'failed', last_error = 'engineering test failure' WHERE type = 'forest_analysis' AND status <> 'failed'`);
    // No completed analysis yet: no recency note.
    expect((await view(c, sid)).evaluation.findings.map((f: any) => f.key)).not.toContain('ENV-RECENCY');
  });

  it('finding 8: a missing or malformed JSON body is a 400, not a server error', async () => {
    const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: '' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('invalid_json');
    const r2 = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: '{"email":' });
    expect(r2.status).toBe(400);
  });

  it('finding 11: public analyses are refused with 503 when the shared capacity is in use', async () => {
    const r = await app.request('/api/public/forest-check', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ geometry: CLEAR_PROBE }) });
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('10');
  });

  it('finding 12: housekeeping removes old rate-limit records and expired sessions', () => {
    run(db, 'INSERT INTO rate_events (bucket, at_ms) VALUES (?, ?)', 'eng-old', Date.now() - 2 * 24 * 60 * 60 * 1000);
    run(db, 'INSERT INTO rate_events (bucket, at_ms) VALUES (?, ?)', 'eng-new', Date.now());
    const user = get<{ id: string }>(db, 'SELECT id FROM users LIMIT 1')!;
    run(db, `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES ('eng-expired', ?, 'x', '2000-01-01T00:00:00Z', '2000-01-02T00:00:00Z')`, user.id);
    const r = housekeeping(db);
    expect(r.rateEvents).toBeGreaterThanOrEqual(1);
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect(get(db, `SELECT 1 FROM rate_events WHERE bucket = 'eng-new'`)).toBeTruthy();
    expect(get(db, `SELECT 1 FROM sessions WHERE token_hash = 'eng-expired'`)).toBeUndefined();
  });

  it('finding 13: the workspace list is paginated', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (paging)');
    for (const n of [1, 2, 3]) await c.req('POST', '/api/shipments', { reference: `ENG-PAGE-${n}` });
    const p1 = (await c.req('GET', '/api/shipments?limit=2')).json;
    expect(p1.shipments).toHaveLength(2);
    expect(p1.total).toBe(3);
    const p2 = (await c.req('GET', '/api/shipments?limit=2&offset=2')).json;
    expect(p2.shipments.map((s: any) => s.reference)).toEqual(['ENG-PAGE-1']);
  });

  it('finding 17: the supplier request stays on one page with very long identifiers and many items', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (one page)');
    const sid = await newCase(c, 'ENG-BA-17');
    const long = (n: number) => `ENG-${'X'.repeat(180)}-${n}`;
    const rows = Array.from({ length: 25 }, (_, i) => `${long(i)},ENGINEERING TEST,${long(i + 100)},1000,${i % 2 ? '"1,000"' : '600'},kg,${i % 3 ? 'CI' : 'XX'},${long(i + 200)}`).join('\n');
    await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_long.csv', `${CSV_HEADER}\n${rows}\n`);
    const doc = await c.req('POST', `/api/shipments/${sid}/documents/supplier_request_pdf`);
    expect(doc.status).toBe(201);
    expect(doc.json.validation.pages).toBe(1);
    expect(doc.json.validation.itemsListed).toBeGreaterThan(0);
    expect(doc.json.validation.itemsOmitted).toBeGreaterThan(0);
  });

  it('finding 19: readiness reports whether the datasets are verified, and strict mode fails when they are not', async () => {
    const r = await app.request('/api/ready');
    const body = await r.json();
    expect(body).toHaveProperty('datasetsVerified');
    expect(body.degraded).toBe(!body.datasetsVerified);
    const strict = await app.request('/api/ready?strict=1');
    expect(strict.status).toBe(body.datasetsVerified ? 200 : 503);
  });
});
