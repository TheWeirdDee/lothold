// Deterministic decision engine. Pure function of its input; the model never edits its output.
import { checkHsCode, EUROPEAN_COUNTRY_TYPE, ACTIVITY_TYPES, ISO_ALPHA2 } from './reference.ts';
import { parseQuantity, formatKg, sumGrams } from './quantity.ts';
import type { SourceRow, PlotFeature } from './sources.ts';

export const RULES_VERSION = 'lothold-rules/2026-10-25.1';

export type Dimension = 'record' | 'environment' | 'allocation';
export type Severity = 'hold' | 'review' | 'not_supported' | 'warning';

export type SourceRef = {
  kind: 'shipment_field' | 'sources_csv' | 'plots_geojson' | 'environment' | 'ledger';
  uploadId?: string;
  filename?: string;
  row?: number;
  column?: string;
  featureIndex?: number;
  plotRef?: string;
  field?: string;
};

export type Finding = {
  key: string; // stable identifier used to attach review decisions
  ruleId: string;
  severity: Severity;
  dimension: Dimension;
  title: string;
  message: string;
  refs: SourceRef[];
  original?: string;
  normalized?: string;
  requestedAction?: string; // supplier-facing wording; null when the reviewer must act internally
  supplierActionable: boolean;
  resolvableByReview: boolean; // only environmental review items; hard holds need corrected source data
  reviewedWithEvidence?: boolean; // a current reviewer decision with evidence covers it; no supplier action outstanding
  data?: Record<string, unknown>;
};

export type ShipmentFieldValue = { value: string | null; source: 'manual' | 'extraction'; revision: number; extractionRef?: { uploadId: string; filename: string; page?: number; span?: string } };

export type ShipmentFields = {
  activityType?: ShipmentFieldValue;
  hsCode?: ShipmentFieldValue;
  description?: ShipmentFieldValue;
  netMassValue?: ShipmentFieldValue;
  netMassUnit?: ShipmentFieldValue;
  countryOfActivity?: ShipmentFieldValue;
  operatorName?: ShipmentFieldValue;
  operatorEori?: ShipmentFieldValue;
};

export type EnvState =
  | { state: 'not_started' }
  | { state: 'queued' }
  | { state: 'failed'; error: string; failureKey: string } // failureKey: stable identity of the failed run (geometry, method, datasets)
  | {
      state: 'done';
      status: 'UNAVAILABLE' | 'PLOT_GEOMETRY_INVALID' | 'PLOT_OUTSIDE_COVERAGE' | 'PARTIAL_COVERAGE' | 'NEEDS_HUMAN_REVIEW' | 'NO_POST_2020_LOSS_OBSERVED';
      summary: string;
      resultId: string;
      geometryHash: string;
      postCutoffLossHa: number;
      years: string | null;
    };

export type LedgerLot = {
  sourceLotKey: string; // `${supplierId}::${sourceLotRef}`
  registeredDeclaredGrams: number | null; // first declared quantity on record for this org
  registeredFromUpload: string | null;
  reservedByOtherShipmentsGrams: number;
  reservedByThisShipmentGrams: number;
};

export type ReviewDecision = {
  findingKey: string;
  decision: 'investigated_not_blocking' | 'keep_on_hold';
  rationale: string;
  evidenceUploadId: string | null;
  reviewerName: string;
  createdAt: string;
};

export type EvaluationInput = {
  shipment: { id: string; reference: string; fields: ShipmentFields };
  sources: { uploadId: string; filename: string; sha256: string; rows: SourceRow[] } | null;
  plots: { uploadId: string; filename: string; sha256: string; features: PlotFeature[] } | null;
  env: Record<string, EnvState>; // keyed by plotRef
  ledger: Record<string, LedgerLot>;
  decisions: ReviewDecision[];
  // Observation recency (optional, for disclosure): latest year of annual loss in the datasets, and today's year.
  recency?: { latestObservationYear: number; asOfYear: number };
};

export type Readiness = {
  record: 'COMPLETE' | 'INCOMPLETE' | 'NOT_SUPPORTED';
  environment: 'NOT_STARTED' | 'IN_PROGRESS' | 'UNAVAILABLE' | 'NEEDS_REVIEW' | 'REVIEWED_WITH_EVIDENCE' | 'NO_POST_2020_LOSS_OBSERVED' | 'BLOCKED_BY_GEOMETRY';
  allocation: 'NO_SOURCES' | 'CONFLICT' | 'NOT_RESERVED' | 'RESERVED';
  overall: 'HOLD' | 'NEEDS_HUMAN_REVIEW' | 'READY_FOR_SIGN_OFF';
  explanation: string[];
};

