// ENGINEERING TEST KIT: runs every downloadable kit file (web/public/test-kit) through the API in a temporary
// database and checks that the outcomes promised in docs/AUDIT_GUIDE.md and on /test-kit actually happen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { setupEnv, client, type Client } from './harness.ts';

const env = setupEnv();
const { openDb } = await import('../../server/db.ts');
const { createApp } = await import('../../server/app.ts');
const { startWorker } = await import('../../server/jobs.ts');
const { createJobHandlers, verifyDatasets } = await import('../../server/handlers.ts');
const { DATASETS } = await import('../../server/env/forest.ts');

const KIT = 'web/public/test-kit';
const kit = (name: string) => readFileSync(`${KIT}/${name}`, 'utf8');
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

async function newCase(c: Client, ref: string) {
  const r = await c.req('POST', '/api/shipments', { reference: ref });
  expect(r.status).toBe(201);
  return r.json.id as string;
}
async function upload(c: Client, sid: string, kind: string, name: string) {
  return c.upload(sid, kind, name, kit(name));
}
async function uploadConfirm(c: Client, sid: string, kind: string, name: string) {
  const u = await upload(c, sid, kind, name);
  expect([200, 201]).toContain(u.status);
  const conf = await c.req('POST', `/api/uploads/${u.json.uploadId}/confirm`);
  return { upload: u, confirm: conf };
}
const view = async (c: Client, sid: string) => (await c.req('GET', `/api/shipments/${sid}`)).json;
const settled = async (c: Client, sid: string) => {
  await worker.drain();
  return view(c, sid);
};

