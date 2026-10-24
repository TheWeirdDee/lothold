import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { type DB, all, audit, get, id, now, run, tx } from './db.ts';
import {
  PASSWORD_MIN, SESSION_COOKIE, SESSION_TTL_MS, createSession, csrfMatches, destroySession, hashPassword, rateLimit, sessionUser, signDownload, verifyDownload, verifyPassword, readBytes, type SessionUser,
} from './security.ts';
import {
  HttpError, LIMITS, SHIPMENT_FIELDS, approve, computeState, confirmUpload, createShipment, getUpload, handleUpload, listShipments, recordDecision, reserveAllocations, setFields, uploadBytes, getShipment, type UploadKind,
} from './service.ts';
import { enqueue } from './jobs.ts';
import { analysePlot, DATASETS, COVERAGE_BBOX, ANALYSIS_METHOD_VERSION, datasetAvailability, CUTOFF_YEAR, isVerificationDone } from './env/forest.ts';
import { validatePlotGeometry } from '../core/geometry.ts';
import { blankSourcesTemplate, SOURCE_COLUMNS } from '../core/sources.ts';
import { RULES_VERSION } from '../core/rules.ts';
import { buildShipmentView } from './view.ts';
import { generateDocument, documentList } from './documents.ts';
import { extractionStatus, runExtraction, acceptExtraction } from './ai/extract.ts';
import { chainStatus, queueAnchoring, publicVerify } from './chain/anchor.ts';
import { swapAxesCorrection } from './corrections.ts';
import { demoVideoFromEnv, contentSecurityPolicy } from './demo-video.ts';

type Env = { Variables: { user: SessionUser | null; db: DB } };

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ t: now(), ...o }));

