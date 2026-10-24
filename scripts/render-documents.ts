// ENGINEERING: runs the full review on labelled fixtures in a throwaway database and writes the three generated
// documents to an output folder for visual inspection. Not operational data.
//   node scripts/render-documents.ts <outDir>
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const out = process.argv[2] ?? 'rendered';
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'lothold-docs-'));
Object.assign(process.env, { EVIDENCE_DIR: join(dir, 'ev'), EVIDENCE_ENCRYPTION_KEY: randomBytes(32).toString('hex'), DOWNLOAD_SIGNING_KEY: randomBytes(32).toString('hex'), CHAIN_ANCHORING: 'off' });
const { openDb } = await import('../server/db.ts');
const { createApp } = await import('../server/app.ts');
const { startWorker } = await import('../server/jobs.ts');
const { createJobHandlers, verifyDatasets } = await import('../server/handlers.ts');
const db = openDb(join(dir, 'db.sqlite'));
const app = createApp(db);
const worker = startWorker(db, createJobHandlers(db, { datasetsOk: await verifyDatasets(() => {}) }), { intervalMs: 50, log: () => {} });
let cookie = '', csrf = '';
async function req(method: string, path: string, body?: unknown, form?: FormData): Promise<any> {
  const headers: Record<string, string> = { origin: 'http://localhost:5173' };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body) headers['content-type'] = 'application/json';
  const r = await app.request(path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0]!;
  const ct = r.headers.get('content-type') ?? '';
  return ct.includes('json') ? r.json() : Buffer.from(await r.arrayBuffer());
}
const file = (name: string, content: string) => { const f = new FormData(); f.append('file', new File([new Uint8Array(Buffer.from(content))], name)); return f; };
async function confirm(sid: string, kind: string, name: string, content: string) {
  const u = await req('POST', `/api/shipments/${sid}/uploads?kind=${kind}`, undefined, file(name, content));
  await req('POST', `/api/uploads/${u.uploadId}/confirm`);
  return u.uploadId;
}
const save = async (r: any, name: string) => writeFileSync(join(out, name), await req('GET', r.url));
const drain = () => worker.drain();

csrf = (await req('POST', '/api/auth/register', { email: `docs-${Date.now()}@example.test`, password: 'engineering-test-pw', name: 'Engineering Reviewer', organisation: 'ENGINEERING TEST ORG' })).csrf;
const header = 'supplier_id,supplier_name,source_lot_ref,source_lot_declared_quantity,allocated_quantity,quantity_unit,producer_country,plot_refs';
const SIGNAL = [[[-7.56, 6.24], [-7.55, 6.24], [-7.55, 6.25], [-7.56, 6.25], [-7.56, 6.24]]];
const CLEAR = [[[-7.205, 5.745], [-7.195, 5.745], [-7.195, 5.755], [-7.205, 5.755], [-7.205, 5.745]]];
const plots = (fs: [string, unknown][]) => JSON.stringify({ type: 'FeatureCollection', features: fs.map(([ref, c]) => ({ type: 'Feature', properties: { plot_ref: ref, ProducerCountry: 'CI' }, geometry: { type: 'Polygon', coordinates: c } })) });

// Case A: held — missing plot + land-change signal + an over-allocation in a second lot.
const a = (await req('POST', '/api/shipments', { reference: 'ENG-DOC-HOLD' })).id;
await req('PATCH', `/api/shipments/${a}/fields`, { activityType: 'IMPORT', hsCode: '1801', description: 'ENGINEERING TEST cocoa beans', netMassValue: '1000', netMassUnit: 'kg', operatorName: 'ENGINEERING TEST OPERATOR', countryOfActivity: 'BE' });
await confirm(a, 'sources_csv', 'ENGINEERING_TEST_sources_A.csv', `${header}\nENG-S1,ENGINEERING TEST,ENG-L1,1000,600,kg,CI,ENG-P1;ENG-P2\nENG-S1,ENGINEERING TEST,ENG-L2,300,400,kg,CI,ENG-P3\n`);
await confirm(a, 'plots_geojson', 'ENGINEERING_TEST_plots_A.geojson', plots([['ENG-P1', SIGNAL], ['ENG-P3', CLEAR]]));
await drain();
await save(await req('POST', `/api/shipments/${a}/documents/supplier_request_pdf`), 'A-supplier-request.pdf');
await save(await req('POST', `/api/shipments/${a}/documents/review_draft_pdf`), 'A-review-draft.pdf');

// Case C: complete, reviewed, signed off → XML.
const c = (await req('POST', '/api/shipments', { reference: 'ENG-DOC-COMPLETE' })).id;
await req('PATCH', `/api/shipments/${c}/fields`, { activityType: 'IMPORT', hsCode: '1801', description: 'ENGINEERING TEST cocoa beans', netMassValue: '0.6', netMassUnit: 't', operatorName: 'ENGINEERING TEST OPERATOR', operatorEori: 'BE0000000000', countryOfActivity: 'BE' });
await confirm(c, 'sources_csv', 'ENGINEERING_TEST_sources_C.csv', `${header}\nENG-S9,ENGINEERING TEST,ENG-L9,1000,600,kg,CI,ENG-P8;ENG-P9\n`);
await confirm(c, 'plots_geojson', 'ENGINEERING_TEST_plots_C.geojson', plots([['ENG-P8', SIGNAL], ['ENG-P9', CLEAR]]));
await drain();
const ev = await req('POST', `/api/shipments/${c}/uploads?kind=review_evidence`, undefined, file('ENGINEERING_TEST_evidence.txt', 'ENGINEERING TEST evidence — not a real record'));
await req('POST', `/api/shipments/${c}/decisions`, { findingKey: 'ENV:ENG-P8', decision: 'investigated_not_blocking', rationale: 'ENGINEERING TEST: rationale text used to exercise the review-with-evidence path.', evidenceUploadId: ev.uploadId });
await req('POST', `/api/shipments/${c}/reserve`);
const v = await req('GET', `/api/shipments/${c}`);
console.log('case C overall', v.evaluation.readiness.overall);
await req('POST', `/api/shipments/${c}/approve`, { digest: v.digest, note: 'engineering test sign-off' });
const xml = await req('POST', `/api/shipments/${c}/documents/dds_xml`);
console.log('xml', xml.filename, JSON.stringify(xml.validation));
await save(xml, 'C-dds-v3.xml');
await save(await req('POST', `/api/shipments/${c}/documents/review_draft_pdf`), 'C-review-draft.pdf');
await save(await req('POST', `/api/shipments/${c}/documents/supplier_request_pdf`), 'C-supplier-request.pdf');
await worker.stop();
db.close();
console.log('written to', out);