describe('engineering test kit files', () => {
  it('every kit file is labelled as engineering test data and uses ENG-KIT identifiers', () => {
    const files = readdirSync(KIT).filter((f) => !f.endsWith('.json'));
    expect(files.length).toBe(10);
    for (const f of files) {
      expect(f).toContain('ENGINEERING_TEST');
      const text = kit(f);
      expect(text).toMatch(/ENGINEERING TEST/);
      const ids = text.match(/ENG-[A-Z0-9-]+/g) ?? [];
      for (const id of ids) expect(id.startsWith('ENG-KIT-')).toBe(true);
    }
  });

  it.runIf(haveData)('scenario A: a complete case reaches sign-off and a schema-valid XML draft', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (kit A)');
    const sid = await newCase(c, 'ENG-KIT-A');
    // Field extraction from the labelled document: the label parser is used and labelled; the embedded
    // instruction is ignored; EORI and country stay missing; nothing applies before acceptance.
    const doc = await upload(c, sid, 'document', 'A3_ENGINEERING_TEST_shipping_document.txt');
    const ex = await c.req('POST', `/api/shipments/${sid}/extract`, { uploadId: doc.json.uploadId });
    expect(ex.status).toBe(201);
    expect(ex.json.method).toBe('Label parser (deterministic, not AI)');
    const by = Object.fromEntries(ex.json.candidates.map((x: any) => [x.field, x]));
    expect(by.netMassValue).toMatchObject({ value: '600', accepted: true });
    expect(by.operatorEori).toMatchObject({ status: 'not_found', accepted: false });
    expect(by.countryOfActivity).toMatchObject({ status: 'not_found', accepted: false });
    expect(ex.json.candidates.some((x: any) => /99999|XX123/.test(x.value ?? ''))).toBe(false);
    expect(Object.keys((await view(c, sid)).fields)).toHaveLength(0);
    const accepted = ex.json.candidates.filter((x: any) => x.accepted).map((x: any) => x.field);
    expect((await c.req('POST', `/api/extractions/${ex.json.id}/accept`, { fields: accepted })).status).toBe(200);
    expect((await c.req('PATCH', `/api/shipments/${sid}/fields`, { operatorEori: 'BE0000000000', countryOfActivity: 'BE' })).status).toBe(200);

    expect((await uploadConfirm(c, sid, 'sources_csv', 'A1_ENGINEERING_TEST_sources.csv')).confirm.status).toBe(200);
    expect((await uploadConfirm(c, sid, 'plots_geojson', 'A2_ENGINEERING_TEST_plots.geojson')).confirm.status).toBe(200);
    let v = await settled(c, sid);
    expect(v.evaluation.readiness).toMatchObject({ record: 'COMPLETE', environment: 'NEEDS_REVIEW', allocation: 'NOT_RESERVED', overall: 'NEEDS_HUMAN_REVIEW' });
    expect(v.plots.features.map((f: any) => [f.plotRef, f.env?.status])).toEqual([['ENG-KIT-A-P1', 'NEEDS_HUMAN_REVIEW'], ['ENG-KIT-A-P2', 'NO_POST_2020_LOSS_OBSERVED']]);

    // The supplier request is available while the case is held.
    expect((await c.req('POST', `/api/shipments/${sid}/documents/supplier_request_pdf`)).status).toBe(201);
    // An investigation needs an evidence file.
    const ev = await upload(c, sid, 'review_evidence', 'A4_ENGINEERING_TEST_investigation_evidence.txt');
    const dec = await c.req('POST', `/api/shipments/${sid}/decisions`, { findingKey: 'ENV:ENG-KIT-A-P1', decision: 'investigated_not_blocking', rationale: 'Engineering test: the kit evidence file is attached to exercise this step.', evidenceUploadId: ev.json.uploadId });
    expect(dec.status).toBe(201);
    expect((await c.req('POST', `/api/shipments/${sid}/reserve`)).status).toBe(200);
    v = await view(c, sid);
    expect(v.evaluation.readiness.overall).toBe('READY_FOR_SIGN_OFF');
    expect((await c.req('POST', `/api/shipments/${sid}/approve`, { digest: v.digest })).status).toBe(201);
    expect((await view(c, sid)).approval.state).toBe('current'); // shown as REVIEWED DRAFT
    const xml = await c.req('POST', `/api/shipments/${sid}/documents/dds_xml`);
    expect(xml.status).toBe(201);
    expect(xml.json.validation).toMatchObject({ valid: true, base64RoundTrip: true, producers: 2, draftStatus: 'DRAFT_NOT_SUBMITTED' });
  });

  it.runIf(haveData)('scenario B: every deliberate error is reported against its row, column or plot', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (kit B)');
    const sid = await newCase(c, 'ENG-KIT-B');
    const broken = await upload(c, sid, 'plots_geojson', 'B3_ENGINEERING_TEST_broken.geojson');
    expect(broken.json).toMatchObject({ parseStatus: 'rejected' });
    expect(broken.json.error).toMatch(/Not valid JSON/);
    expect((await uploadConfirm(c, sid, 'sources_csv', 'B1_ENGINEERING_TEST_sources_with_errors.csv')).confirm.status).toBe(200);
    expect((await uploadConfirm(c, sid, 'plots_geojson', 'B2_ENGINEERING_TEST_plots_with_errors.geojson')).confirm.status).toBe(200);
    let v = await settled(c, sid);
    const keys = v.evaluation.findings.map((f: any) => f.key);
    for (const k of [
      'SRC-ROW:2:quantity_ambiguous_separator',
      'SRC-ROW:4:invalid_producer_country',
      'SRC-ROW:5:missing_plot_refs',
      'ALLOC-EXCESS:ENG-KIT-SUP-B::ENG-KIT-LOT-B2',
      'PLOT-MISSING:ENG-KIT-B-P5',
      'PLOT-GEOM:ENG-KIT-B-P1:self_intersection',
      'PLOT-GEOM:ENG-KIT-B-P2:possible_lat_lon_swap',
      'PLOT-GEOM:ENG-KIT-B-P3:ring_not_closed',
      'PLOT-GEOM:ENG-KIT-B-P4:point_area_missing',
    ])
      expect(keys).toContain(k);
    expect(v.evaluation.readiness).toMatchObject({ environment: 'BLOCKED_BY_GEOMETRY', allocation: 'CONFLICT', overall: 'HOLD' });
    // The lat/lon swap is offered as a correction, never applied silently: it creates a new file to preview.
    const p2 = v.plots.features.find((f: any) => f.plotRef === 'ENG-KIT-B-P2');
    const corr = await c.req('POST', `/api/shipments/${sid}/plots/${p2.featureIndex}/swap-correction`);
    expect(corr.status).toBe(201);
    expect((await view(c, sid)).plots.upload.filename).toBe('B2_ENGINEERING_TEST_plots_with_errors.geojson');
    expect((await c.req('POST', `/api/uploads/${corr.json.uploadId}/confirm`)).status).toBe(200);
    v = await settled(c, sid);
    expect(v.evaluation.findings.map((f: any) => f.key)).not.toContain('PLOT-GEOM:ENG-KIT-B-P2:possible_lat_lon_swap');
    expect(v.plots.features.find((f: any) => f.plotRef === 'ENG-KIT-B-P2').env?.status).toBe('NO_POST_2020_LOSS_OBSERVED');
  });

  it.runIf(haveData)('scenario C: one source lot cannot be over-allocated across two cases', async () => {
    const c = client(app);
    await c.register('ENGINEERING TEST ORG (kit C)');
    const one = await newCase(c, 'ENG-KIT-C-1');
    const two = await newCase(c, 'ENG-KIT-C-2');
    await uploadConfirm(c, one, 'sources_csv', 'C1_ENGINEERING_TEST_sources_case1.csv');
    await uploadConfirm(c, one, 'plots_geojson', 'C3_ENGINEERING_TEST_plots.geojson');
    await uploadConfirm(c, two, 'sources_csv', 'C2_ENGINEERING_TEST_sources_case2.csv');
    await uploadConfirm(c, two, 'plots_geojson', 'C3_ENGINEERING_TEST_plots.geojson');
    const r1 = await c.req('POST', `/api/shipments/${one}/reserve`);
    expect(r1.status).toBe(200);
    expect(r1.json.created).toEqual(['ENG-KIT-LOT-C: 700 kg']);
    const r2 = await c.req('POST', `/api/shipments/${two}/reserve`);
    expect(r2.status).toBe(409);
    expect(r2.json.rejected[0].title).toBe('Source lot ENG-KIT-LOT-C over-allocated by 100 kg');
    const v2 = await view(c, two);
    expect(v2.evaluation.readiness.allocation).toBe('CONFLICT');
    expect(v2.allocation[0].display).toMatchObject({ requested: '400 kg', others: '700 kg', available: '300 kg', excess: '100 kg' });
    expect(v2.allocation[0].display.declared.replace(/\s/g, ' ')).toBe('1 000 kg');
  });
});