export function createApp(db: DB, opts: { publicOrigin?: string; secureCookies?: boolean } = {}) {
  const app = new Hono<Env>();
  const secure = opts.secureCookies ?? process.env.NODE_ENV === 'production';
  const demoVideo = demoVideoFromEnv();
  if (demoVideo.error) log({ event: 'config_warning', setting: 'DEMO_VIDEO', message: demoVideo.error });
  const csp = contentSecurityPolicy(demoVideo);
  const allowedOrigins = new Set([opts.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173', 'http://localhost:8787', 'http://127.0.0.1:8787', 'http://127.0.0.1:5173']);

  app.use('*', async (c, next) => {
    const started = Date.now();
    c.set('db', db);
    c.set('user', sessionUser(db, getCookie(c, SESSION_COOKIE)));
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    if (!c.req.path.startsWith('/api/'))
      c.header('Content-Security-Policy', csp);
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
    // Privacy-conscious request log: no bodies, no query strings, no cookies.
    log({ event: 'http', method: c.req.method, path: c.req.routePath ?? c.req.path, status: c.res.status, ms: Date.now() - started, user: c.get('user')?.id ?? null });
  });

  // Request size limits: multipart uploads are bounded per kind in the handler (max 25 MB); everything else is JSON.
  const tooLarge = (c: Context<Env>) => c.json({ error: { code: 'too_large', message: 'Request body too large.' } }, 413);
  app.use('/api/shipments/:id/uploads', bodyLimit({ maxSize: 26 * 1024 * 1024, onError: tooLarge }));
  app.use('/api/*', async (c, next) => {
    if (c.req.path.endsWith('/uploads')) return next();
    return bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge })(c, next);
  });

  // CSRF: every state-changing API request must carry the session's CSRF token and a same-site Origin.
  app.use('/api/*', async (c, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && !allowedOrigins.has(origin)) return c.json({ error: { code: 'bad_origin', message: 'Cross-origin request refused.' } }, 403);
      const user = c.get('user');
      const isAuthEntry = c.req.path === '/api/auth/login' || c.req.path === '/api/auth/register' || c.req.path === '/api/public/forest-check';
      if (user && !isAuthEntry && !csrfMatches(user.csrf, c.req.header('x-csrf-token'))) return c.json({ error: { code: 'csrf', message: 'Missing or invalid CSRF token. Reload the page.' } }, 403);
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: { code: 'invalid_request', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') } }, 400);
    log({ event: 'error', path: c.req.path, message: (err as Error).message });
    return c.json({ error: { code: 'internal', message: 'Unexpected server error. The request was not completed.' } }, 500);
  });

  const requireUser = (c: Context<Env>): SessionUser => {
    const u = c.get('user');
    if (!u) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
    return u;
  };
  // Client-supplied X-Forwarded-For is only trusted behind a configured reverse proxy; otherwise anyone could
  // rotate the header to bypass per-IP rate limits.
  const ip = (c: Context<Env>) => {
    if (process.env.TRUST_PROXY === 'true') {
      // Prefer a single-value header set by the platform proxy (e.g. TRUST_PROXY_HEADER=fly-client-ip).
      const named = process.env.TRUST_PROXY_HEADER ? c.req.header(process.env.TRUST_PROXY_HEADER)?.trim() : undefined;
      if (named) return named;
      // Otherwise use the LAST X-Forwarded-For entry: the one appended by our own proxy. Earlier entries are client-controlled.
      const xff = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean);
      if (xff?.length) return xff[xff.length - 1]!;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };
  const limit = (c: Context<Env>, bucket: string, n: number, windowMs: number) => {
    const r = rateLimit(db, bucket, n, windowMs);
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterS));
      throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${r.retryAfterS} s.`);
    }
  };

  // ---------------- public ----------------
  app.get('/api/health', (c) => c.json({ ok: true, instance: process.env.LOTHOLD_INSTANCE === 'engineering' ? 'engineering' : 'operational', rulesVersion: RULES_VERSION, analysisMethod: ANALYSIS_METHOD_VERSION, datasets: datasetAvailability() }));

  // Readiness: 200 once the startup dataset verification has finished (successfully or not).
  app.get('/api/ready', (c) => (isVerificationDone() ? c.json({ ready: true, datasets: datasetAvailability() }) : c.json({ ready: false }, 503)));

  app.get('/api/public/method', (c) =>
    c.json({
      rulesVersion: RULES_VERSION,
      analysisMethod: ANALYSIS_METHOD_VERSION,
      cutoffYear: CUTOFF_YEAR,
      coverageBbox: COVERAGE_BBOX,
      datasets: Object.values(DATASETS).map(({ sha256, ...d }) => ({ ...d, sha256, availability: datasetAvailability().find((a) => a.id === d.id) })),
      sourceColumns: SOURCE_COLUMNS,
    }),
  );

  app.post('/api/public/forest-check', async (c) => {
    limit(c, `forest-public:${ip(c)}`, 20, 60 * 60 * 1000);
    const body = z.object({ geometry: z.unknown() }).parse(await c.req.json().catch(() => ({})));
    const report = validatePlotGeometry(body.geometry, { declaredAreaHa: 1 });
    if (!report.valid) return c.json({ report, analysis: null });
    if ((report.areaHa ?? 0) > 5_000) throw new HttpError(422, 'too_large', 'Public inspection is limited to areas of 5,000 ha or less.');
    // Only analyse against rasters that passed SHA-256 verification at startup (same rule as the job worker).
    const verified = datasetAvailability().every((d) => d.sha256 !== null && d.sha256 === DATASETS[d.id].sha256);
    if (!verified) return c.json({ report, analysis: { status: 'UNAVAILABLE', summary: 'Environmental datasets are missing or failed hash verification on this server; no conclusion is drawn.', limitations: [], hansenPixels: { total: 0, land: 0, water: 0, noData: 0 }, areaHa: { sampled: 0, jrcForest2020: 0, postCutoffLoss: 0, postCutoffLossOnJrcForest: 0, preCutoffLoss: 0 }, lossByYear: {}, coveredInterval: '', methodVersion: ANALYSIS_METHOD_VERSION, analysedAt: new Date().toISOString(), grid: null }, stored: false });
    const analysis = await analysePlot(body.geometry as never, { geometryValid: true });
    log({ event: 'public.forest_check', status: analysis.status });
    return c.json({ report, analysis, stored: false });
  });

  app.get('/api/public/demo-video', (c) => c.json(demoVideo.video));

  app.get('/api/public/verify', async (c) => c.json(await publicVerify(db, c.req.query('batchKey') ?? null)));

  app.get('/api/templates/sources.csv', (c) => {
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="lothold_sources_template.csv"');
    return c.body(blankSourcesTemplate());
  });

  // ---------------- auth ----------------
  const credentials = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });
  app.post('/api/auth/register', async (c) => {
    if (process.env.REGISTRATION_OPEN === 'false') throw new HttpError(403, 'registration_closed', 'Self-registration is disabled on this instance.');
    limit(c, `register:${ip(c)}`, Number(process.env.REGISTER_RATE_LIMIT ?? 5), 60 * 60 * 1000);
    const b = credentials.extend({ name: z.string().trim().min(1).max(200), organisation: z.string().trim().min(1).max(200) }).parse(await c.req.json());
    if (b.password.length < PASSWORD_MIN) throw new HttpError(422, 'weak_password', `Use a password of at least ${PASSWORD_MIN} characters.`);
    if (get(db, 'SELECT 1 FROM users WHERE email = ?', b.email)) throw new HttpError(409, 'email_taken', 'An account with that email already exists.');
    const orgId = id(), userId = id();
    tx(db, () => {
      run(db, 'INSERT INTO orgs (id, name, created_at) VALUES (?, ?, ?)', orgId, b.organisation, now());
      run(db, 'INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', userId, orgId, b.email, b.name, hashPassword(b.password), 'admin', now());
      audit(db, { orgId, actorId: userId, type: 'auth.registered', data: {} });
    });
    const s = createSession(db, userId);
    setCookie(c, SESSION_COOKIE, s.token, { httpOnly: true, sameSite: 'Strict', secure, path: '/', maxAge: SESSION_TTL_MS / 1000 });
    return c.json({ ok: true, csrf: s.csrf }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    limit(c, `login:${ip(c)}`, 20, 15 * 60 * 1000);
    const b = credentials.parse(await c.req.json());
    limit(c, `login-email:${b.email.toLowerCase()}`, 10, 15 * 60 * 1000);
    const u = get<{ id: string; org_id: string; password_hash: string }>(db, 'SELECT id, org_id, password_hash FROM users WHERE email = ?', b.email);
    if (!u || !verifyPassword(b.password, u.password_hash)) throw new HttpError(401, 'bad_credentials', 'Email or password is incorrect.');
    const s = createSession(db, u.id);
    audit(db, { orgId: u.org_id, actorId: u.id, type: 'auth.login', data: {} });
    setCookie(c, SESSION_COOKIE, s.token, { httpOnly: true, sameSite: 'Strict', secure, path: '/', maxAge: SESSION_TTL_MS / 1000 });
    return c.json({ ok: true, csrf: s.csrf });
  });

  app.post('/api/auth/logout', (c) => {
    const t = getCookie(c, SESSION_COOKIE);
    if (t) destroySession(db, t);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', (c) => {
    const u = c.get('user');
    if (!u) return c.json({ user: null });
    return c.json({ user: { id: u.id, email: u.email, name: u.name, organisation: u.orgName, role: u.role, chainEnabled: u.chainEnabled }, csrf: u.csrf });
  });

  // ---------------- shipments ----------------
  app.get('/api/shipments', (c) => c.json({ shipments: listShipments(db, requireUser(c)) }));

  app.post('/api/shipments', async (c) => {
    const u = requireUser(c);
    const b = z.object({ reference: z.string().max(50) }).parse(await c.req.json());
    const s = createShipment(db, u, b.reference);
    return c.json({ id: s.id }, 201);
  });

  app.get('/api/shipments/:id', (c) => {
    const u = requireUser(c);
    return c.json(buildShipmentView(db, u, c.req.param('id')));
  });

  app.patch('/api/shipments/:id/fields', async (c) => {
    const u = requireUser(c);
    const shape = Object.fromEntries(SHIPMENT_FIELDS.map((f) => [f, z.string().max(500).nullable().optional()]));
    const b = z.object(shape).strict().parse(await c.req.json());
    return c.json(setFields(db, u, c.req.param('id'), b as Record<string, string | null>));
  });

  app.post('/api/shipments/:id/uploads', async (c) => {
    const u = requireUser(c);
    limit(c, `upload:${u.id}`, 60, 60 * 60 * 1000);
    const kind = z.enum(['sources_csv', 'plots_geojson', 'document', 'review_evidence']).parse(c.req.query('kind')) as UploadKind;
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > LIMITS[kind] + 64 * 1024) throw new HttpError(413, 'too_large', `The upload exceeds the ${LIMITS[kind] / 1048576} MB limit.`);
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new HttpError(400, 'no_file', 'Choose a file to upload.');
    const bytes = Buffer.from(await file.arrayBuffer());
    const r = handleUpload(db, u, c.req.param('id'), kind, file.name, file.type, bytes);
    return c.json(r, r.duplicate ? 200 : 201);
  });

  app.get('/api/uploads/:id', (c) => {
    const u = requireUser(c);
    const up = getUpload(db, u, c.req.param('id'));
    return c.json({ id: up.id, shipmentId: up.shipment_id, kind: up.kind, filename: up.filename, sha256: up.sha256, bytes: up.bytes, parser: up.parser, parserVersion: up.parser_version, parseStatus: up.parse_status, parseError: up.parse_error, parsed: up.parsed_json ? JSON.parse(up.parsed_json) : null, uploadedAt: up.uploaded_at });
  });

  app.post('/api/uploads/:id/confirm', (c) => {
    const u = requireUser(c);
    return c.json(confirmUpload(db, u, c.req.param('id'), (type, payload, dedupe) => enqueue(db, type, payload, dedupe)));
  });

  app.post('/api/uploads/:id/download-link', (c) => {
    const u = requireUser(c);
    const up = getUpload(db, u, c.req.param('id'));
    return c.json({ url: `/api/download/${signDownload('upload', up.id, u.id)}`, expiresInSeconds: 300 });
  });

  app.get('/api/download/:token', (c) => {
    const u = requireUser(c);
    const t = verifyDownload(c.req.param('token'));
    if ('error' in t) throw new HttpError(t.error === 'expired' ? 410 : 403, `link_${t.error}`, t.error === 'expired' ? 'This download link has expired. Request a new one.' : 'Invalid download link.');
    if (t.userId !== u.id) throw new HttpError(403, 'link_user', 'This download link was issued to a different user.');
    let bytes: Buffer, filename: string, type: string;
    if (t.kind === 'upload') {
      const r = uploadBytes(db, u, t.objectId);
      bytes = r.bytes; filename = r.row.filename; type = r.row.media_type;
    } else {
      const d = get<{ shipment_id: string; filename: string; storage_key: string; kind: string }>(db, 'SELECT d.shipment_id, d.filename, d.storage_key, d.kind FROM documents d JOIN shipments s ON s.id = d.shipment_id WHERE d.id = ? AND s.org_id = ?', t.objectId, u.orgId);
      if (!d) throw new HttpError(404, 'not_found', 'Document not found.');
      bytes = readBytes(u.orgId, d.storage_key); filename = d.filename; type = d.kind === 'dds_xml' ? 'application/xml' : 'application/pdf';
    }
    audit(db, { orgId: u.orgId, actorId: u.id, type: 'download', data: { kind: t.kind, objectId: t.objectId } });
    c.header('Content-Type', type);
    c.header('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    return c.body(new Uint8Array(bytes));
  });

  app.post('/api/shipments/:id/plots/:index/swap-correction', (c) => {
    const u = requireUser(c);
    return c.json(swapAxesCorrection(db, u, c.req.param('id'), Number(c.req.param('index'))), 201);
  });

  app.post('/api/shipments/:id/reserve', (c) => {
    const u = requireUser(c);
    limit(c, `reserve:${u.id}`, 30, 60 * 60 * 1000);
    const r = reserveAllocations(db, u, c.req.param('id'));
    return c.json(r, r.ok ? 200 : 409);
  });

  app.post('/api/shipments/:id/decisions', async (c) => {
    const u = requireUser(c);
    const b = z.object({ findingKey: z.string().max(300), decision: z.enum(['investigated_not_blocking', 'keep_on_hold']), rationale: z.string().max(4000), evidenceUploadId: z.string().uuid().nullable() }).parse(await c.req.json());
    recordDecision(db, u, c.req.param('id'), b);
    return c.json({ ok: true }, 201);
  });

  app.post('/api/shipments/:id/approve', async (c) => {
    const u = requireUser(c);
    const b = z.object({ digest: z.string().length(64), note: z.string().max(1000).nullable().optional() }).parse(await c.req.json());
    return c.json(approve(db, u, c.req.param('id'), b.digest, b.note ?? null), 201);
  });

  app.post('/api/shipments/:id/documents/:kind', async (c) => {
    const u = requireUser(c);
    limit(c, `docs:${u.id}`, 60, 60 * 60 * 1000);
    const kind = z.enum(['supplier_request_pdf', 'review_draft_pdf', 'dds_xml']).parse(c.req.param('kind'));
    const doc = await generateDocument(db, u, c.req.param('id'), kind);
    return c.json({ ...doc, url: `/api/download/${signDownload('document', doc.id, u.id)}` }, 201);
  });

  app.get('/api/shipments/:id/documents', (c) => {
    const u = requireUser(c);
    return c.json({ documents: documentList(db, u, c.req.param('id')) });
  });

  app.post('/api/documents/:id/download-link', (c) => {
    const u = requireUser(c);
    const d = get(db, 'SELECT 1 FROM documents d JOIN shipments s ON s.id = d.shipment_id WHERE d.id = ? AND s.org_id = ?', c.req.param('id'), u.orgId);
    if (!d) throw new HttpError(404, 'not_found', 'Document not found.');
    return c.json({ url: `/api/download/${signDownload('document', c.req.param('id'), u.id)}`, expiresInSeconds: 300 });
  });

  app.get('/api/shipments/:id/extraction', (c) => {
    const u = requireUser(c);
    getShipment(db, u, c.req.param('id'));
    return c.json(extractionStatus(db, u, c.req.param('id')));
  });

  app.post('/api/shipments/:id/extract', async (c) => {
    const u = requireUser(c);
    limit(c, `extract:${u.orgId}`, 20, 60 * 60 * 1000);
    const b = z.object({ uploadId: z.string().uuid() }).parse(await c.req.json());
    return c.json(await runExtraction(db, u, c.req.param('id'), b.uploadId), 201);
  });

  app.post('/api/extractions/:id/accept', async (c) => {
    const u = requireUser(c);
    const b = z.object({ fields: z.array(z.enum(SHIPMENT_FIELDS)).min(1) }).parse(await c.req.json());
    return c.json(acceptExtraction(db, u, c.req.param('id'), b.fields));
  });

  app.get('/api/shipments/:id/chain', async (c) => {
    const u = requireUser(c);
    return c.json(await chainStatus(db, u, c.req.param('id')));
  });

  app.post('/api/shipments/:id/chain/anchor', (c) => {
    const u = requireUser(c);
    limit(c, `chain:${u.orgId}`, 10, 60 * 60 * 1000);
    return c.json(queueAnchoring(db, u, c.req.param('id')), 202);
  });

  app.get('/api/shipments/:id/audit', (c) => {
    const u = requireUser(c);
    getShipment(db, u, c.req.param('id'));
    const rows = all<{ seq: number; type: string; data_json: string; created_at: string; name: string | null }>(db, 'SELECT a.seq, a.type, a.data_json, a.created_at, u.name FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id WHERE a.shipment_id = ? ORDER BY a.seq DESC LIMIT 200', c.req.param('id'));
    return c.json({ events: rows.map((r) => ({ seq: r.seq, type: r.type, data: JSON.parse(r.data_json), at: r.created_at, actor: r.name })) });
  });

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404) : c.text('Not found', 404)));
  return app;
}
