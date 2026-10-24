// Business operations. Every protected function receives the acting user and scopes queries by org_id.
import { createHash } from 'node:crypto';
import { type DB, all, audit, get, id, now, run, tx } from './db.ts';
import { readBytes, sha256Hex, storeBytes, sanitizeFilename, type SessionUser } from './security.ts';
import { parsePlotsGeoJson, parseSourcesCsv, type PlotFeature, type SourceRow } from '../core/sources.ts';
import { evaluate, type EnvState, type Evaluation, type EvaluationInput, type LedgerLot, type ReviewDecision, type ShipmentFields } from '../core/rules.ts';
import { formatKg } from '../core/quantity.ts';
import { ANALYSIS_METHOD_VERSION, DATASETS } from './env/forest.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const LIMITS = {
  sources_csv: 2 * 1024 * 1024,
  plots_geojson: 25 * 1024 * 1024, // EUDR IS geolocation limit
  document: 10 * 1024 * 1024,
  review_evidence: 15 * 1024 * 1024,
} as const;
export type UploadKind = keyof typeof LIMITS;

export const SHIPMENT_FIELDS = ['activityType', 'hsCode', 'description', 'netMassValue', 'netMassUnit', 'countryOfActivity', 'operatorName', 'operatorEori'] as const;
export type ShipmentField = (typeof SHIPMENT_FIELDS)[number];

export const DATASETS_KEY = createHash('sha256')
  .update(Object.values(DATASETS).map((d) => `${d.id}:${d.sha256}`).join('|'))
  .digest('hex')
  .slice(0, 16);

// ---------- helpers ----------
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
export const geometryHash = (g: unknown) => sha256Hex(canonical(g));

type ShipmentRow = { id: string; org_id: string; reference: string; created_by: string; created_at: string };

export function getShipment(db: DB, user: SessionUser, shipmentId: string): ShipmentRow {
  const s = get<ShipmentRow>(db, 'SELECT * FROM shipments WHERE id = ? AND org_id = ?', shipmentId, user.orgId);
  // Same 404 for "missing" and "other organisation" so IDs cannot be probed.
  if (!s) throw new HttpError(404, 'not_found', 'Shipment not found.');
  return s;
}

// ---------- shipments ----------
export function createShipment(db: DB, user: SessionUser, reference: string): ShipmentRow {
  const ref = reference.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,49}$/.test(ref)) throw new HttpError(400, 'invalid_reference', 'Use 1–50 letters, digits, spaces, dot, dash, slash or underscore for the internal reference.');
  if (get(db, 'SELECT 1 FROM shipments WHERE org_id = ? AND reference = ?', user.orgId, ref)) throw new HttpError(409, 'duplicate_reference', `A shipment with reference "${ref}" already exists.`);
  const s = { id: id(), org_id: user.orgId, reference: ref, created_by: user.id, created_at: now() };
  tx(db, () => {
    run(db, 'INSERT INTO shipments (id, org_id, reference, created_by, created_at) VALUES (?, ?, ?, ?, ?)', s.id, s.org_id, s.reference, s.created_by, s.created_at);
    audit(db, { orgId: user.orgId, shipmentId: s.id, actorId: user.id, type: 'shipment.created', data: { reference: ref } });
  });
  return s;
}

export function listShipments(db: DB, user: SessionUser) {
  const rows = all<ShipmentRow>(db, 'SELECT * FROM shipments WHERE org_id = ? ORDER BY created_at DESC', user.orgId);
  return rows.map((s) => {
    const st = computeState(db, user, s.id);
    return {
      id: s.id,
      reference: s.reference,
      createdAt: s.created_at,
      goods: st.input.shipment.fields.description?.value ?? null,
      hsCode: st.input.shipment.fields.hsCode?.value ?? null,
      producerCountries: [...new Set((st.input.sources?.rows ?? []).map((r) => r.producerCountry).filter(Boolean))],
      plots: { declared: st.evaluation.counts.plotsDeclared, valid: st.evaluation.counts.plotsValid },
      overall: st.evaluation.readiness.overall,
      approval: st.approval.state,
      topReason: st.evaluation.findings.find((f) => f.severity === 'hold')?.title ?? st.evaluation.findings.find((f) => f.severity === 'review')?.title ?? null,
    };
  });
}

