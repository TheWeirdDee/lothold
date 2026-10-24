// ENGINEERING SMOKE TEST against a running server with a throwaway database.
//   node tests/smoke-api.ts http://127.0.0.1:8799
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8799';
// Engineering fixtures must never reach an operational workspace.
const health = (await (await fetch(`${base}/api/health`)).json()) as { instance?: string };
if (health.instance !== 'engineering') {
  console.error(`Refusing to run: ${base} is not an engineering instance (start it with LOTHOLD_INSTANCE=engineering and a throwaway DATABASE_PATH).`);
  process.exit(2);
}
let cookie = '';
let csrf = '';
async function call(method: string, path: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = { origin: 'http://localhost:5173' };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0]!;
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const upload = async (shipmentId: string, kind: string, file: string, name: string, type: string) => {
  const fd = new FormData();
  fd.append('file', new File([readFileSync(file)], name, { type }));
  return call('POST', `/api/shipments/${shipmentId}/uploads?kind=${kind}`, undefined, fd);
};

const email = `eng-${Date.now()}@example.test`;
let r = await call('POST', '/api/auth/register', { email, password: 'engineering-test-pw', name: 'Engineering Tester', organisation: 'ENGINEERING TEST ORG' });
console.log('register', r.status);
csrf = r.json.csrf;
r = await call('POST', '/api/shipments', { reference: 'ENG-SHIP-001' });
console.log('create shipment', r.status);
const sid = r.json.id;
r = await call('PATCH', `/api/shipments/${sid}/fields`, { activityType: 'IMPORT', hsCode: '1801', description: 'ENGINEERING TEST cocoa beans', netMassValue: '1000', netMassUnit: 'kg', operatorName: 'ENGINEERING TEST OPERATOR', countryOfActivity: 'BE' });
console.log('fields', r.status, r.json);
r = await upload(sid, 'sources_csv', 'tests/fixtures/engineering/ENGINEERING_TEST_sources.csv', 'ENGINEERING_TEST_sources.csv', 'text/csv');
console.log('upload csv', r.status, r.json);
const csvId = r.json.uploadId;
const dup = await upload(sid, 'sources_csv', 'tests/fixtures/engineering/ENGINEERING_TEST_sources.csv', 'ENGINEERING_TEST_sources.csv', 'text/csv');
console.log('duplicate upload', dup.status, dup.json.duplicate, dup.json.uploadId === csvId);
r = await call('POST', `/api/uploads/${csvId}/confirm`);
console.log('confirm csv', r.status, r.json);
r = await upload(sid, 'plots_geojson', 'tests/fixtures/engineering/ENGINEERING_TEST_plots.geojson', 'ENGINEERING_TEST_plots.geojson', 'application/geo+json');
console.log('upload geojson', r.status, r.json);
r = await call('POST', `/api/uploads/${r.json.uploadId}/confirm`);
console.log('confirm geojson', r.status);
for (let i = 0; i < 40; i++) {
  r = await call('GET', `/api/shipments/${sid}`);
  if (r.json.evaluation.readiness.environment !== 'IN_PROGRESS') break;
  await new Promise((res) => setTimeout(res, 500));
}
const v = r.json;
console.log('readiness', v.evaluation.readiness);
console.log('process', v.evaluation.processLine);
for (const f of v.evaluation.findings) console.log(` [${f.severity}] ${f.key} — ${f.title}`);
r = await call('POST', `/api/shipments/${sid}/reserve`);
console.log('reserve', r.status, JSON.stringify(r.json).slice(0, 300));
r = await call('POST', `/api/shipments/${sid}/documents/supplier_request_pdf`);
console.log('supplier pdf', r.status, r.json.filename, r.json.validation);
r = await call('POST', `/api/shipments/${sid}/documents/dds_xml`);
console.log('xml before approval', r.status, r.json.error?.code);
// Cross-user isolation.
const saved = { cookie, csrf };
cookie = ''; csrf = '';
r = await call('POST', '/api/auth/register', { email: `other-${Date.now()}@example.test`, password: 'engineering-test-pw', name: 'Other', organisation: 'OTHER ENG ORG' });
csrf = r.json.csrf;
r = await call('GET', `/api/shipments/${sid}`);
console.log('other org reads shipment ->', r.status);
r = await call('GET', `/api/uploads/${csvId}`);
console.log('other org reads upload ->', r.status);
Object.assign(globalThis, {});
cookie = saved.cookie; csrf = saved.csrf;
r = await call('POST', `/api/shipments/${sid}/reserve`, undefined);
console.log('reserve again (idempotent?)', r.status);
console.log(JSON.stringify({ shipmentId: sid }));
