// Generated outputs. Each document records the snapshot digest it was built from; when the shipment's
// current digest differs the document is shown as stale. Already-downloaded copies cannot be recalled.
import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { type DB, all, audit, get, id, now, run } from './db.ts';
import { sha256Hex, storeBytes, type SessionUser } from './security.ts';
import { HttpError, computeState, type ShipmentState } from './service.ts';
import { DATASETS } from './env/forest.ts';
import { buildSubmitDdsRequest, validateDdsXml, SCHEMA_ID } from './dds/xml.ts';
import { parseQuantity, formatKg } from '../core/quantity.ts';
import type { Finding, SourceRef } from '../core/rules.ts';

const require = createRequire(import.meta.url);
const fontPath = (pkg: string, file: string) => require.resolve(`@fontsource/${pkg}/files/${file}`);
const FONTS = {
  regular: fontPath('ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff'),
  medium: fontPath('ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff'),
  bold: fontPath('ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff'),
};

// Plex "latin" subset lacks some symbols; map them to safe equivalents so nothing renders as a missing glyph.
const SUBST: Record<string, string> = { '≈': '~', '−': '-', ' ': ' ', '→': '->', '…': '...', '“': '"', '”': '"', '’': "'", '‘': "'", '×': 'x', '°': ' deg' };
function safe(doc: PDFKit.PDFDocument, s: string): string {
  const f = (doc as unknown as { _font?: { font?: { hasGlyphForCodePoint?: (c: number) => boolean } } })._font?.font;
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // Embedded fonts: check the glyph table. Built-in (WinAnsi) fonts: only Latin-1 is encodable.
    const missing = f?.hasGlyphForCodePoint ? !f.hasGlyphForCodePoint(cp) : cp > 0xff;
    out += missing ? SUBST[ch] ?? '?' : ch;
  }
  return out;
}

export function refLabel(r: SourceRef): string {
  if (r.kind === 'sources_csv') return `${r.filename ?? 'source table'}${r.row ? `, row ${r.row}` : ''}${r.column ? `, column ${r.column}` : ''}`;
  if (r.kind === 'plots_geojson') return `${r.filename ?? 'plot file'}${r.featureIndex !== undefined ? `, feature ${r.featureIndex + 1}` : ''}${r.plotRef ? ` (${r.plotRef})` : ''}`;
  if (r.kind === 'shipment_field') return `shipment field "${r.field}"${r.filename ? ` from ${r.filename}` : ''}`;
  if (r.kind === 'environment') return `environmental analysis for plot ${r.plotRef}`;
  return 'allocation ledger';
}

const INK = '#1D2924', MUTED = '#4F5A53', RULE = '#9AA39C';

function newDoc(title: string) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 42, bottom: 40, left: 46, right: 46 }, info: { Title: title, Creator: 'LotHold', Producer: 'LotHold (pdfkit)' }, bufferPages: true });
  doc.registerFont('r', FONTS.regular);
  doc.registerFont('m', FONTS.medium);
  doc.registerFont('b', FONTS.bold);
  // Monospace uses the built-in Courier: the Plex Mono builds crash fontkit's layout on some glyph sequences.
  doc.registerFont('mono', 'Courier');
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  return { doc, done };
}

function text(doc: PDFKit.PDFDocument, font: 'r' | 'm' | 'b' | 'mono', size: number, s: string, opts: PDFKit.Mixins.TextOptions & { color?: string } = {}) {
  doc.font(font).fontSize(size).fillColor(opts.color ?? INK);
  doc.text(safe(doc, s), opts);
}
function rule(doc: PDFKit.PDFDocument, gap = 6) {
  doc.moveDown(0.2);
  const y = doc.y + gap / 2;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.6).strokeColor(RULE).stroke();
  doc.y = y + gap / 2;
}
function kv(doc: PDFKit.PDFDocument, pairs: [string, string][], colW = 118) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (const [k, v] of pairs) {
    const y = doc.y;
    text(doc, 'm', 8.5, k, { width: colW - 8, color: MUTED });
    const h1 = doc.y - y;
    doc.y = y;
    doc.x = x + colW;
    text(doc, 'r', 9, v, { width: w - colW });
    doc.x = x;
    doc.y = Math.max(doc.y, y + h1) + 1;
  }
}