export type Evaluation = {
  rulesVersion: string;
  findings: Finding[];
  readiness: Readiness;
  counts: { sourceRows: number; plotsDeclared: number; plotsWithGeometry: number; plotsValid: number; envReview: number; holds: number };
  processLine: string;
  allocationSummary: {
    sourceLotKey: string;
    supplierId: string;
    sourceLotRef: string;
    rows: number[];
    requestedGrams: number;
    declaredGrams: number | null;
    reservedByOthersGrams: number;
    reservedHereGrams: number;
    availableGrams: number | null;
    excessGrams: number;
  }[];
};

const FIELD_LABEL: Record<keyof ShipmentFields, string> = {
  activityType: 'Activity type',
  hsCode: 'HS code',
  description: 'Description of goods',
  netMassValue: 'Net mass',
  netMassUnit: 'Net mass unit',
  countryOfActivity: 'Country of activity (EU)',
  operatorName: 'Operator name',
  operatorEori: 'Operator EORI',
};

export function evaluate(input: EvaluationInput): Evaluation {
  const findings: Finding[] = [];
  const f = input.shipment.fields;
  const fieldRef = (field: keyof ShipmentFields): SourceRef[] => {
    const v = f[field];
    const refs: SourceRef[] = [{ kind: 'shipment_field', field }];
    if (v?.extractionRef) refs.push({ kind: 'shipment_field', field, uploadId: v.extractionRef.uploadId, filename: v.extractionRef.filename });
    return refs;
  };

  // --- Shipment-level record fields ---
  const val = (k: keyof ShipmentFields) => (f[k]?.value ?? '').trim();
  const requireField = (k: keyof ShipmentFields, why: string) => {
    if (!val(k))
      findings.push({
        key: `SHIP-REQ:${k}`,
        ruleId: 'SHIP-REQ',
        severity: 'hold',
        dimension: 'record',
        title: `${FIELD_LABEL[k]} missing`,
        message: `${FIELD_LABEL[k]} has not been entered or confirmed. ${why}`,
        refs: fieldRef(k),
        supplierActionable: false,
        resolvableByReview: false,
      });
  };
  requireField('activityType', 'The due-diligence statement requires IMPORT, EXPORT or DOMESTIC.');
  requireField('hsCode', 'The commodity code is required for every declared product.');
  requireField('description', 'A commercial description of the goods is required (max 150 characters).');
  requireField('netMassValue', 'Net mass in kilograms is mandatory for IMPORT and EXPORT.');
  requireField('operatorName', 'The operator name is required for the review draft.');

  if (val('activityType') && !ACTIVITY_TYPES.includes(val('activityType').toUpperCase() as never)) {
    findings.push({ key: 'SHIP-ACT', ruleId: 'SHIP-ACT', severity: 'hold', dimension: 'record', title: 'Activity type not recognised', message: `"${val('activityType')}" is not IMPORT, EXPORT or DOMESTIC.`, refs: fieldRef('activityType'), original: val('activityType'), supplierActionable: false, resolvableByReview: false });
  }
  if (val('description').length > 150) {
    findings.push({ key: 'SHIP-DESC-LEN', ruleId: 'SHIP-DESC-LEN', severity: 'hold', dimension: 'record', title: 'Description too long', message: `The description has ${val('description').length} characters; the DDS limit is 150.`, refs: fieldRef('description'), supplierActionable: false, resolvableByReview: false });
  }
  let notSupported = false;
  if (val('hsCode')) {
    const hs = checkHsCode(val('hsCode'));
    if (!hs.ok) {
      notSupported = hs.reason === 'other_cocoa_product' || hs.reason === 'not_cocoa';
      findings.push({
        key: 'SHIP-HS',
        ruleId: 'SHIP-HS',
        severity: notSupported ? 'not_supported' : 'hold',
        dimension: 'record',
        title: notSupported ? 'Product outside supported scope' : 'HS code invalid',
        message: hs.message,
        refs: fieldRef('hsCode'),
        original: val('hsCode'),
        supplierActionable: false,
        resolvableByReview: false,
      });
    }
  }
  const coa = val('countryOfActivity').toUpperCase();
  if (coa && !EUROPEAN_COUNTRY_TYPE.has(coa)) {
    findings.push({ key: 'SHIP-COA', ruleId: 'SHIP-COA', severity: 'hold', dimension: 'record', title: 'Country of activity invalid', message: `"${val('countryOfActivity')}" is not an EU Member State code accepted by the DDS (EuropeanCountryType).`, refs: fieldRef('countryOfActivity'), original: val('countryOfActivity'), supplierActionable: false, resolvableByReview: false });
  }
  const act = val('activityType').toUpperCase();
  if ((act === 'IMPORT' || act === 'EXPORT') && !val('operatorEori')) {
    findings.push({ key: 'SHIP-EORI', ruleId: 'SHIP-EORI', severity: 'warning', dimension: 'record', title: 'EORI not recorded', message: 'The EUDR system requires an EORI identifier for IMPORT/EXPORT operators. It is not needed for this review draft, but must exist before any authorised submission.', refs: fieldRef('operatorEori'), supplierActionable: false, resolvableByReview: false });
  }
  let shipmentGrams: number | null = null;
  if (val('netMassValue')) {
    const q = parseQuantity(val('netMassValue'), val('netMassUnit') || 'kg');
    if (!q.ok) findings.push({ key: 'SHIP-MASS', ruleId: 'SHIP-MASS', severity: 'hold', dimension: 'record', title: 'Net mass invalid', message: q.message, refs: fieldRef('netMassValue'), original: `${val('netMassValue')} ${val('netMassUnit')}`.trim(), supplierActionable: false, resolvableByReview: false });
    else shipmentGrams = q.grams;
  }

  // --- Source rows ---
  const rows = input.sources?.rows ?? [];
  const srcRef = (row: number, column?: string): SourceRef => ({ kind: 'sources_csv', uploadId: input.sources?.uploadId, filename: input.sources?.filename, row, column });
  if (!input.sources) {
    findings.push({ key: 'SRC-NONE', ruleId: 'SRC-NONE', severity: 'hold', dimension: 'record', title: 'No confirmed source table', message: 'Upload and confirm the shipment source table (CSV) listing supplier, source lot, quantities and plots.', refs: [{ kind: 'sources_csv' }], supplierActionable: true, requestedAction: 'Provide the source-lot table for this shipment: supplier ID, source lot reference, declared and allocated quantity, producer country and plot references.', resolvableByReview: false });
  }
  for (const r of rows) {
    for (const iss of r.issues) {
      if (iss.severity !== 'hold') continue;
      // Reported once, with the full balance arithmetic, by ALLOC-EXCESS below.
      if (iss.code === 'allocation_exceeds_declared_in_row') continue;
      findings.push({
        key: `SRC-ROW:${r.row}:${iss.code}`,
        ruleId: 'SRC-ROW',
        severity: 'hold',
        dimension: iss.code.startsWith('quantity') || iss.code === 'allocation_exceeds_declared_in_row' ? 'allocation' : 'record',
        title: `Row ${r.row}: ${iss.column.replace(/_/g, ' ')}`,
        message: iss.message,
        refs: [srcRef(r.row, iss.column)],
        original: iss.original,
        supplierActionable: true,
        requestedAction: `Correct "${iss.column}" in row ${r.row} of ${input.sources?.filename ?? 'the source table'}: ${iss.message}`,
        resolvableByReview: false,
      });
    }
  }

  // --- Allocation conservation (within this organisation's ledger) ---
  type Agg = { supplierId: string; sourceLotRef: string; rows: number[]; requested: number[]; declared: Map<number, number[]> };
  const byLot = new Map<string, Agg>();
  for (const r of rows) {
    if (!r.supplierId || !r.sourceLotRef || !r.allocatedQuantity.ok || !r.declaredQuantity.ok) continue;
    const k = `${r.supplierId}::${r.sourceLotRef}`;
    const a: Agg = byLot.get(k) ?? { supplierId: r.supplierId, sourceLotRef: r.sourceLotRef, rows: [], requested: [], declared: new Map<number, number[]>() };
    a.rows.push(r.row);
    a.requested.push(r.allocatedQuantity.grams);
    const d = a.declared.get(r.declaredQuantity.grams) ?? [];
    d.push(r.row);
    a.declared.set(r.declaredQuantity.grams, d);
    byLot.set(k, a);
  }
  const allocationSummary: Evaluation['allocationSummary'] = [];
  for (const [k, a] of byLot) {
    const ledger = input.ledger[k];
    const requested = sumGrams(a.requested);
    if (a.declared.size > 1) {
      findings.push({
        key: `ALLOC-DECL-CONFLICT:${k}`,
        ruleId: 'ALLOC-DECL-CONFLICT',
        severity: 'hold',
        dimension: 'allocation',
        title: `Source lot ${a.sourceLotRef}: conflicting declared totals`,
        message: `Rows ${a.rows.join(', ')} state different declared totals for the same source lot (${[...a.declared.keys()].map(formatKg).join(' vs ')}).`,
        refs: a.rows.map((row) => srcRef(row, 'source_lot_declared_quantity')),
        supplierActionable: true,
        requestedAction: `Confirm the single declared total for source lot ${a.sourceLotRef} (supplier ${a.supplierId}); rows ${a.rows.join(', ')} disagree.`,
        resolvableByReview: false,
      });
    }
    const declaredInFile = [...a.declared.keys()][0]!;
    const registered = ledger?.registeredDeclaredGrams ?? null;
    if (registered !== null && registered !== declaredInFile) {
      findings.push({
        key: `ALLOC-REG-MISMATCH:${k}`,
        ruleId: 'ALLOC-REG-MISMATCH',
        severity: 'hold',
        dimension: 'allocation',
        title: `Source lot ${a.sourceLotRef}: declared total differs from earlier record`,
        message: `This file declares ${formatKg(declaredInFile)} but an earlier confirmed upload recorded ${formatKg(registered)} for the same source lot. LotHold keeps the first recorded total and does not overwrite it.`,
        refs: [srcRef(a.rows[0]!, 'source_lot_declared_quantity'), { kind: 'ledger', uploadId: ledger?.registeredFromUpload ?? undefined }],
        original: formatKg(declaredInFile),
        normalized: formatKg(registered),
        supplierActionable: true,
        requestedAction: `Explain why source lot ${a.sourceLotRef} is now declared as ${formatKg(declaredInFile)} when it was previously declared as ${formatKg(registered)}, with supporting documents.`,
        resolvableByReview: false,
      });
    }
    const declared = registered ?? declaredInFile;
    const others = ledger?.reservedByOtherShipmentsGrams ?? 0;
    const here = ledger?.reservedByThisShipmentGrams ?? 0;
    const available = declared - others;
    const excess = Math.max(0, requested - available);
    allocationSummary.push({ sourceLotKey: k, supplierId: a.supplierId, sourceLotRef: a.sourceLotRef, rows: a.rows, requestedGrams: requested, declaredGrams: declared, reservedByOthersGrams: others, reservedHereGrams: here, availableGrams: available, excessGrams: excess });
    if (excess > 0) {
      findings.push({
        key: `ALLOC-EXCESS:${k}`,
        ruleId: 'ALLOC-EXCESS',
        severity: 'hold',
        dimension: 'allocation',
        title: `Source lot ${a.sourceLotRef} over-allocated by ${formatKg(excess)}`,
        message: `Declared ${formatKg(declared)} − already reserved by other shipments ${formatKg(others)} = ${formatKg(available)} available. This shipment requests ${formatKg(requested)} (rows ${a.rows.join(', ')}), exceeding the declared balance by ${formatKg(excess)}.`,
        refs: a.rows.map((row) => srcRef(row, 'allocated_quantity')),
        supplierActionable: true,
        requestedAction: `Reduce the allocation from source lot ${a.sourceLotRef} by at least ${formatKg(excess)}, or provide evidence that the declared total for that lot is higher.`,
        resolvableByReview: false,
        data: { declared, others, available, requested, excess },
      });
    }
  }
  const allocatedTotal = sumGrams(rows.filter((r) => r.allocatedQuantity.ok).map((r) => (r.allocatedQuantity as { grams: number }).grams));
  if (input.sources && shipmentGrams !== null && rows.every((r) => r.allocatedQuantity.ok) && allocatedTotal !== shipmentGrams) {
    findings.push({
      key: 'ALLOC-SHIP-TOTAL',
      ruleId: 'ALLOC-SHIP-TOTAL',
      severity: 'hold',
      dimension: 'allocation',
      title: 'Source allocations do not add up to shipment net mass',
      message: `Allocated rows total ${formatKg(allocatedTotal)}, but the shipment net mass is ${formatKg(shipmentGrams)} (difference ${formatKg(Math.abs(allocatedTotal - shipmentGrams))}).`,
      refs: [{ kind: 'shipment_field', field: 'netMassValue' }, ...rows.map((r) => srcRef(r.row, 'allocated_quantity'))],
      supplierActionable: true,
      requestedAction: `Account for the full shipment net mass of ${formatKg(shipmentGrams)}: the source rows currently cover ${formatKg(allocatedTotal)}.`,
      resolvableByReview: false,
    });
  }

  // --- Plots ---
  const features = input.plots?.features ?? [];
  const featureByRef = new Map(features.filter((x) => x.plotRef).map((x) => [x.plotRef!, x]));
  // Every row that references a plot contributes its producer country; none is silently preferred.
  const declaredRefs = new Map<string, { rows: number[]; countries: Map<string, number[]> }>();
  for (const r of rows) for (const p of r.plotRefs) {
    const e = declaredRefs.get(p) ?? { rows: [], countries: new Map<string, number[]>() };
    e.rows.push(r.row);
    if (r.producerCountry) e.countries.set(r.producerCountry, [...(e.countries.get(r.producerCountry) ?? []), r.row]);
    declaredRefs.set(p, e);
  }
  const describeCountries = (m: Map<string, number[]>) => [...m].map(([c, rs]) => `${c} (row${rs.length > 1 ? 's' : ''} ${rs.join(', ')})`).join(' vs ');
  const plotRef = (x: PlotFeature): SourceRef => ({ kind: 'plots_geojson', uploadId: input.plots?.uploadId, filename: input.plots?.filename, featureIndex: x.featureIndex, plotRef: x.plotRef ?? undefined });
  if (input.sources && !input.plots && declaredRefs.size > 0) {
    findings.push({ key: 'PLOT-NONE', ruleId: 'PLOT-NONE', severity: 'hold', dimension: 'record', title: 'No plot geometry file', message: `The source table lists ${declaredRefs.size} plot reference(s) but no plot GeoJSON has been confirmed.`, refs: [{ kind: 'plots_geojson' }], supplierActionable: true, requestedAction: `Provide a GeoJSON FeatureCollection with the boundary (or point and area, for plots of 4 ha or less) of plots ${[...declaredRefs.keys()].join(', ')}.`, resolvableByReview: false });
  }
  for (const [ref, info] of declaredRefs) {
    const feat = featureByRef.get(ref);
    if (!feat && input.plots) {
      findings.push({
        key: `PLOT-MISSING:${ref}`,
        ruleId: 'PLOT-MISSING',
        severity: 'hold',
        dimension: 'record',
        title: `Plot ${ref} has no geometry`,
        message: `Plot ${ref} is declared in row${info.rows.length > 1 ? 's' : ''} ${info.rows.join(', ')} but does not appear in ${input.plots.filename}.`,
        refs: info.rows.map((row) => srcRef(row, 'plot_refs')),
        supplierActionable: true,
        requestedAction: `Provide the geolocation of plot ${ref}: a polygon boundary in WGS 84 longitude/latitude with at least 6 decimals, or a point with its area in hectares if the plot is 4 ha or less.`,
        resolvableByReview: false,
      });
    }
    if (info.countries.size > 1) {
      findings.push({
        key: `PLOT-COUNTRY-ROWS:${ref}`,
        ruleId: 'PLOT-COUNTRY-ROWS',
        severity: 'hold',
        dimension: 'record',
        title: `Plot ${ref}: rows give different producer countries`,
        message: `Rows referencing plot ${ref} disagree on its country of production: ${describeCountries(info.countries)}. A plot has one country of production.`,
        refs: info.rows.map((row) => srcRef(row, 'producer_country')),
        supplierActionable: true,
        requestedAction: `Confirm the single country of production for plot ${ref} and correct the rows that disagree (${describeCountries(info.countries)}).`,
        resolvableByReview: false,
      });
    }
    const otherCountries = feat?.producerCountry ? [...info.countries.keys()].filter((c) => c !== feat.producerCountry) : [];
    if (feat && feat.producerCountry && otherCountries.length) {
      const rowsDisagreeing = otherCountries.flatMap((c) => info.countries.get(c)!);
      findings.push({ key: `PLOT-COUNTRY:${ref}`, ruleId: 'PLOT-COUNTRY', severity: 'hold', dimension: 'record', title: `Plot ${ref}: country mismatch`, message: `The GeoJSON gives ProducerCountry ${feat.producerCountry}; the source table gives ${describeCountries(new Map(otherCountries.map((c) => [c, info.countries.get(c)!])))}.`, refs: [plotRef(feat), ...rowsDisagreeing.map((row) => srcRef(row, 'producer_country'))], supplierActionable: true, requestedAction: `Confirm the country of production for plot ${ref} (${feat.producerCountry} in the geometry file vs ${otherCountries.join(', ')} in the source table).`, resolvableByReview: false });
    }
  }
  for (const feat of features) {
    for (const iss of feat.issues.filter((i) => i.severity === 'hold')) {
      findings.push({ key: `PLOT-PROP:${feat.featureIndex}:${iss.code}`, ruleId: 'PLOT-PROP', severity: 'hold', dimension: 'record', title: `Feature ${feat.featureIndex + 1}${feat.plotRef ? ` (${feat.plotRef})` : ''}: ${iss.code.replace(/_/g, ' ')}`, message: iss.message, refs: [plotRef(feat)], supplierActionable: true, requestedAction: `Correct feature ${feat.featureIndex + 1} in ${input.plots?.filename}: ${iss.message}`, resolvableByReview: false });
    }
    for (const iss of feat.report.issues) {
      if (iss.severity !== 'hold') continue;
      findings.push({
        key: `PLOT-GEOM:${feat.plotRef ?? feat.featureIndex}:${iss.code}`,
        ruleId: 'PLOT-GEOM',
        severity: 'hold',
        dimension: 'record',
        title: `Plot ${feat.plotRef ?? `feature ${feat.featureIndex + 1}`}: ${iss.code.replace(/_/g, ' ')}`,
        message: iss.message,
        refs: [{ ...plotRef(feat), field: iss.path }],
        supplierActionable: true,
        requestedAction: `Correct the geometry of plot ${feat.plotRef ?? `feature ${feat.featureIndex + 1}`}: ${iss.message}`,
        resolvableByReview: false,
        data: iss.proposedCorrection ? { proposedCorrection: iss.proposedCorrection.kind } : undefined,
      });
    }
    if (feat.plotRef && input.sources && !declaredRefs.has(feat.plotRef)) {
      findings.push({ key: `PLOT-ORPHAN:${feat.plotRef}`, ruleId: 'PLOT-ORPHAN', severity: 'warning', dimension: 'record', title: `Plot ${feat.plotRef} not referenced`, message: `Plot ${feat.plotRef} is in the geometry file but no source row lists it; it is not part of this shipment's evidence.`, refs: [plotRef(feat)], supplierActionable: false, resolvableByReview: false });
    }
  }

  // --- Environmental evidence ---
  const decisionsByKey = new Map<string, ReviewDecision>();
  for (const d of input.decisions) decisionsByKey.set(d.findingKey, d); // last decision wins (input is chronological)
  let envNeeds = 0, envUnavailable = 0, envPending = 0, envClear = 0, envReviewed = 0, envBlocked = 0;
  for (const [ref] of declaredRefs) {
    const feat = featureByRef.get(ref);
    if (!feat) continue;
    if (!feat.report.valid) { envBlocked++; continue; }
    const e = input.env[ref] ?? { state: 'not_started' };
    if (e.state === 'not_started' || e.state === 'queued') { envPending++; continue; }
    const key = `ENV:${ref}`;
    const decision = decisionsByKey.get(key);
    const reviewed = decision?.decision === 'investigated_not_blocking' && !!decision.evidenceUploadId && decision.rationale.trim().length >= 40;
    if (e.state === 'failed' || (e.state === 'done' && e.status === 'UNAVAILABLE')) {
      if (reviewed) envReviewed++; else envUnavailable++;
      findings.push({ key, ruleId: 'ENV-UNAVAILABLE', severity: 'review', dimension: 'environment', title: `Plot ${ref}: environmental evidence unavailable`, message: e.state === 'failed' ? `Analysis failed: ${e.error}. No conclusion is drawn.` : e.summary, refs: [plotRef(feat), { kind: 'environment', plotRef: ref }], supplierActionable: false, resolvableByReview: true });
      continue;
    }
    if (e.state !== 'done') continue;
    if (e.status === 'PLOT_OUTSIDE_COVERAGE' || e.status === 'PARTIAL_COVERAGE') {
      if (reviewed) envReviewed++; else envUnavailable++;
      findings.push({ key, ruleId: e.status === 'PLOT_OUTSIDE_COVERAGE' ? 'ENV-OUTSIDE' : 'ENV-PARTIAL', severity: 'review', dimension: 'environment', title: `Plot ${ref}: ${e.status === 'PLOT_OUTSIDE_COVERAGE' ? 'outside dataset coverage' : 'partial dataset coverage'}`, message: e.summary, refs: [plotRef(feat), { kind: 'environment', plotRef: ref }], supplierActionable: false, resolvableByReview: true });
    } else if (e.status === 'NEEDS_HUMAN_REVIEW') {
      if (reviewed) envReviewed++; else envNeeds++;
      findings.push({
        key,
        ruleId: 'ENV-LOSS',
        severity: 'review',
        dimension: 'environment',
        title: `Plot ${ref}: land-change signal after 2020`,
        message: e.summary,
        refs: [plotRef(feat), { kind: 'environment', plotRef: ref }],
        // Once a current decision with evidence covers the signal, nothing is outstanding from the supplier; if the
        // decision becomes stale (new analysis or evidence), this flips back and the request reappears.
        supplierActionable: !reviewed,
        reviewedWithEvidence: reviewed || undefined,
        requestedAction: `Explain the tree-cover loss recorded on plot ${ref} in ${e.years ?? 'years after 2020'} (≈${e.postCutoffLossHa.toFixed(2)} ha) and provide dated evidence of land use on 31 December 2020 and since (for example field photos, land-use records, or farm establishment records).`,
        resolvableByReview: true,
        data: { postCutoffLossHa: e.postCutoffLossHa, years: e.years },
      });
    } else if (e.status === 'NO_POST_2020_LOSS_OBSERVED') envClear++;
    else if (e.status === 'PLOT_GEOMETRY_INVALID') envBlocked++;
  }

  // Observation recency is disclosed, not used to block: annual data cannot show change after its latest year.
  // (Snapshot staleness, i.e. evidence changing after sign-off, is enforced separately through the digest.)
  if (input.recency && Object.values(input.env).some((e) => e.state === 'done')) {
    const { latestObservationYear: y, asOfYear: now } = input.recency;
    const gap = Math.max(0, now - y);
    findings.push({
      key: 'ENV-RECENCY',
      ruleId: 'ENV-RECENCY',
      severity: 'warning',
      dimension: 'environment',
      title: `Forest data observes change up to ${y}`,
      message: `The annual tree-cover loss data ends with ${y}${gap > 0 ? `, ${gap} year${gap === 1 ? '' : 's'} before ${now}` : ''}. Land change after ${y} is not observed by this analysis; ask the supplier about recent land use if it matters for this shipment.`,
      refs: [{ kind: 'environment' }],
      supplierActionable: false,
      resolvableByReview: false,
      data: { latestObservationYear: y, asOfYear: now, gapYears: gap },
    });
  }

  // Attach "keep on hold" decisions as holds.
  for (const fd of findings) {
    const d = decisionsByKey.get(fd.key);
    if (fd.resolvableByReview && d?.decision === 'keep_on_hold') {
      fd.severity = 'hold';
      fd.message += ` Reviewer kept this on hold: “${d.rationale}”`;
    }
  }

  // --- Readiness ---
  const holds = findings.filter((x) => x.severity === 'hold');
  const recordHolds = holds.filter((x) => x.dimension === 'record');
  const allocHolds = holds.filter((x) => x.dimension === 'allocation');
  const record: Readiness['record'] = notSupported ? 'NOT_SUPPORTED' : recordHolds.length ? 'INCOMPLETE' : 'COMPLETE';
  const environment: Readiness['environment'] =
    envBlocked > 0 ? 'BLOCKED_BY_GEOMETRY'
    : declaredRefs.size === 0 || featureByRef.size === 0 ? 'NOT_STARTED'
    : envPending > 0 ? 'IN_PROGRESS'
    : envNeeds > 0 ? 'NEEDS_REVIEW'
    : envUnavailable > 0 ? 'UNAVAILABLE'
    : envReviewed > 0 ? 'REVIEWED_WITH_EVIDENCE'
    : envClear > 0 ? 'NO_POST_2020_LOSS_OBSERVED'
    : 'NOT_STARTED';
  const allReserved = allocationSummary.length > 0 && allocationSummary.every((a) => a.reservedHereGrams === a.requestedGrams);
  const allocation: Readiness['allocation'] = !input.sources ? 'NO_SOURCES' : allocHolds.length ? 'CONFLICT' : allReserved ? 'RESERVED' : 'NOT_RESERVED';
  const explanation: string[] = [];
  if (record !== 'COMPLETE') explanation.push(record === 'NOT_SUPPORTED' ? 'The product is outside the supported cocoa-beans scope.' : `${recordHolds.length} record field(s) are missing or invalid.`);
  if (allocation === 'CONFLICT') explanation.push(`${allocHolds.length} allocation conflict(s) against declared source-lot balances.`);
  if (allocation === 'NOT_RESERVED') explanation.push('Source-lot allocations have not been reserved in the ledger yet.');
  if (environment === 'NEEDS_REVIEW') explanation.push(`${envNeeds} plot(s) show tree-cover loss after 2020 and need investigation with evidence.`);
  if (environment === 'UNAVAILABLE') explanation.push(`${envUnavailable} plot(s) have no usable environmental observation; this is not a clear result.`);
  if (environment === 'IN_PROGRESS') explanation.push(`Environmental analysis is still running for ${envPending} plot(s); no conclusion yet.`);
  if (environment === 'BLOCKED_BY_GEOMETRY') explanation.push(`${envBlocked} plot(s) cannot be analysed until their geometry is corrected.`);
  if (environment === 'NOT_STARTED' && input.sources) explanation.push('No plot has been analysed yet.');
  const overall: Readiness['overall'] =
    holds.length > 0 || record !== 'COMPLETE' || allocation === 'CONFLICT' || environment === 'BLOCKED_BY_GEOMETRY'
      ? 'HOLD'
      : environment === 'NEEDS_REVIEW' || environment === 'UNAVAILABLE' || environment === 'IN_PROGRESS' || environment === 'NOT_STARTED' || allocation !== 'RESERVED'
        ? 'NEEDS_HUMAN_REVIEW'
        : 'READY_FOR_SIGN_OFF';

  const validPlots = features.filter((x) => x.report.valid && x.plotRef && declaredRefs.has(x.plotRef)).length;
  const withGeom = [...declaredRefs.keys()].filter((r) => featureByRef.has(r)).length;
  const parts = [
    `Read ${rows.length} source row${rows.length === 1 ? '' : 's'}`,
    `${declaredRefs.size} plot declaration${declaredRefs.size === 1 ? '' : 's'}`,
  ];
  if (declaredRefs.size - withGeom > 0) parts.push(`${declaredRefs.size - withGeom} without geometry`);
  if (withGeom - validPlots > 0) parts.push(`${withGeom - validPlots} geometry invalid`);
  const excessLots = allocationSummary.filter((a) => a.excessGrams > 0).length;
  if (excessLots) parts.push(`${excessLots} source lot${excessLots === 1 ? '' : 's'} over-allocated`);
  if (envNeeds) parts.push(`${envNeeds} land-change signal${envNeeds === 1 ? '' : 's'} to investigate`);
  parts.push(overall === 'HOLD' ? 'shipment held' : overall === 'NEEDS_HUMAN_REVIEW' ? 'human review required' : 'ready for reviewer sign-off');
  if (findings.some((x) => x.supplierActionable && x.severity !== 'warning')) parts.push('supplier request ready');

  return {
    rulesVersion: RULES_VERSION,
    findings,
    readiness: { record, environment, allocation, overall, explanation },
    counts: { sourceRows: rows.length, plotsDeclared: declaredRefs.size, plotsWithGeometry: withGeom, plotsValid: validPlots, envReview: envNeeds, holds: holds.length },
    processLine: parts.join(' → '),
    allocationSummary,
  };
}

export { ISO_ALPHA2 };