export function setFields(db: DB, user: SessionUser, shipmentId: string, values: Partial<Record<ShipmentField, string | null>>, source: 'manual' | 'extraction' = 'manual', extractionId: string | null = null) {
  getShipment(db, user, shipmentId);
  const changed: string[] = [];
  tx(db, () => {
    for (const [field, raw] of Object.entries(values)) {
      if (!SHIPMENT_FIELDS.includes(field as ShipmentField)) throw new HttpError(400, 'unknown_field', `Unknown field ${field}.`);
      const value = raw === null || raw === undefined ? null : String(raw).trim().slice(0, 500) || null;
      const cur = get<{ value: string | null; revision: number; source: string }>(db, 'SELECT value, revision, source FROM shipment_field_values WHERE shipment_id = ? AND field = ? ORDER BY revision DESC LIMIT 1', shipmentId, field);
      if (cur && cur.value === value && cur.source === source) continue;
      run(db, 'INSERT INTO shipment_field_values (id, shipment_id, field, value, source, extraction_id, revision, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id(), shipmentId, field, value, source, extractionId, (cur?.revision ?? 0) + 1, user.id, now());
      changed.push(field);
    }
    if (changed.length) audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'shipment.fields_changed', data: { fields: changed, source } });
  });
  return { changed };
}

function currentFields(db: DB, shipmentId: string): ShipmentFields {
  const rows = all<{ field: string; value: string | null; source: 'manual' | 'extraction'; revision: number; extraction_id: string | null }>(
    db,
    `SELECT f.field, f.value, f.source, f.revision, f.extraction_id FROM shipment_field_values f
     WHERE f.shipment_id = ? AND f.revision = (SELECT MAX(revision) FROM shipment_field_values g WHERE g.shipment_id = f.shipment_id AND g.field = f.field)`,
    shipmentId,
  );
  const out: ShipmentFields = {};
  for (const r of rows) {
    let extractionRef;
    if (r.extraction_id) {
      const e = get<{ upload_id: string; filename: string }>(db, 'SELECT e.upload_id, u.filename FROM extractions e JOIN uploads u ON u.id = e.upload_id WHERE e.id = ?', r.extraction_id);
      if (e) extractionRef = { uploadId: e.upload_id, filename: e.filename };
    }
    (out as Record<string, unknown>)[r.field] = { value: r.value, source: r.source, revision: r.revision, extractionRef };
  }
  return out;
}

// ---------- uploads ----------
const MEDIA: Record<UploadKind, { ext: RegExp; types: string[] }> = {
  sources_csv: { ext: /\.csv$/i, types: ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream', ''] },
  plots_geojson: { ext: /\.(geo)?json$/i, types: ['application/geo+json', 'application/json', 'application/octet-stream', 'text/plain', ''] },
  document: { ext: /\.(pdf|txt)$/i, types: ['application/pdf', 'text/plain', 'application/octet-stream', ''] },
  review_evidence: { ext: /\.(pdf|png|jpe?g|txt|csv|geojson|json)$/i, types: [] },
};

function decodeUtf8Strict(bytes: Buffer, what: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(422, 'encoding', `${what} is not valid UTF-8 text. Export it as UTF-8 (e.g. "CSV UTF-8" in a spreadsheet program).`);
  }
}

export type UploadResult = { uploadId: string; duplicate: boolean; parseStatus: 'parsed' | 'rejected' | 'stored'; error: string | null };

