// ENGINEERING VERIFICATION of the in-app anchoring path on the public Sepolia testnet.
// Uses a throwaway database and the labelled engineering fixture (600 kg / 400 kg test allocations).
// It proves the application code path reaches confirmed testnet state; it says nothing about real cocoa.
//   node --env-file=.env scripts/app-anchoring-sepolia.ts
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'lothold-anchor-'));
process.env.EVIDENCE_DIR = join(dir, 'evidence');
process.env.EVIDENCE_ENCRYPTION_KEY ??= randomBytes(32).toString('hex');
process.env.DOWNLOAD_SIGNING_KEY ??= randomBytes(32).toString('hex');
process.env.CHAIN_NETWORK = 'sepolia';
const { openDb, get, all, run } = await import('../server/db.ts');
const { createApp } = await import('../server/app.ts');
const { anchorAllocationJob, chainStatus } = await import('../server/chain/anchor.ts');

const db = openDb(join(dir, 'db.sqlite'));
const app = createApp(db);
let cookie = '', csrf = '';
async function req(method: string, path: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = { origin: 'http://localhost:5173' };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body) headers['content-type'] = 'application/json';
  const r = await app.request(path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0]!;
  return r.json() as Promise<any>;
}
csrf = (await req('POST', '/api/auth/register', { email: `anchor-${Date.now()}@example.test`, password: 'engineering-test-pw', name: 'Engineering', organisation: 'ENGINEERING TEST ORG (anchoring run)' })).csrf;
const sid = (await req('POST', '/api/shipments', { reference: `ENG-ANCHOR-${Date.now()}` })).id;
const fd = new FormData();
fd.append('file', new File([new Uint8Array(readFileSync('tests/fixtures/engineering/ENGINEERING_TEST_sources.csv'))], 'ENGINEERING_TEST_sources.csv', { type: 'text/csv' }));
const up = await req('POST', `/api/shipments/${sid}/uploads?kind=sources_csv`, undefined, fd);
await req('POST', `/api/uploads/${up.uploadId}/confirm`);
console.log('reserve', await req('POST', `/api/shipments/${sid}/reserve`));
run(db, `UPDATE orgs SET chain_enabled = 1`);
console.log('queue', await req('POST', `/api/shipments/${sid}/chain/anchor`));
for (const a of all<{ id: string }>(db, `SELECT id FROM allocations WHERE shipment_id = ?`, sid)) {
  await anchorAllocationJob(db, { allocationId: a.id });
}
const user = get<any>(db, `SELECT u.id, u.org_id AS orgId, o.name AS orgName, u.email, u.name, u.role, '' AS csrf, 1 AS chainEnabled FROM users u JOIN orgs o ON o.id = u.org_id LIMIT 1`);
const status = await chainStatus(db, user, sid);
const evidence = { label: 'ENGINEERING TEST — in-app anchoring path on Sepolia. Engineering fixture quantities; not commercial inventory.', runAt: new Date().toISOString(), ...status };
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/app-anchoring-sepolia.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ transactions: status.transactions.map((t: any) => `${t.action}:${t.status}:${t.txHash}`), onChain: status.onChain }, null, 1));
db.close();
