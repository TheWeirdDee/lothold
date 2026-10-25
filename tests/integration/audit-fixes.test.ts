// ENGINEERING REGRESSION TESTS for the defects reported by the independent audit of 24 October 2026 (LH-03, LH-04,
// LH-05, LH-06, LH-09 and the post-anchor revision risk). Every record is an isolated test fixture in a temporary
// database; plot geometries are coordinate probe boxes, not farms.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { setupEnv, client, CSV_HEADER, CLEAR_PROBE, plotsFile, type Client } from './harness.ts';

const env = setupEnv();
const { openDb, run, get } = await import('../../server/db.ts');
const { createApp } = await import('../../server/app.ts');
const { startWorker } = await import('../../server/jobs.ts');
const { createJobHandlers, verifyDatasets } = await import('../../server/handlers.ts');
const { DATASETS } = await import('../../server/env/forest.ts');

const db = openDb(env.dbPath);
const app = createApp(db);
const haveData = Object.values(DATASETS).every((d) => existsSync(`${process.env.DATA_DIR ?? 'data/snapshots'}/${d.file}`));
let worker: ReturnType<typeof startWorker>;
beforeAll(async () => {
  const ok = haveData ? await verifyDatasets(() => {}) : false;
  worker = startWorker(db, createJobHandlers(db, { datasetsOk: ok }), { intervalMs: 50, log: () => {} });
});
afterAll(async () => {
  await worker.stop();
  db.close();
});

const fields = { activityType: 'IMPORT', hsCode: '1801', description: 'ENGINEERING TEST cocoa beans', netMassValue: '600', netMassUnit: 'kg', operatorName: 'ENGINEERING TEST OPERATOR', operatorEori: 'BE0000000000', countryOfActivity: 'BE' };
async function newCase(c: Client, ref: string, f: Record<string, string> = fields) {
  const r = await c.req('POST', '/api/shipments', { reference: ref });
  expect(r.status).toBe(201);
  expect((await c.req('PATCH', `/api/shipments/${r.json.id}/fields`, f)).status).toBe(200);
  return r.json.id as string;
}
async function confirm(c: Client, sid: string, kind: string, name: string, content: string) {
  const u = await c.upload(sid, kind, name, content);
  expect([200, 201]).toContain(u.status);
  const r = await c.req('POST', `/api/uploads/${u.json.uploadId}/confirm`);
  return { uploadId: u.json.uploadId as string, confirm: r };
}
const view = async (c: Client, sid: string) => (await c.req('GET', `/api/shipments/${sid}`)).json;