export function handleUpload(db: DB, user: SessionUser, shipmentId: string, kind: UploadKind, filename: string, mediaType: string, bytes: Buffer): UploadResult {
  getShipment(db, user, shipmentId);
  const name = sanitizeFilename(filename);
  if (bytes.length === 0) throw new HttpError(422, 'empty', 'The file is empty.');
  if (bytes.length > LIMITS[kind]) throw new HttpError(413, 'too_large', `The file is ${(bytes.length / 1048576).toFixed(1)} MB; the limit for this upload is ${LIMITS[kind] / 1048576} MB.`);
  if (!MEDIA[kind].ext.test(name)) throw new HttpError(415, 'type', `"${name}" does not have an accepted extension for this upload.`);
  if (MEDIA[kind].types.length && !MEDIA[kind].types.includes(mediaType.split(';')[0]!.trim().toLowerCase())) throw new HttpError(415, 'type', `Media type "${mediaType}" is not accepted for this upload.`);
  const isPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  if (/\.pdf$/i.test(name) && !isPdf) throw new HttpError(415, 'type', 'The file is named .pdf but is not a PDF.');
  if (/\.(png)$/i.test(name) && bytes.readUInt32BE(0) !== 0x89504e47) throw new HttpError(415, 'type', 'The file is named .png but is not a PNG image.');
  if (/\.(jpe?g)$/i.test(name) && !(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new HttpError(415, 'type', 'The file is named .jpg but is not a JPEG image.');

  const sha = sha256Hex(bytes);
  const existing = get<{ id: string; parse_status: UploadResult['parseStatus']; parse_error: string | null }>(db, 'SELECT id, parse_status, parse_error FROM uploads WHERE shipment_id = ? AND kind = ? AND sha256 = ?', shipmentId, kind, sha);
  if (existing) return { uploadId: existing.id, duplicate: true, parseStatus: existing.parse_status, error: existing.parse_error };

  let parser: string | null = null, parserVersion: string | null = null, status: UploadResult['parseStatus'] = 'stored', error: string | null = null, parsed: unknown = null;
  if (kind === 'sources_csv') {
    const r = parseSourcesCsv(decodeUtf8Strict(bytes, 'The CSV'));
    parser = 'deterministic-csv'; parserVersion = r.parserVersion;
    if (r.ok) { status = 'parsed'; parsed = r; } else { status = 'rejected'; error = r.error; }
  } else if (kind === 'plots_geojson') {
    const r = parsePlotsGeoJson(decodeUtf8Strict(bytes, 'The GeoJSON'));
    parser = 'deterministic-geojson'; parserVersion = r.parserVersion;
    if (r.ok) { status = 'parsed'; parsed = r; } else { status = 'rejected'; error = r.error; }
  }
  const uploadId = id();
  const storageKey = storeBytes(user.orgId, bytes);
  tx(db, () => {
    run(
      db,
      `INSERT INTO uploads (id, org_id, shipment_id, kind, filename, sha256, bytes, media_type, storage_key, parser, parser_version, parse_status, parse_error, parsed_json, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uploadId, user.orgId, shipmentId, kind, name, sha, bytes.length, isPdf ? 'application/pdf' : mediaType || 'application/octet-stream', storageKey, parser, parserVersion, status, error, parsed ? JSON.stringify(parsed) : null, user.id, now(),
    );
    audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'upload.received', data: { uploadId, kind, filename: name, sha256: sha, bytes: bytes.length, parser, parserVersion, status, error } });
  });
  return { uploadId, duplicate: false, parseStatus: status, error };
}

type UploadRow = { id: string; org_id: string; shipment_id: string; kind: UploadKind; filename: string; sha256: string; bytes: number; media_type: string; storage_key: string; parser: string | null; parser_version: string | null; parse_status: string; parse_error: string | null; parsed_json: string | null; uploaded_by: string; uploaded_at: string };

export function getUpload(db: DB, user: SessionUser, uploadId: string): UploadRow {
  const u = get<UploadRow>(db, 'SELECT * FROM uploads WHERE id = ? AND org_id = ?', uploadId, user.orgId);
  if (!u) throw new HttpError(404, 'not_found', 'Upload not found.');
  return u;
}

export function uploadBytes(db: DB, user: SessionUser, uploadId: string): { row: UploadRow; bytes: Buffer } {
  const row = getUpload(db, user, uploadId);
  return { row, bytes: readBytes(user.orgId, row.storage_key) };
}

function activeUpload(db: DB, shipmentId: string, kind: 'sources_csv' | 'plots_geojson'): UploadRow | null {
  return (
    get<UploadRow>(db, `SELECT u.* FROM confirmations c JOIN uploads u ON u.id = c.upload_id WHERE c.shipment_id = ? AND c.kind = ? ORDER BY c.seq DESC LIMIT 1`, shipmentId, kind) ?? null
  );
}

export function confirmUpload(db: DB, user: SessionUser, uploadId: string, enqueue: (type: string, payload: unknown, dedupe: string) => void) {
  const u = getUpload(db, user, uploadId);
  if (u.kind !== 'sources_csv' && u.kind !== 'plots_geojson') throw new HttpError(400, 'not_confirmable', 'Only source tables and plot files are confirmed.');
  if (u.parse_status !== 'parsed') throw new HttpError(409, 'rejected_upload', 'This file was rejected by the parser and cannot be confirmed. Fix the file and upload it again.');
  const current = activeUpload(db, u.shipment_id, u.kind);
  if (current?.id === u.id) return { alreadyActive: true };
  tx(db, () => {
    const seq = (get<{ s: number | null }>(db, 'SELECT MAX(seq) AS s FROM confirmations WHERE shipment_id = ? AND kind = ?', u.shipment_id, u.kind)?.s ?? 0) + 1;
    run(db, 'INSERT INTO confirmations (id, shipment_id, kind, upload_id, confirmed_by, confirmed_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)', id(), u.shipment_id, u.kind, u.id, user.id, now(), seq);
    if (u.kind === 'sources_csv') {
      // Register first-declared totals; never overwrite an existing declared total.
      const parsed = JSON.parse(u.parsed_json!) as { rows: SourceRow[] };
      for (const r of parsed.rows) {
        if (!r.supplierId || !r.sourceLotRef || !r.declaredQuantity.ok) continue;
        const exists = get(db, 'SELECT 1 FROM source_lots WHERE org_id = ? AND supplier_id = ? AND source_lot_ref = ?', user.orgId, r.supplierId, r.sourceLotRef);
        if (!exists) run(db, 'INSERT INTO source_lots (id, org_id, supplier_id, source_lot_ref, declared_grams, first_upload_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id(), user.orgId, r.supplierId, r.sourceLotRef, r.declaredQuantity.grams, u.id, now());
      }
      // Reservations made against a superseded source table are released.
      const released = run(db, `UPDATE allocations SET status = 'released', released_at = ? WHERE shipment_id = ? AND status = 'reserved' AND sources_upload_id <> ?`, now(), u.shipment_id, u.id);
      if (Number(released.changes) > 0) audit(db, { orgId: user.orgId, shipmentId: u.shipment_id, actorId: user.id, type: 'allocations.released_on_revision', data: { count: Number(released.changes), supersededBy: u.id } });
    }
    audit(db, { orgId: user.orgId, shipmentId: u.shipment_id, actorId: user.id, type: 'upload.confirmed', data: { uploadId: u.id, kind: u.kind, supersedes: current?.id ?? null, seq } });
  });
  if (u.kind === 'plots_geojson') {
    const parsed = JSON.parse(u.parsed_json!) as { features: PlotFeature[] };
    for (const f of parsed.features) {
      if (!f.report.valid || !f.geometry) continue;
      const gh = geometryHash(f.geometry);
      const done = get(db, 'SELECT 1 FROM env_results WHERE geometry_hash = ? AND method_version = ? AND datasets_key = ?', gh, ANALYSIS_METHOD_VERSION, DATASETS_KEY);
      if (!done) enqueue('forest_analysis', { geometryHash: gh, geometry: f.geometry }, `forest:${gh}:${ANALYSIS_METHOD_VERSION}:${DATASETS_KEY}`);
    }
  }
  return { alreadyActive: false };
}

// ---------- state ----------
function envStateFor(db: DB, geometry: unknown): EnvState {
  const gh = geometryHash(geometry);
  const r = get<{ id: string; status: string; result_json: string }>(db, 'SELECT id, status, result_json FROM env_results WHERE geometry_hash = ? AND method_version = ? AND datasets_key = ?', gh, ANALYSIS_METHOD_VERSION, DATASETS_KEY);
  if (r) {
    const res = JSON.parse(r.result_json) as { summary: string; areaHa: { postCutoffLoss: number }; firstPostCutoffLossYear: number | null; latestPostCutoffLossYear: number | null };
    const years = res.firstPostCutoffLossYear ? (res.firstPostCutoffLossYear === res.latestPostCutoffLossYear ? String(res.firstPostCutoffLossYear) : `${res.firstPostCutoffLossYear}–${res.latestPostCutoffLossYear}`) : null;
    return { state: 'done', status: r.status as never, summary: res.summary, resultId: r.id, geometryHash: gh, postCutoffLossHa: res.areaHa.postCutoffLoss, years };
  }
  const j = get<{ status: string; last_error: string | null }>(db, 'SELECT status, last_error FROM jobs WHERE dedupe_key = ?', `forest:${gh}:${ANALYSIS_METHOD_VERSION}:${DATASETS_KEY}`);
  if (!j) return { state: 'not_started' };
  if (j.status === 'failed') return { state: 'failed', error: j.last_error ?? 'unknown error' };
  return { state: 'queued' };
}

export type ShipmentState = {
  shipment: ShipmentRow;
  input: EvaluationInput;
  evaluation: Evaluation;
  digest: string;
  snapshot: unknown;
  approval: { state: 'none' | 'current' | 'stale'; approvedAt?: string; approvedBy?: string; digest?: string; note?: string | null };
  sourcesUpload: UploadRow | null;
  plotsUpload: UploadRow | null;
};

export function computeState(db: DB, user: SessionUser, shipmentId: string): ShipmentState {
  const shipment = getShipment(db, user, shipmentId);
  const sourcesUpload = activeUpload(db, shipmentId, 'sources_csv');
  const plotsUpload = activeUpload(db, shipmentId, 'plots_geojson');
  const sources = sourcesUpload ? { uploadId: sourcesUpload.id, filename: sourcesUpload.filename, sha256: sourcesUpload.sha256, rows: (JSON.parse(sourcesUpload.parsed_json!) as { rows: SourceRow[] }).rows } : null;
  const plots = plotsUpload ? { uploadId: plotsUpload.id, filename: plotsUpload.filename, sha256: plotsUpload.sha256, features: (JSON.parse(plotsUpload.parsed_json!) as { features: PlotFeature[] }).features } : null;
  const env: Record<string, EnvState> = {};
  for (const f of plots?.features ?? []) if (f.plotRef && f.report.valid && f.geometry) env[f.plotRef] = envStateFor(db, f.geometry);

  const ledger: Record<string, LedgerLot> = {};
  for (const r of sources?.rows ?? []) {
    if (!r.supplierId || !r.sourceLotRef) continue;
    const k = `${r.supplierId}::${r.sourceLotRef}`;
    if (ledger[k]) continue;
    const lot = get<{ id: string; declared_grams: number; first_upload_id: string }>(db, 'SELECT id, declared_grams, first_upload_id FROM source_lots WHERE org_id = ? AND supplier_id = ? AND source_lot_ref = ?', user.orgId, r.supplierId, r.sourceLotRef);
    const others = lot ? get<{ g: number | null }>(db, `SELECT SUM(grams) AS g FROM allocations WHERE source_lot_id = ? AND status = 'reserved' AND shipment_id <> ?`, lot.id, shipmentId)!.g ?? 0 : 0;
    const here = lot && sourcesUpload ? get<{ g: number | null }>(db, `SELECT SUM(grams) AS g FROM allocations WHERE source_lot_id = ? AND status = 'reserved' AND shipment_id = ? AND sources_upload_id = ?`, lot.id, shipmentId, sourcesUpload.id)!.g ?? 0 : 0;
    ledger[k] = { sourceLotKey: k, registeredDeclaredGrams: lot?.declared_grams ?? null, registeredFromUpload: lot?.first_upload_id ?? null, reservedByOtherShipmentsGrams: others, reservedByThisShipmentGrams: here };
  }
  const decisions = all<{ finding_key: string; decision: ReviewDecision['decision']; rationale: string; evidence_upload_id: string | null; name: string; created_at: string; id: string }>(
    db,
    'SELECT d.id, d.finding_key, d.decision, d.rationale, d.evidence_upload_id, u.name, d.created_at FROM review_decisions d JOIN users u ON u.id = d.reviewer_id WHERE d.shipment_id = ? ORDER BY d.created_at, d.rowid',
    shipmentId,
  );
  // A decision is only valid for the environmental result it was made against.
  const validDecisions: ReviewDecision[] = [];
  for (const d of decisions) {
    const ref = d.finding_key.startsWith('ENV:') ? d.finding_key.slice(4) : null;
    const meta = get<{ snapshot_digest: string }>(db, 'SELECT snapshot_digest FROM review_decisions WHERE id = ?', d.id)!;
    const envNow = ref ? env[ref] : undefined;
    const bound = meta.snapshot_digest; // stores env result id for ENV decisions
    if (ref && (!envNow || envNow.state !== 'done' || envNow.resultId !== bound)) continue;
    validDecisions.push({ findingKey: d.finding_key, decision: d.decision, rationale: d.rationale, evidenceUploadId: d.evidence_upload_id, reviewerName: d.name, createdAt: d.created_at });
  }
  const input: EvaluationInput = { shipment: { id: shipment.id, reference: shipment.reference, fields: currentFields(db, shipmentId) }, sources, plots, env, ledger, decisions: validDecisions };
  const evaluation = evaluate(input);
  const snapshot = {
    rulesVersion: evaluation.rulesVersion,
    analysisMethod: ANALYSIS_METHOD_VERSION,
    datasetsKey: DATASETS_KEY,
    shipment: { id: shipment.id, reference: shipment.reference },
    fields: Object.fromEntries(Object.entries(input.shipment.fields).map(([k, v]) => [k, { value: v?.value ?? null, revision: v?.revision ?? 0, source: v?.source }])),
    sources: sources ? { uploadId: sources.uploadId, sha256: sources.sha256 } : null,
    plots: plots ? { uploadId: plots.uploadId, sha256: plots.sha256 } : null,
    environment: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.state === 'done' ? { resultId: v.resultId, status: v.status } : { state: v.state }])),
    allocations: Object.fromEntries(Object.entries(ledger).map(([k, v]) => [k, { declaredGrams: v.registeredDeclaredGrams, reservedHereGrams: v.reservedByThisShipmentGrams }])),
    decisions: validDecisions.map((d) => ({ k: d.findingKey, d: d.decision, e: d.evidenceUploadId, r: sha256Hex(d.rationale), t: d.createdAt })),
    findings: evaluation.findings.map((f) => `${f.key}|${f.severity}`).sort(),
    overall: evaluation.readiness.overall,
  };
  const digest = sha256Hex(canonical(snapshot));
  const appr = get<{ snapshot_digest: string; created_at: string; name: string; note: string | null }>(db, 'SELECT a.snapshot_digest, a.created_at, u.name, a.note FROM approvals a JOIN users u ON u.id = a.approved_by WHERE a.shipment_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1', shipmentId);
  const approval: ShipmentState['approval'] = !appr ? { state: 'none' } : { state: appr.snapshot_digest === digest ? 'current' : 'stale', approvedAt: appr.created_at, approvedBy: appr.name, digest: appr.snapshot_digest, note: appr.note };
  return { shipment, input, evaluation, digest, snapshot, approval, sourcesUpload, plotsUpload };
}

// ---------- allocation ledger ----------
export function reserveAllocations(db: DB, user: SessionUser, shipmentId: string) {
  return tx(db, () => {
    // Recompute inside the write lock so concurrent requests see each other's reservations.
    const st = computeState(db, user, shipmentId);
    if (!st.sourcesUpload) throw new HttpError(409, 'no_sources', 'Confirm a source table before reserving allocations.');
    const conflicts = st.evaluation.findings.filter((f) => f.dimension === 'allocation' && f.severity === 'hold');
    if (conflicts.length) {
      audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'allocations.reserve_rejected', data: { reasons: conflicts.map((c) => c.key) } });
      return { ok: false as const, rejected: conflicts.map((c) => ({ key: c.key, title: c.title, message: c.message })) };
    }
    const created: string[] = [];
    for (const a of st.evaluation.allocationSummary) {
      const lot = get<{ id: string }>(db, 'SELECT id FROM source_lots WHERE org_id = ? AND supplier_id = ? AND source_lot_ref = ?', user.orgId, a.supplierId, a.sourceLotRef);
      if (!lot) throw new HttpError(409, 'lot_missing', `Source lot ${a.sourceLotRef} is not registered.`);
      const key = sha256Hex(`${shipmentId}|${lot.id}|${st.sourcesUpload.id}`);
      if (get(db, 'SELECT 1 FROM allocations WHERE idempotency_key = ?', key)) continue; // retry: already reserved
      run(db, `INSERT INTO allocations (id, org_id, shipment_id, source_lot_id, grams, sources_upload_id, idempotency_key, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`, id(), user.orgId, shipmentId, lot.id, a.requestedGrams, st.sourcesUpload.id, key, user.id, now());
      created.push(`${a.sourceLotRef}: ${formatKg(a.requestedGrams)}`);
    }
    audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: created.length ? 'allocations.reserved' : 'allocations.reserve_idempotent', data: { created } });
    return { ok: true as const, created };
  });
}

// ---------- review ----------
export const MIN_RATIONALE = 40;

export function recordDecision(db: DB, user: SessionUser, shipmentId: string, body: { findingKey: string; decision: ReviewDecision['decision']; rationale: string; evidenceUploadId: string | null }) {
  const st = computeState(db, user, shipmentId);
  const finding = st.evaluation.findings.find((f) => f.key === body.findingKey);
  if (!finding) throw new HttpError(404, 'finding_not_found', 'That finding no longer exists for the current evidence.');
  if (!finding.resolvableByReview) throw new HttpError(409, 'not_reviewable', 'This finding can only be resolved by correcting the source data.');
  const rationale = (body.rationale ?? '').trim();
  if (body.decision === 'investigated_not_blocking') {
    if (rationale.length < MIN_RATIONALE) throw new HttpError(422, 'rationale', `Explain the investigation in at least ${MIN_RATIONALE} characters.`);
    if (!body.evidenceUploadId) throw new HttpError(422, 'evidence_required', 'Attach the supporting evidence you relied on (for example a supplier land-use record or field report).');
  } else if (rationale.length < 10) throw new HttpError(422, 'rationale', 'Give a short reason for keeping this on hold.');
  if (body.evidenceUploadId) {
    const ev = getUpload(db, user, body.evidenceUploadId);
    if (ev.shipment_id !== shipmentId || ev.kind !== 'review_evidence') throw new HttpError(422, 'evidence_invalid', 'Evidence must be uploaded to this shipment as review evidence.');
  }
  const ref = finding.key.slice(4);
  const env = st.input.env[ref];
  const boundTo = env && env.state === 'done' ? env.resultId : st.digest;
  tx(db, () => {
    run(db, 'INSERT INTO review_decisions (id, shipment_id, finding_key, decision, rationale, evidence_upload_id, reviewer_id, snapshot_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id(), shipmentId, finding.key, body.decision, rationale, body.evidenceUploadId, user.id, boundTo, now());
    audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'review.decision', data: { findingKey: finding.key, decision: body.decision, evidenceUploadId: body.evidenceUploadId } });
  });
}

export function approve(db: DB, user: SessionUser, shipmentId: string, expectedDigest: string, note: string | null) {
  return tx(db, () => {
    const st = computeState(db, user, shipmentId);
    if (st.digest !== expectedDigest) throw new HttpError(409, 'stale_snapshot', 'The evidence changed since you opened this review. Reload and review the current snapshot.');
    if (st.evaluation.readiness.overall !== 'READY_FOR_SIGN_OFF') throw new HttpError(409, 'not_ready', 'Sign-off is only possible when no holds or unreviewed items remain.');
    run(db, 'INSERT INTO approvals (id, shipment_id, snapshot_digest, snapshot_json, approved_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id(), shipmentId, st.digest, canonical(st.snapshot), user.id, note?.slice(0, 1000) ?? null, now());
    audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'review.approved', data: { digest: st.digest } });
    return { digest: st.digest };
  });
}