const ENV_LABEL: Record<string, string> = {
  NOT_STARTED: 'not started (no analysable plot yet)',
  IN_PROGRESS: 'analysis in progress; no conclusion yet',
  UNAVAILABLE: 'no usable observation for at least one plot; not a clear result',
  NEEDS_REVIEW: 'land-change signal after 2020 needs investigation',
  REVIEWED_WITH_EVIDENCE: 'signals investigated by reviewer with supporting evidence',
  NO_POST_2020_LOSS_OBSERVED: 'no post-2020 annual loss observed in covered plots (not proof of deforestation-free status)',
  BLOCKED_BY_GEOMETRY: 'blocked: at least one plot geometry is invalid',
};
const OVERALL_LABEL: Record<string, string> = { HOLD: 'HOLD', NEEDS_HUMAN_REVIEW: 'NEEDS HUMAN REVIEW', READY_FOR_SIGN_OFF: 'READY FOR REVIEWER SIGN-OFF' };

function statusLine(st: ShipmentState): string {
  const base = OVERALL_LABEL[st.evaluation.readiness.overall] ?? st.evaluation.readiness.overall;
  if (st.approval.state === 'current') return `REVIEWED DRAFT (signed off by ${st.approval.approvedBy}, ${st.approval.approvedAt!.replace('T', ' ').slice(0, 16)} UTC)`;
  return base;
}

// ---------------- supplier evidence request (one page) ----------------
export async function supplierRequestPdf(st: ShipmentState, issuer: SessionUser): Promise<{ bytes: Buffer; pages: number; itemsListed: number; itemsOmitted: number }> {
  const { doc, done } = newDoc(`Shipment evidence request ${st.shipment.reference}`);
  const generated = now();
  const items = st.evaluation.findings.filter((f) => f.supplierActionable && f.severity !== 'warning' && f.requestedAction);
  const env = items.filter((f) => f.dimension === 'environment');
  const other = items.filter((f) => f.dimension !== 'environment');

  text(doc, 'b', 15, 'Shipment evidence request', { continued: false });
  text(doc, 'm', 10, 'NOT a regulatory determination', { color: MUTED });
  doc.moveDown(0.4);
  kv(doc, [
    ['Case reference', `${st.shipment.reference}   (LotHold case ${st.shipment.id.slice(0, 8)})`],
    ['Status', statusLine(st)],
    ['Environmental review', ENV_LABEL[st.evaluation.readiness.environment] ?? st.evaluation.readiness.environment],
    ['Issued by', `${issuer.name}, ${issuer.orgName}`],
    ['Generated', `${generated.replace('T', ' ').slice(0, 19)} UTC`],
    ['Evidence snapshot', st.digest.slice(0, 16)],
  ]);
  rule(doc);
  text(doc, 'b', 10.5, items.length ? `Please provide the following (${items.length} item${items.length === 1 ? '' : 's'})` : 'No supplier action is currently requested');
  const resolved = st.evaluation.findings.filter((f) => f.reviewedWithEvidence);
  if (resolved.length) text(doc, 'r', 8.6, `Already investigated by the reviewer with supporting evidence (no action requested): ${resolved.map((f) => f.title).join('; ')}.`, { color: MUTED });
  doc.moveDown(0.3);

  // One-page contract: measure each item (and the fixed closing sections) before drawing, so long identifiers or
  // text can never push the document onto a second page. Supplier-facing text is capped; the review draft keeps
  // the full wording.
  const fullW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const w = fullW - 16;
  const cap = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const measure = (font: 'r' | 'm' | 'b' | 'mono', size: number, t: string, width: number) => doc.font(font).fontSize(size).heightOfString(safe(doc, t), { width });
  const aboutText = `These come from published satellite-derived datasets: annual tree-cover loss (${DATASETS.hansen_lossyear.credit}, ${DATASETS.hansen_lossyear.version}, ${DATASETS.hansen_lossyear.resolutionLabel}, loss years 2001–2025) compared with the ${DATASETS.jrc_gfc2020.title} (${DATASETS.jrc_gfc2020.version}). A recorded loss can reflect clearing, fire, replanting, plantation rotation or map error. It is a reason to ask for evidence, not a finding that deforestation occurred or that any law was broken.`;
  const limitationsText = 'This request is generated from records supplied to the reviewer and has not been sent to any authority. A valid plot boundary does not establish land rights; a satellite observation does not establish legality; a shared-ledger reservation does not prove physical origin. Missing values are shown as missing.';
  const creditsText = `Data credits: Hansen/UMD/Google/USGS/NASA (CC BY 4.0), https://glad.earthengine.app/view/global-forest-change; European Commission Joint Research Centre, GFC2020 V4, https://forobs.jrc.ec.europa.eu/GFC. Rules ${st.evaluation.rulesVersion}.`;
  const tail = (env.length ? 24 + measure('b', 9.5, 'About', fullW) + measure('r', 8.2, aboutText, fullW) : 0) + 24 + measure('b', 8.8, 'Limitations', fullW) + measure('r', 7.8, limitationsText, fullW) + 8 + measure('r', 7, creditsText, fullW) + 16 /* omitted-items line */;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - tail;
  let listed = 0;
  const all = [...other, ...env];
  for (const [i, f] of all.entries()) {
    const title = cap(f.title, 160);
    const action = cap(f.requestedAction!, 420);
    const refs = f.refs.filter((r) => r.kind !== 'environment').map(refLabel);
    const refLine = refs.length ? cap(`Source: ${refs.slice(0, 3).join('; ')}${refs.length > 3 ? `; +${refs.length - 3} more` : ''}`, 260) : null;
    const valueLine = f.original !== undefined && f.original !== '' ? `Value as received: "${f.original.slice(0, 110)}"` : null;
    const blockH = measure('m', 9.2, title, w) + measure('r', 8.8, action, w) + (refLine ? measure('r', 8, refLine, w) : 0) + (valueLine ? measure('mono', 7.6, valueLine, w) : 0) + 6;
    if (doc.y + blockH > bottomLimit) break;
    const startY = doc.y;
    text(doc, 'b', 9, `${i + 1}.`, { width: 16 });
    doc.y = startY;
    doc.x = doc.page.margins.left + 16;
    text(doc, 'm', 9.2, title, { width: w });
    text(doc, 'r', 8.8, action, { width: w });
    if (refLine) text(doc, 'r', 8, refLine, { width: w, color: MUTED });
    if (valueLine) text(doc, 'mono', 7.6, valueLine, { width: w, color: MUTED });
    doc.x = doc.page.margins.left;
    doc.moveDown(0.35);
    listed++;
  }
  const omitted = all.length - listed;
  if (omitted > 0) text(doc, 'm', 8.8, `${omitted} further item${omitted === 1 ? ' is' : 's are'} listed in the LotHold review draft for case ${st.shipment.reference}.`, { color: MUTED });

  if (env.length) {
    rule(doc);
    text(doc, 'b', 9.5, 'About the land-change observations');
    text(doc, 'r', 8.2, aboutText, { color: INK });
  }
  rule(doc);
  text(doc, 'b', 8.8, 'Limitations');
  text(doc, 'r', 7.8, limitationsText, { color: MUTED });
  doc.moveDown(0.3);
  text(doc, 'r', 7, creditsText, { color: MUTED });

  const pages = doc.bufferedPageRange().count;
  doc.end();
  return { bytes: await done, pages, itemsListed: listed, itemsOmitted: omitted };
}