describe('audit regressions', () => {
  it('LH-03: rows that give different countries for one plot hold the case and cannot be signed off', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (LH-03)');
    const sid = await newCase(c, 'ENG-AUDIT-03');
    const csv = `${CSV_HEADER}\nENG-SUP,ENGINEERING TEST,ENG-LOT-1,1000,300,kg,CI,ENG-PLOT\nENG-SUP,ENGINEERING TEST,ENG-LOT-2,1000,300,kg,GH,ENG-PLOT\n`;
    await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_lh03.csv', csv);
    await confirm(c, sid, 'plots_geojson', 'ENGINEERING_TEST_lh03.geojson', plotsFile([{ ref: 'ENG-PLOT', geometry: CLEAR_PROBE }]));
    await worker.drain();
    const v = await view(c, sid);
    const rowsConflict = v.evaluation.findings.find((f: any) => f.key === 'PLOT-COUNTRY-ROWS:ENG-PLOT');
    expect(rowsConflict).toBeTruthy();
    expect(rowsConflict.message).toContain('CI (row 2) vs GH (row 3)');
    expect(rowsConflict.refs.map((r: any) => r.row)).toEqual([2, 3]);
    // The GeoJSON says CI, so row 3 (GH) also disagrees with the plot file.
    expect(v.evaluation.findings.find((f: any) => f.key === 'PLOT-COUNTRY:ENG-PLOT').refs.filter((r: any) => r.kind === 'sources_csv').map((r: any) => r.row)).toEqual([3]);
    expect(v.evaluation.readiness.overall).toBe('HOLD');
    expect((await c.req('POST', `/api/shipments/${sid}/approve`, { digest: v.digest })).status).toBe(409);
  });

  it.runIf(haveData)('LH-04: a water-only point is not a clear environmental result and needs review', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (LH-04)');
    const sid = await newCase(c, 'ENG-AUDIT-04');
    await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_lh04.csv', `${CSV_HEADER}\nENG-SUP,ENGINEERING TEST,ENG-LOT-W,1000,600,kg,CI,ENG-WATER\n`);
    await confirm(c, sid, 'plots_geojson', 'ENGINEERING_TEST_lh04.geojson', plotsFile([{ ref: 'ENG-WATER', geometry: { type: 'Point', coordinates: [-4, 5.2] }, area: 2 }]));
    await worker.drain();
    const v = await view(c, sid);
    const f = v.plots.features[0];
    expect(f.env.status).toBe('UNAVAILABLE');
    expect(v.evaluation.readiness.environment).not.toBe('NO_POST_2020_LOSS_OBSERVED');
    expect(v.evaluation.findings.map((x: any) => x.key)).toContain('ENV:ENG-WATER');
    expect(v.evaluation.readiness.overall).not.toBe('READY_FOR_SIGN_OFF');
  });

  it('LH-05: re-confirming an earlier source table can be reserved again, and success means it is reserved', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (LH-05)');
    const sid = await newCase(c, 'ENG-AUDIT-05');
    const a = await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_lh05_a.csv', `${CSV_HEADER}\nENG-SUP,ENGINEERING TEST,ENG-LOT-R,1000,600,kg,CI,ENG-P\n`);
    let r = await c.req('POST', `/api/shipments/${sid}/reserve`);
    expect(r.json.created).toEqual(['ENG-LOT-R: 600 kg']);
    // Revision B: 500 kg (the shipment net mass is corrected to match, as a real revision would).
    await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_lh05_b.csv', `${CSV_HEADER}\nENG-SUP,ENGINEERING TEST,ENG-LOT-R,1000,500,kg,CI,ENG-P\n`);
    await c.req('PATCH', `/api/shipments/${sid}/fields`, { netMassValue: '500' });
    r = await c.req('POST', `/api/shipments/${sid}/reserve`);
    expect(r.json.created).toEqual(['ENG-LOT-R: 500 kg']);
    // Restore table A: its earlier reservation was released by B, so it must be reserved afresh.
    expect((await c.req('POST', `/api/uploads/${a.uploadId}/confirm`)).status).toBe(200);
    await c.req('PATCH', `/api/shipments/${sid}/fields`, { netMassValue: '600' });
    r = await c.req('POST', `/api/shipments/${sid}/reserve`);
    expect(r.status).toBe(200);
    expect(r.json.created).toEqual(['ENG-LOT-R: 600 kg']);
    const v = await view(c, sid);
    expect(v.evaluation.readiness.allocation).toBe('RESERVED');
    expect(v.allocation[0]).toMatchObject({ requestedGrams: 600000, reservedHereGrams: 600000 });
    // A retry is idempotent and creates nothing new.
    r = await c.req('POST', `/api/shipments/${sid}/reserve`);
    expect(r.json.created).toEqual([]);
    expect(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM allocations WHERE shipment_id = ? AND status = 'reserved'`, sid)!.n).toBe(1);
  });

  it.runIf(haveData)('LH-06: once a signal is investigated with evidence, the supplier request no longer asks for it', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (LH-06)');
    const sid = await newCase(c, 'ENG-AUDIT-06');
    const kit = (n: string) => readFileSync(`web/public/test-kit/${n}`, 'utf8');
    await confirm(c, sid, 'sources_csv', 'A1_ENGINEERING_TEST_sources.csv', kit('A1_ENGINEERING_TEST_sources.csv'));
    await confirm(c, sid, 'plots_geojson', 'A2_ENGINEERING_TEST_plots.geojson', kit('A2_ENGINEERING_TEST_plots.geojson'));
    await worker.drain();
    let doc = await c.req('POST', `/api/shipments/${sid}/documents/supplier_request_pdf`);
    expect(doc.json.validation.itemsListed).toBe(1);
    const ev = await c.upload(sid, 'review_evidence', 'A4_ENGINEERING_TEST_investigation_evidence.txt', kit('A4_ENGINEERING_TEST_investigation_evidence.txt'));
    expect((await c.req('POST', `/api/shipments/${sid}/decisions`, { findingKey: 'ENV:ENG-KIT-A-P1', decision: 'investigated_not_blocking', rationale: 'Engineering test: the kit evidence file is attached to exercise this step.', evidenceUploadId: ev.json.uploadId })).status).toBe(201);
    const f = (await view(c, sid)).evaluation.findings.find((x: any) => x.key === 'ENV:ENG-KIT-A-P1');
    expect(f).toMatchObject({ supplierActionable: false, reviewedWithEvidence: true });
    doc = await c.req('POST', `/api/shipments/${sid}/documents/supplier_request_pdf`);
    expect(doc.json.validation.itemsListed).toBe(0);
  });

  it('LH-09: a truncated PNG is refused with a clear 415, not a server error', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (LH-09)');
    const sid = await newCase(c, 'ENG-AUDIT-09');
    for (const [name, bytes] of [['ENGINEERING_TEST_short.png', 'x'], ['ENGINEERING_TEST_short.jpg', 'x']] as const) {
      const r = await c.upload(sid, 'review_evidence', name, bytes);
      expect(r.status).toBe(415);
      expect(r.json.error.code).toBe('type');
    }
  });

  it('post-anchor revision: a source table cannot be revised once its reservation is anchored on the testnet', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (anchor freeze)');
    const sid = await newCase(c, 'ENG-AUDIT-ANCHOR');
    await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_anchor_a.csv', `${CSV_HEADER}\nENG-SUP,ENGINEERING TEST,ENG-LOT-AN,1000,600,kg,CI,ENG-P\n`);
    expect((await c.req('POST', `/api/shipments/${sid}/reserve`)).status).toBe(200);
    const alloc = get<{ id: string; org_id: string; source_lot_id: string }>(db, `SELECT id, org_id, source_lot_id FROM allocations WHERE shipment_id = ? AND status = 'reserved'`, sid)!;
    // Simulate a confirmed anchoring record (no network involved).
    run(db, `INSERT INTO chain_txs (id, org_id, shipment_id, allocation_id, source_lot_id, action, idempotency_key, network, chain_id, contract_address, signer, args_json, status, attempts, created_at, updated_at)
      VALUES ('eng-anchor-1', ?, ?, ?, ?, 'reserve', 'eng-anchor-key-1', 'engineering', 0, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '{}', 'confirmed', 1, datetime('now'), datetime('now'))`, alloc.org_id, sid, alloc.id, alloc.source_lot_id);
    const b = await confirm(c, sid, 'sources_csv', 'ENGINEERING_TEST_anchor_b.csv', `${CSV_HEADER}\nENG-SUP,ENGINEERING TEST,ENG-LOT-AN,1000,500,kg,CI,ENG-P\n`);
    expect(b.confirm.status).toBe(409);
    expect(b.confirm.json.error.code).toBe('anchored');
    expect(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM allocations WHERE shipment_id = ? AND status = 'reserved'`, sid)!.n).toBe(1);
  });
});
