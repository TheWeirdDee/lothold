// Re-check the recorded engineering case and validate its stored XML independently.
// Reads only the isolated recording credentials; never prints them or signed URLs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateDdsXml } from '../server/dds/xml.ts';

const state = JSON.parse(readFileSync('.env.demo-recording.json', 'utf8'));
const base = 'https://lothold.vercel.app';
if (state.target !== base || state.organisation !== 'ENGINEERING TEST - DEMO' || !state.caseRef.startsWith('ENG-DEMO-')) throw new Error('Expected isolated hosted recording account');
let cookie = '', csrf = '';
async function call(path: string, body?: object) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { origin: base, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  const c = r.headers.get('set-cookie');
  if (c) cookie = c.split(';')[0]!;
  return r;
}
const login = await call('/api/auth/login', { email: state.email, password: state.password });
if (login.status !== 200) throw new Error(`Engineering login HTTP ${login.status}`);
csrf = (await login.json()).csrf;
const sid = new URL(state.caseUrl).pathname.split('/').pop();
const response = await call(`/api/shipments/${sid}`);
if (!response.ok) throw new Error(`Case HTTP ${response.status}`);
const view = await response.json();
if (view.shipment.reference !== state.caseRef || view.approval.state !== 'stale') throw new Error('Recorded case no longer has expected stale approval');
const docs = await (await call(`/api/shipments/${sid}/documents`)).json();
const xml = docs.documents.find((d: { kind: string }) => d.kind === 'dds_xml');
if (!xml?.validation?.valid || !xml.stale || !xml.filename.includes('DRAFT_NOT_SUBMITTED')) throw new Error('Missing genuine validated, now-stale XML draft');
const link = await (await call(`/api/documents/${xml.id}/download-link`, {})).json();
const download = await call(link.url);
if (!download.ok) throw new Error(`XML download HTTP ${download.status}`);
const bytes = Buffer.from(await download.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== xml.sha256) throw new Error('Downloaded XML digest differs');
const independent = await validateDdsXml(bytes.toString('utf8'));
if (!independent.valid) throw new Error('Independent XSD validation failed');
const refused = await call(`/api/shipments/${sid}/documents/dds_xml`, {});
if (refused.status !== 409 || (await refused.json()).error?.code !== 'not_approved') throw new Error('Stale snapshot export was not blocked');
writeFileSync('docs/evidence/demo-artifacts-final.json', JSON.stringify({ checkedAt: new Date().toISOString(), target: base, caseReference: state.caseRef, approvalState: view.approval.state, xml: { filename: xml.filename, bytes: bytes.length, sha256: digest, originalValidation: xml.validation, independentValidation: independent, stale: xml.stale }, staleExportRefused: true, regulatorySubmissionPerformed: false, credentialsLogged: false }, null, 2) + '\n');
console.log('Recorded engineering case confirmed; stored XML digest and independent XSD validation passed; stale export refused.');