// ---------------- human-readable review draft ----------------
export async function reviewDraftPdf(st: ShipmentState, issuer: SessionUser, decisions: { finding_key: string; decision: string; rationale: string; name: string; created_at: string; evidence: string | null }[]): Promise<{ bytes: Buffer; pages: number }> {
  const { doc, done } = newDoc(`Review draft ${st.shipment.reference} — DRAFT NOT SUBMITTED`);
  const f = st.input.shipment.fields;
  const v = (k: keyof typeof f) => f[k]?.value ?? 'MISSING';
  const prov = (k: keyof typeof f) => (f[k] ? `${f[k]!.source === 'extraction' ? `confirmed from extraction${f[k]!.extractionRef ? ` of ${f[k]!.extractionRef!.filename}` : ''}` : 'entered manually'}, revision ${f[k]!.revision}` : 'not provided');
  text(doc, 'b', 15, 'Due-diligence review draft');
  text(doc, 'm', 10, 'DRAFT — NOT SUBMITTED. Not an official Due Diligence Statement.', { color: MUTED });
  doc.moveDown(0.4);
  kv(doc, [
    ['Case reference', `${st.shipment.reference} (LotHold case ${st.shipment.id.slice(0, 8)})`],
    ['Status', statusLine(st)],
    ['Record completeness', st.evaluation.readiness.record],
    ['Environmental review', st.evaluation.readiness.environment],
    ['Allocation', st.evaluation.readiness.allocation],
    ['Prepared by', `${issuer.name}, ${issuer.orgName}`],
    ['Generated', `${now().replace('T', ' ').slice(0, 19)} UTC`],
    ['Snapshot digest', st.digest],
    ['Official reference number', 'None — assigned only by the EU Information System after an authorised submission.'],
  ]);
  rule(doc);
  text(doc, 'b', 11, 'Statement fields and provenance');
  doc.moveDown(0.2);
  const mass = f.netMassValue?.value ? parseQuantity(f.netMassValue.value, f.netMassUnit?.value ?? 'kg') : null;
  kv(doc, [
    ['Activity type', `${v('activityType')}  ·  ${prov('activityType')}`],
    ['Operator', `${v('operatorName')}  ·  EORI ${f.operatorEori?.value ?? 'not recorded'}  ·  ${prov('operatorName')}`],
    ['Country of activity', `${f.countryOfActivity?.value ?? 'not recorded'}  ·  ${prov('countryOfActivity')}`],
    ['HS heading', `${v('hsCode')}  ·  ${prov('hsCode')}`],
    ['Description', `${v('description')}  ·  ${prov('description')}`],
    ['Net mass', mass ? (mass.ok ? `${formatKg(mass.grams)} (as entered: ${mass.original} ${mass.unit}; ${mass.conversion})` : `INVALID: ${mass.message}`) : 'MISSING'],
  ]);
  rule(doc);
  text(doc, 'b', 11, `Source rows (${st.input.sources?.filename ?? 'no confirmed source table'})`);
  if (st.input.sources) text(doc, 'mono', 7.5, `sha256 ${st.input.sources.sha256}`, { color: MUTED });
  doc.moveDown(0.2);
  for (const r of st.input.sources?.rows ?? []) {
    text(doc, 'r', 8.6, `Row ${r.row}: supplier ${r.supplierId ?? 'MISSING'} · lot ${r.sourceLotRef ?? 'MISSING'} · declared ${r.declaredQuantity.ok ? formatKg(r.declaredQuantity.grams) : `INVALID (${r.declaredQuantity.original || 'empty'})`} · allocated ${r.allocatedQuantity.ok ? formatKg(r.allocatedQuantity.grams) : `INVALID (${r.allocatedQuantity.original || 'empty'})`} · ${r.producerCountry ?? 'country MISSING'} · plots ${r.plotRefs.join(', ') || 'MISSING'}`);
  }
  rule(doc);
  text(doc, 'b', 11, `Plots and environmental evidence (${st.input.plots?.filename ?? 'no confirmed plot file'})`);
  if (st.input.plots) text(doc, 'mono', 7.5, `sha256 ${st.input.plots.sha256}`, { color: MUTED });
  doc.moveDown(0.2);
  for (const ft of st.input.plots?.features ?? []) {
    const e = ft.plotRef ? st.input.env[ft.plotRef] : undefined;
    const envText = !ft.report.valid ? 'not analysed (geometry invalid)' : !e ? 'not analysed' : e.state === 'done' ? `${e.status}: ${e.summary}` : e.state === 'failed' ? `analysis failed: ${e.error}` : 'analysis pending';
    text(doc, 'm', 8.8, `${ft.plotRef ?? `feature ${ft.featureIndex + 1}`} · ${ft.report.geometryType ?? 'no geometry'} · ${ft.report.areaHa !== null ? `${ft.report.areaHa} ha (computed)` : ft.report.declaredAreaHa !== null ? `${ft.report.declaredAreaHa} ha (declared)` : 'area unknown'} · ${ft.report.valid ? 'geometry valid' : 'GEOMETRY INVALID'}`);
    text(doc, 'r', 8.2, envText, { color: MUTED });
    doc.moveDown(0.15);
  }
  rule(doc);
  text(doc, 'b', 11, 'Allocation against declared source lots');
  for (const a of st.evaluation.allocationSummary) {
    text(doc, 'r', 8.6, `${a.sourceLotRef} (supplier ${a.supplierId}): declared ${a.declaredGrams === null ? 'unknown' : formatKg(a.declaredGrams)} − reserved elsewhere ${formatKg(a.reservedByOthersGrams)} = available ${a.availableGrams === null ? 'unknown' : formatKg(Math.max(0, a.availableGrams))}; requested here ${formatKg(a.requestedGrams)}; reserved here ${formatKg(a.reservedHereGrams)}${a.excessGrams ? `; EXCESS ${formatKg(a.excessGrams)}` : ''}`);
  }
  rule(doc);
  text(doc, 'b', 11, `Findings (${st.evaluation.findings.length})`);
  const activeDecision = new Map(st.input.decisions.map((d) => [d.findingKey, d]));
  for (const fd of st.evaluation.findings) {
    const d = activeDecision.get(fd.key);
    const tag = d ? (d.decision === 'investigated_not_blocking' ? 'INVESTIGATED WITH EVIDENCE' : 'KEPT ON HOLD') : fd.severity.toUpperCase();
    text(doc, 'm', 8.8, `[${tag}] ${fd.title}`);
    text(doc, 'r', 8.2, `${fd.message} — ${fd.refs.map(refLabel).slice(0, 3).join('; ')}`, { color: MUTED });
    doc.moveDown(0.1);
  }
  if (decisions.length) {
    rule(doc);
    text(doc, 'b', 11, 'Reviewer decisions');
    for (const d of decisions) text(doc, 'r', 8.4, `${d.created_at.replace('T', ' ').slice(0, 16)} UTC · ${d.name} · ${d.finding_key} · ${d.decision.replace(/_/g, ' ')} · evidence ${d.evidence ?? 'none'} · “${d.rationale}”`);
  }
  rule(doc);
  text(doc, 'b', 11, 'Datasets and method');
  for (const ds of Object.values(DATASETS)) text(doc, 'r', 8, `${ds.title}, ${ds.version}. ${ds.resolutionLabel}. ${ds.dateSemantics} Licence: ${ds.license.replace(/\.$/, '')}. SHA-256 ${ds.sha256.slice(0, 16)}…`, { color: MUTED });
  doc.moveDown(0.3);
  text(doc, 'r', 7.8, 'This draft assists due-diligence information gathering. It does not certify that products are deforestation-free or legal, does not prove land rights or physical origin, and has not been submitted to the EU Information System.', { color: MUTED });
  // Page footers.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit insert a new page; lift the margin while drawing the footer.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 28;
    doc.font('r').fontSize(7).fillColor(MUTED).text(safe(doc, `${st.shipment.reference} · DRAFT — NOT SUBMITTED · page ${i + 1} of ${range.count}`), doc.page.margins.left, y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return { bytes: await done, pages: range.count };
}

// ---------------- generation entry point ----------------
export async function generateDocument(db: DB, user: SessionUser, shipmentId: string, kind: 'supplier_request_pdf' | 'review_draft_pdf' | 'dds_xml') {
  const st = computeState(db, user, shipmentId);
  const safeRef = st.shipment.reference.replace(/[^A-Za-z0-9._-]/g, '_');
  const stamp = now().replace(/[-:]/g, '').slice(0, 15);
  let bytes: Buffer, filename: string, validation: unknown = null;
  if (kind === 'supplier_request_pdf') {
    const r = await supplierRequestPdf(st, user);
    bytes = r.bytes;
    filename = `LotHold_${safeRef}_evidence-request_${stamp}Z.pdf`;
    validation = { pages: r.pages, itemsListed: r.itemsListed, itemsOmitted: r.itemsOmitted };
  } else if (kind === 'review_draft_pdf') {
    const decisions = all<{ finding_key: string; decision: string; rationale: string; name: string; created_at: string; evidence: string | null }>(db, 'SELECT d.finding_key, d.decision, d.rationale, u.name, d.created_at, up.filename AS evidence FROM review_decisions d JOIN users u ON u.id = d.reviewer_id LEFT JOIN uploads up ON up.id = d.evidence_upload_id WHERE d.shipment_id = ? ORDER BY d.created_at', shipmentId);
    const r = await reviewDraftPdf(st, user, decisions);
    bytes = r.bytes;
    filename = `LotHold_${safeRef}_review-draft_DRAFT_NOT_SUBMITTED_${stamp}Z.pdf`;
    validation = { pages: r.pages };
  } else {
    if (st.approval.state !== 'current') throw new HttpError(409, 'not_approved', st.approval.state === 'stale' ? 'The sign-off is out of date because the evidence changed. Review and sign off the current snapshot before exporting XML.' : 'XML export requires reviewer sign-off of the current evidence snapshot.');
    const f = st.input.shipment.fields;
    const mass = parseQuantity(f.netMassValue?.value, f.netMassUnit?.value ?? 'kg');
    if (!mass.ok) throw new HttpError(409, 'mass', 'Net mass is invalid.');
    const plotRefsInRows = new Set((st.input.sources?.rows ?? []).flatMap((r) => r.plotRefs));
    const countryByRef = new Map((st.input.sources?.rows ?? []).flatMap((r) => r.plotRefs.map((p) => [p, r.producerCountry] as const)));
    const producers = (st.input.plots?.features ?? [])
      .filter((ft) => ft.plotRef && plotRefsInRows.has(ft.plotRef) && ft.report.valid)
      .map((ft) => {
        const g = ft.geometry as { type: string; coordinates: unknown };
        const properties: Record<string, string | number> = { ProductionPlace: ft.plotRef! };
        if (g.type === 'Point' && typeof ft.declaredAreaHa === 'number') properties.Area = ft.declaredAreaHa;
        return { country: ft.producerCountry ?? countryByRef.get(ft.plotRef!) ?? '', name: ft.producerName, geometry: g, properties };
      });
    const xml = buildSubmitDdsRequest({
      internalReference: st.shipment.reference,
      activityType: (f.activityType!.value!.toUpperCase() as 'IMPORT'),
      operatorRole: 'OPERATOR',
      countryOfActivity: f.countryOfActivity?.value?.toUpperCase() ?? null,
      descriptionOfGoods: f.description!.value!,
      hsHeading: f.hsCode!.value!.replace(/[\s.]/g, ''),
      netWeightGrams: mass.grams,
      geoLocationConfidential: true,
      producers,
    });
    const xsd = await validateDdsXml(xml);
    // XSD base64Binary checks are lenient; independently confirm every geometry decodes to the reviewed GeoJSON.
    const roundTrip = [...xml.matchAll(/<dds:geometryGeojson>([^<]+)<\/dds:geometryGeojson>/g)].map((m, i) => {
      try {
        const decoded = JSON.parse(Buffer.from(m[1]!, 'base64').toString('utf8'));
        return JSON.stringify(decoded.features[0].geometry) === JSON.stringify(producers[i]!.geometry);
      } catch {
        return false;
      }
    });
    validation = { ...xsd, base64RoundTrip: roundTrip.every(Boolean), producers: producers.length, draftStatus: 'DRAFT_NOT_SUBMITTED', note: 'Validated against the official XSD set only. Business rules applied by the EU Information System at submission (e.g. EORI, geolocation checks) are not executed here.' };
    if (!xsd.valid || !roundTrip.every(Boolean)) {
      audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'document.xml_validation_failed', data: validation });
      throw new HttpError(422, 'xsd_invalid', `The generated XML failed validation and was not offered for download: ${xsd.errors.slice(0, 3).join(' | ') || 'base64 round-trip mismatch'}`);
    }
    bytes = Buffer.from(xml, 'utf8');
    filename = `LotHold_${safeRef}_DDS-V3_DRAFT_NOT_SUBMITTED_${stamp}Z.xml`;
  }
  const docId = id();
  const storageKey = storeBytes(user.orgId, bytes, db);
  run(db, 'INSERT INTO documents (id, shipment_id, kind, snapshot_digest, filename, sha256, bytes, storage_key, validation_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', docId, shipmentId, kind, st.digest, filename, sha256Hex(bytes), bytes.length, storageKey, JSON.stringify(validation), user.id, now());
  audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'document.generated', data: { documentId: docId, kind, digest: st.digest, sha256: sha256Hex(bytes) } });
  return { id: docId, kind, filename, sha256: sha256Hex(bytes), bytes: bytes.length, snapshotDigest: st.digest, validation, schema: kind === 'dds_xml' ? SCHEMA_ID : null };
}

export function documentList(db: DB, user: SessionUser, shipmentId: string) {
  const st = get<{ id: string }>(db, 'SELECT id FROM shipments WHERE id = ? AND org_id = ?', shipmentId, user.orgId);
  if (!st) throw new HttpError(404, 'not_found', 'Shipment not found.');
  const current = computeState(db, user, shipmentId).digest;
  return all<{ id: string; kind: string; filename: string; sha256: string; bytes: number; snapshot_digest: string; validation_json: string | null; created_at: string; name: string }>(
    db,
    'SELECT d.id, d.kind, d.filename, d.sha256, d.bytes, d.snapshot_digest, d.validation_json, d.created_at, u.name FROM documents d JOIN users u ON u.id = d.created_by WHERE d.shipment_id = ? ORDER BY d.created_at DESC',
    shipmentId,
  ).map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, sha256: d.sha256, bytes: d.bytes, snapshotDigest: d.snapshot_digest, stale: d.snapshot_digest !== current, validation: d.validation_json ? JSON.parse(d.validation_json) : null, createdAt: d.created_at, createdBy: d.name }));
}

export type { Finding };
