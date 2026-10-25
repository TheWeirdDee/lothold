// ENGINEERING CHECK of a running production container (throwaway volume, LOTHOLD_INSTANCE=engineering).
//   node scripts/container-verify.ts seed          <base> <state.json>   before a restart
//   node scripts/container-verify.ts after-restart <base> <state.json>   after `docker restart`
// "seed" checks readiness, datasets, migrations (via the API surface), auth, uploads, analysis and exports and
// saves what it created; "after-restart" logs in again and checks that all of it survived. Prints JSON lines;
// exits non-zero on the first failed check. The state file holds an engineering test password only.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [phase, base = 'http://127.0.0.1:8790', stateFile = 'container-state.json'] = process.argv.slice(2);
if (phase !== 'seed' && phase !== 'after-restart') { console.error('usage: seed|after-restart <base> <state.json>'); process.exit(1); }

let cookie = '', csrf = '';
async function call(method: string, path: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = { origin: base };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0]!;
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { json = null; }
  return { status: res.status, json, buf, type: res.headers.get('content-type') ?? '' };
}
const results: Record<string, unknown> = {};
const healthLatencies: number[]=[]; const statusLatencies:number[]=[];
function check(name: string, ok: boolean, detail?: unknown) {
  results[name] = ok ? 'pass' : { fail: detail };
  console.log(JSON.stringify({ check: name, ok, ...(detail !== undefined ? { detail } : {}) }));
  if (!ok) process.exit(1);
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try { const r = await call('GET', '/api/ready'); if (r.status === 200) return r.json; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('server not ready after 120 s');
}

const ready = await waitReady();
check('ready', ready.ready === true);
const health = (await call('GET', '/api/health')).json;
check('engineering instance', health.instance === 'engineering', health.instance);
const method = (await call('GET', '/api/public/method')).json;
check('datasets present and hash-verified at startup', method.datasets.length === 3 && method.datasets.every((d: any) => d.availability?.present && d.availability.sizeMatches && d.availability.sha256 === d.sha256), method.datasets.map((d: any) => ({ id: d.id, ...d.availability, pinned: d.sha256 })));
const spa = await call('GET', '/');
check('built frontend served', spa.status === 200 && spa.type.includes('text/html') && spa.buf.toString().includes('<div id="root">'), spa.status);

if (phase === 'seed') {
  const email = `container-${Date.now()}@example.test`;
  const password = randomBytes(12).toString('hex');
  let r = await call('POST', '/api/auth/register', { email, password, name: 'Engineering Container Check', organisation: 'ENGINEERING TEST ORG (container)' });
  check('register', r.status === 201 || r.status === 200, r.status);
  csrf = r.json.csrf;
  r = await call('GET', '/api/auth/me');
  check('session', r.status === 200 && r.json.user?.email === email, r.status);
  r = await call('POST', '/api/shipments', { reference: 'ENG-CONTAINER-001' });
  check('create shipment', r.status === 201, r.status);
  const sid = r.json.id;
  r = await call('PATCH', `/api/shipments/${sid}/fields`, { activityType: 'IMPORT', hsCode: '1801', description: 'ENGINEERING TEST cocoa beans', netMassValue: '1000', netMassUnit: 'kg', operatorName: 'ENGINEERING TEST OPERATOR', countryOfActivity: 'BE' });
  check('fields', r.status === 200, r.status);
  const up = async (kind: string, file: string, type: string) => {
    const fd = new FormData();
    const bytes = readFileSync(file);
    fd.append('file', new File([new Uint8Array(bytes)], file.split('/').pop()!, { type }));
    const res = await call('POST', `/api/shipments/${sid}/uploads?kind=${kind}`, undefined, fd);
    return { res, sha: sha(bytes) };
  };
  const csv = await up('sources_csv', 'tests/fixtures/engineering/ENGINEERING_TEST_sources.csv', 'text/csv');
  check('upload csv', csv.res.status === 201 || csv.res.status === 200, csv.res.status);
  r = await call('POST', `/api/uploads/${csv.res.json.uploadId}/confirm`);
  check('confirm csv', r.status === 200, r.status);
  const geo = await up('plots_geojson', 'tests/fixtures/engineering/ENGINEERING_TEST_plots.geojson', 'application/geo+json');
  check('upload geojson', geo.res.status === 201 || geo.res.status === 200, geo.res.status);
  r = await call('POST', `/api/uploads/${geo.res.json.uploadId}/confirm`);
  check('confirm geojson', r.status === 200, r.status);
  let view: any;
  const analysed = (v: any) => (v.plots?.features ?? []).filter((f: any) => f.report.valid && f.env?.status);
  const analysisStart=performance.now();
  for (let i = 0; i < 300; i++) {
    const began=performance.now(); const health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(5000)}); await health.arrayBuffer(); healthLatencies.push(performance.now()-began);
    if(health.status!==200) throw new Error('Health failed during analysis');
    const statusStart=performance.now();
    view = (await call('GET', `/api/shipments/${sid}`)).json;
    statusLatencies.push(performance.now()-statusStart);
    if (view.evaluation.readiness.environment !== 'IN_PROGRESS' && analysed(view).length > 0) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  const percentile=(v:number[])=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*0.95)-1];
  check('ordinary API responsive during raster job',healthLatencies.length>1 && Math.max(...healthLatencies)<5000 && Math.max(...statusLatencies)<5000,{samples:healthLatencies.length,healthP95ms:percentile(healthLatencies),healthMaxMs:Math.max(...healthLatencies),statusP95ms:percentile(statusLatencies),statusMaxMs:Math.max(...statusLatencies),analysisWaitMs:performance.now()-analysisStart});
  const done = analysed(view);
  check('environmental analysis ran on real rasters', done.length > 0 && done.every((f: any) => f.env.grid && f.env.status !== 'UNAVAILABLE'), done.map((f: any) => ({ plot: f.plotRef, status: f.env.status, summary: f.env.summary })));
  r = await call('POST', `/api/shipments/${sid}/documents/supplier_request_pdf`);
  check('generate supplier request PDF', r.status === 201, r.status);
  const docId = r.json.id;
  const pdf = await call('GET', r.json.url);
  check('download PDF', pdf.status === 200 && pdf.buf.subarray(0, 5).toString() === '%PDF-', pdf.status);
  r = await call('POST', `/api/uploads/${csv.res.json.uploadId}/download-link`);
  const back = await call('GET', r.json.url);
  check('uploaded evidence decrypts byte for byte', back.status === 200 && sha(back.buf) === csv.sha);
  writeFileSync(stateFile, JSON.stringify({ email, password, sid, docId, pdfSha: sha(pdf.buf), csvUpload: csv.res.json.uploadId, csvSha: csv.sha, readiness: view.evaluation.readiness, findings: view.evaluation.findings.length }, null, 2));
} else {
  const s = JSON.parse(readFileSync(stateFile, 'utf8'));
  let r = await call('POST', '/api/auth/login', { email: s.email, password: s.password });
  check('login after restart', r.status === 200, r.status);
  csrf = r.json.csrf;
  r = await call('GET', `/api/shipments/${s.sid}`);
  check('shipment persisted', r.status === 200 && r.json.shipment?.reference === 'ENG-CONTAINER-001', r.status);
  check('evaluation unchanged', JSON.stringify(r.json.evaluation.readiness) === JSON.stringify(s.readiness) && r.json.evaluation.findings.length === s.findings, r.json.evaluation.readiness);
  r = await call('POST', `/api/documents/${s.docId}/download-link`);
  const pdf = await call('GET', r.json.url);
  check('stored PDF identical after restart', pdf.status === 200 && sha(pdf.buf) === s.pdfSha);
  r = await call('POST', `/api/uploads/${s.csvUpload}/download-link`);
  const back = await call('GET', r.json.url);
  check('stored upload identical after restart', back.status === 200 && sha(back.buf) === s.csvSha);
  r = await call('GET', `/api/shipments/${s.sid}/audit`);
  check('audit history persisted', r.status === 200 && Array.isArray(r.json.events) && r.json.events.length > 0, r.status);
}
console.log(JSON.stringify({ phase, result: 'all checks passed', checks: Object.keys(results).length }));
