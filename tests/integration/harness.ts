// Isolated engineering harness: temp database + temp evidence store + in-process HTTP app.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function setupEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'lothold-test-'));
  process.env.EVIDENCE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  process.env.DOWNLOAD_SIGNING_KEY = randomBytes(32).toString('hex');
  process.env.EVIDENCE_DIR = join(dir, 'evidence');
  process.env.CHAIN_ANCHORING = 'off';
  process.env.REGISTER_RATE_LIMIT = '1000';
  delete process.env.AI_PROVIDER;
  return { dir, dbPath: join(dir, 'db.sqlite') };
}

export type Client = ReturnType<typeof client>;
export function client(app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }) {
  let cookie = '';
  let csrf = '';
  const c = {
    async req(method: string, path: string, body?: unknown, opts: { csrf?: string | null; origin?: string | null; form?: FormData } = {}) {
      const headers: Record<string, string> = {};
      if (cookie) headers.cookie = cookie;
      const token = opts.csrf === undefined ? csrf : opts.csrf;
      if (token) headers['x-csrf-token'] = token;
      if (opts.origin !== null) headers.origin = opts.origin ?? 'http://localhost:5173';
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await app.request(path, { method, headers, body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0]!;
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, json, headers: res.headers, text };
    },
    async register(org: string) {
      const r = await c.req('POST', '/api/auth/register', { email: `${org.toLowerCase().replace(/\W/g, '')}-${randomBytes(3).toString('hex')}@example.test`, password: 'engineering-test-pw', name: `${org} reviewer`, organisation: org });
      if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.json)}`);
      csrf = r.json.csrf;
      return r;
    },
    async upload(shipmentId: string, kind: string, filename: string, content: string | Buffer, type = 'application/octet-stream') {
      const fd = new FormData();
      fd.append('file', new File([new Uint8Array(typeof content === 'string' ? Buffer.from(content) : content)], filename, { type }));
      return c.req('POST', `/api/shipments/${shipmentId}/uploads?kind=${kind}`, undefined, { form: fd });
    },
    get csrf() { return csrf; },
    get cookie() { return cookie; },
  };
  return c;
}

export const fixture = (name: string) => readFileSync(`tests/fixtures/engineering/${name}`, 'utf8');

export const CSV_HEADER = 'supplier_id,supplier_name,source_lot_ref,source_lot_declared_quantity,allocated_quantity,quantity_unit,producer_country,plot_refs';
/** Engineering probe box inside Taï National Park: JRC forest 2020, no Hansen loss 2021–2025 (verified by tests). Not a farm. */
export const CLEAR_PROBE = { type: 'Polygon', coordinates: [[[-7.205, 5.745], [-7.195, 5.745], [-7.195, 5.755], [-7.205, 5.755], [-7.205, 5.745]]] };
/** Engineering probe box with recorded 2021–2025 loss. Not a farm. */
export const SIGNAL_PROBE = { type: 'Polygon', coordinates: [[[-7.56, 6.24], [-7.55, 6.24], [-7.55, 6.25], [-7.56, 6.25], [-7.56, 6.24]]] };
export const plotsFile = (features: { ref: string; geometry: unknown; area?: number }[]) =>
  JSON.stringify({ type: 'FeatureCollection', features: features.map((f) => ({ type: 'Feature', properties: { plot_ref: f.ref, ProducerCountry: 'CI', ...(f.area ? { Area: f.area } : {}) }, geometry: f.geometry })) });
