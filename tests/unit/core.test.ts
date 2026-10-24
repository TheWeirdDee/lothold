// Engineering tests for deterministic rules. All inputs are isolated test fixtures.
import { describe, expect, it } from 'vitest';
import { parseQuantity, formatKg, gramsToKgDecimal, sumGrams } from '../../core/quantity.ts';
import { validatePlotGeometry } from '../../core/geometry.ts';
import { checkHsCode } from '../../core/reference.ts';
import { parseSourcesCsv, parsePlotsGeoJson } from '../../core/sources.ts';
import { evaluate, type EvaluationInput } from '../../core/rules.ts';

const sq = (x: number, y: number, d = 0.01) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });

describe('quantities (fixed-point grams)', () => {
  it('converts units exactly and keeps the original', () => {
    expect(parseQuantity('2.5', 't')).toMatchObject({ ok: true, grams: 2_500_000, unit: 't', original: '2.5' });
    expect(parseQuantity('1000', 'kg')).toMatchObject({ ok: true, grams: 1_000_000 });
    expect(parseQuantity('0.001', 'kg')).toMatchObject({ ok: true, grams: 1 });
    expect(parseQuantity('1000.500', 'KG')).toMatchObject({ ok: true, grams: 1_000_500 });
    expect(parseQuantity('12', 'MT')).toMatchObject({ ok: true, grams: 12_000_000 });
  });
  it('never uses floating point (0.1 + 0.2 style)', () => {
    const a = parseQuantity('0.1', 'kg'), b = parseQuantity('0.2', 'kg');
    expect(a.ok && b.ok && sumGrams([a.grams, b.grams])).toBe(300);
    expect(formatKg(300)).toBe('0.3 kg');
    expect(gramsToKgDecimal(1_000_500)).toBe('1000.5');
  });
  it('rejects ambiguous, invalid and imprecise values', () => {
    expect(parseQuantity('1,000', 'kg')).toMatchObject({ ok: false, reason: 'ambiguous_separator' });
    expect(parseQuantity('1.000,5', 'kg')).toMatchObject({ ok: false, reason: 'ambiguous_separator' });
    expect(parseQuantity('', 'kg')).toMatchObject({ ok: false, reason: 'missing' });
    expect(parseQuantity('abc', 'kg')).toMatchObject({ ok: false, reason: 'not_a_number' });
    expect(parseQuantity('-5', 'kg')).toMatchObject({ ok: false, reason: 'non_positive' });
    expect(parseQuantity('0', 'kg')).toMatchObject({ ok: false, reason: 'non_positive' });
    expect(parseQuantity('1.0001', 'kg')).toMatchObject({ ok: false, reason: 'too_precise' });
    expect(parseQuantity('5', 'lbs')).toMatchObject({ ok: false, reason: 'unknown_unit' });
    expect(parseQuantity('1e3', 'kg')).toMatchObject({ ok: false, reason: 'not_a_number' });
  });
});

describe('product scope', () => {
  it('accepts HS 1801 only', () => {
    expect(checkHsCode('1801')).toMatchObject({ ok: true });
    expect(checkHsCode('1801.00')).toMatchObject({ ok: true, normalized: '180100' });
    expect(checkHsCode('1806')).toMatchObject({ ok: false, reason: 'other_cocoa_product' });
    expect(checkHsCode('0901')).toMatchObject({ ok: false, reason: 'not_cocoa' });
    expect(checkHsCode('18A1')).toMatchObject({ ok: false, reason: 'malformed' });
  });
});

describe('geometry validation', () => {
  it('accepts a valid closed polygon and computes area', () => {
    const r = validatePlotGeometry(sq(-6.5, 6.0));
    expect(r.valid).toBe(true);
    expect(r.areaHa).toBeGreaterThan(100);
  });
  it('rejects self-intersection without reporting a fake zero area', () => {
    const bow = { type: 'Polygon', coordinates: [[[-7.205, 5.745], [-7.195, 5.755], [-7.195, 5.745], [-7.205, 5.755], [-7.205, 5.745]]] };
    const r = validatePlotGeometry(bow);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('self_intersection');
    expect(r.issues.map((i) => i.code)).not.toContain('zero_area');
    expect(r.areaHa).toBeNull();
  });
  it('rejects open rings, holes, line strings, empty and out-of-bounds input', () => {
    expect(validatePlotGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }).issues[0]!.code).toBe('ring_not_closed');
    const hole = { type: 'Polygon', coordinates: [sq(0, 0, 1).coordinates[0], sq(0.2, 0.2, 0.1).coordinates[0]] };
    expect(validatePlotGeometry(hole).issues.map((i) => i.code)).toContain('holes_not_supported');
    expect(validatePlotGeometry({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }).issues[0]!.code).toBe('unsupported_type');
    expect(validatePlotGeometry(null).issues[0]!.code).toBe('missing_geometry');
    expect(validatePlotGeometry({ type: 'Polygon', coordinates: [] }).issues[0]!.code).toBe('malformed_coordinates');
    expect(validatePlotGeometry({ type: 'Point', coordinates: [200, 10] }, { declaredAreaHa: 1 }).issues.map((i) => i.code)).toContain('out_of_bounds');
  });
  it('detects a latitude/longitude swap against the declared country and proposes (not applies) a correction', () => {
    const swapped = { type: 'Polygon', coordinates: [[[6.0, -6.5], [6.0, -6.49], [6.01, -6.49], [6.01, -6.5], [6.0, -6.5]]] };
    const r = validatePlotGeometry(swapped, { expectedBbox: [-9.1, 3.9, -2.0, 11.2] });
    const iss = r.issues.find((i) => i.code === 'possible_lat_lon_swap');
    expect(iss?.proposedCorrection?.geometry).toBeDefined();
    expect(r.valid).toBe(false);
  });
  it('detects a swap when latitude exceeds ±90', () => {
    const r = validatePlotGeometry({ type: 'Point', coordinates: [5.8, -120.2] }, { declaredAreaHa: 2 });
    expect(r.issues.map((i) => i.code)).toContain('possible_lat_lon_swap');
  });
  it('applies the EUDR point/area rules', () => {
    expect(validatePlotGeometry({ type: 'Point', coordinates: [-6.5, 6] }, { declaredAreaHa: 3.5 }).valid).toBe(true);
    expect(validatePlotGeometry({ type: 'Point', coordinates: [-6.5, 6] }, { declaredAreaHa: 4.5 }).issues[0]!.code).toBe('point_requires_polygon');
    expect(validatePlotGeometry({ type: 'Point', coordinates: [-6.5, 6] }, {}).issues[0]!.code).toBe('point_area_missing');
    expect(validatePlotGeometry({ type: 'Point', coordinates: [-6.5, 6] }, { declaredAreaHa: '3' }).issues[0]!.code).toBe('point_area_invalid');
  });
  it('refuses a projected CRS instead of guessing', () => {
    const r = validatePlotGeometry(sq(0, 0), { crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32630' } } });
    expect(r.issues[0]!.code).toBe('crs_not_wgs84');
  });
  it('flags vertices that collapse at 6-decimal truncation', () => {
    const g = { type: 'Polygon', coordinates: [[[0.1234567, 0.1], [0.1234568, 0.1], [0.2, 0.2], [0.1, 0.2], [0.1234567, 0.1]]] };
    expect(validatePlotGeometry(g).issues.map((i) => i.code)).toContain('degenerate_after_truncation');
  });
});

describe('source parsers', () => {
  it('reports missing columns with an actionable message', () => {
    const r = parseSourcesCsv('supplier_id,foo\nA,1\n');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/source_lot_ref/);
  });
  it('keeps row numbers and per-cell issues, never invents values', () => {
    const csv = 'supplier_id,supplier_name,source_lot_ref,source_lot_declared_quantity,allocated_quantity,quantity_unit,producer_country,plot_refs\n,X,L1,1000,1200,kg,CIV,P1;P1\n';
    const r = parseSourcesCsv(csv);
    if (!r.ok) throw new Error(r.error);
    const row = r.rows[0]!;
    expect(row.row).toBe(2);
    expect(row.supplierId).toBeNull();
    expect(row.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['missing_supplier_id', 'allocation_exceeds_declared_in_row', 'invalid_producer_country', 'duplicate_plot_ref']));
  });
  it('parses GeoJSON precision from the raw text, not from parsed numbers', () => {
    const six = parsePlotsGeoJson('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"plot_ref":"A"},"geometry":{"type":"Polygon","coordinates":[[[-7.560000,6.240000],[-7.550000,6.240000],[-7.550000,6.250000],[-7.560000,6.240000]]]}}]}');
    expect(six.ok && six.features[0]!.report.issues.some((i) => i.code === 'low_precision')).toBe(false);
    const coarse = parsePlotsGeoJson('{"type":"Feature","properties":{"plot_ref":"A"},"geometry":{"type":"Polygon","coordinates":[[[-7.56,6.24],[-7.55,6.24],[-7.55,6.25],[-7.56,6.24]]]}}');
    expect(coarse.ok && coarse.features[0]!.report.issues.some((i) => i.code === 'low_precision')).toBe(true);
  });
  it('rejects duplicate plot refs and non-JSON', () => {
    const r = parsePlotsGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { plot_ref: 'A' }, geometry: sq(0, 0) }, { type: 'Feature', properties: { plot_ref: 'A' }, geometry: sq(1, 1) }] }));
    expect(r.ok && r.features[1]!.issues.map((i) => i.code)).toContain('duplicate_plot_ref');
    expect(parsePlotsGeoJson('not json').ok).toBe(false);
  });
});

function baseInput(over: Partial<EvaluationInput> = {}): EvaluationInput {
  const csv = parseSourcesCsv('supplier_id,supplier_name,source_lot_ref,source_lot_declared_quantity,allocated_quantity,quantity_unit,producer_country,plot_refs\nS1,,L1,1000,600,kg,CI,P1\n');
  if (!csv.ok) throw new Error();
  const plots = parsePlotsGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { plot_ref: 'P1', ProducerCountry: 'CI' }, geometry: sq(-6.5, 6.0, 0.001) }] }));
  if (!plots.ok) throw new Error();
  const f = (value: string) => ({ value, source: 'manual' as const, revision: 1 });
  return {
    shipment: { id: 's', reference: 'T', fields: { activityType: f('IMPORT'), hsCode: f('1801'), description: f('test'), netMassValue: f('600'), netMassUnit: f('kg'), operatorName: f('op'), operatorEori: f('BE0'), countryOfActivity: f('BE') } },
    sources: { uploadId: 'u1', filename: 'src.csv', sha256: 'x', rows: csv.rows },
    plots: { uploadId: 'u2', filename: 'plots.geojson', sha256: 'y', features: plots.features },
    env: { P1: { state: 'done', status: 'NO_POST_2020_LOSS_OBSERVED', summary: 'none', resultId: 'r1', geometryHash: 'g', postCutoffLossHa: 0, years: null } },
    ledger: { 'S1::L1': { sourceLotKey: 'S1::L1', registeredDeclaredGrams: 1_000_000, registeredFromUpload: 'u1', reservedByOtherShipmentsGrams: 0, reservedByThisShipmentGrams: 600_000 } },
    decisions: [],
    ...over,
  };
}

describe('decision engine', () => {
  it('reaches READY_FOR_SIGN_OFF only when every dimension is clear', () => {
    const e = evaluate(baseInput());
    expect(e.findings.filter((f) => f.severity === 'hold')).toEqual([]);
    expect(e.readiness).toMatchObject({ record: 'COMPLETE', environment: 'NO_POST_2020_LOSS_OBSERVED', allocation: 'RESERVED', overall: 'READY_FOR_SIGN_OFF' });
  });
  it('holds on excess allocation with exact arithmetic and row links', () => {
    const e = evaluate(baseInput({ ledger: { 'S1::L1': { sourceLotKey: 'S1::L1', registeredDeclaredGrams: 1_000_000, registeredFromUpload: 'u0', reservedByOtherShipmentsGrams: 600_000, reservedByThisShipmentGrams: 0 } } }));
    const f = e.findings.find((x) => x.ruleId === 'ALLOC-EXCESS')!;
    expect(f.message).toContain('exceeding the declared balance by 200 kg');
    expect(f.refs[0]).toMatchObject({ kind: 'sources_csv', row: 2, column: 'allocated_quantity' });
    expect(e.readiness.overall).toBe('HOLD');
  });
  it('holds when a later file re-declares a lot differently (first record kept)', () => {
    const e = evaluate(baseInput({ ledger: { 'S1::L1': { sourceLotKey: 'S1::L1', registeredDeclaredGrams: 900_000, registeredFromUpload: 'u0', reservedByOtherShipmentsGrams: 0, reservedByThisShipmentGrams: 0 } } }));
    expect(e.findings.map((x) => x.ruleId)).toContain('ALLOC-REG-MISMATCH');
  });
  it('never treats missing or unavailable environmental data as a clear result', () => {
    for (const env of [
      { state: 'failed', error: 'boom' },
      { state: 'done', status: 'UNAVAILABLE', summary: 'x', resultId: 'r', geometryHash: 'g', postCutoffLossHa: 0, years: null },
      { state: 'done', status: 'PLOT_OUTSIDE_COVERAGE', summary: 'x', resultId: 'r', geometryHash: 'g', postCutoffLossHa: 0, years: null },
      { state: 'done', status: 'PARTIAL_COVERAGE', summary: 'x', resultId: 'r', geometryHash: 'g', postCutoffLossHa: 0, years: null },
    ] as const) {
      const e = evaluate(baseInput({ env: { P1: env as never } }));
      expect(e.readiness.environment).toBe('UNAVAILABLE');
      expect(e.readiness.overall).not.toBe('READY_FOR_SIGN_OFF');
    }
    const pending = evaluate(baseInput({ env: { P1: { state: 'queued' } } }));
    expect(pending.readiness.environment).toBe('IN_PROGRESS');
    expect(pending.readiness.overall).toBe('NEEDS_HUMAN_REVIEW');
  });
  it('a land-change signal needs rationale AND evidence before it stops blocking', () => {
    const signal = { P1: { state: 'done', status: 'NEEDS_HUMAN_REVIEW', summary: 'loss', resultId: 'r1', geometryHash: 'g', postCutoffLossHa: 1.2, years: '2023' } } as const;
    expect(evaluate(baseInput({ env: signal as never })).readiness.overall).toBe('NEEDS_HUMAN_REVIEW');
    const noEvidence = evaluate(baseInput({ env: signal as never, decisions: [{ findingKey: 'ENV:P1', decision: 'investigated_not_blocking', rationale: 'x'.repeat(60), evidenceUploadId: null, reviewerName: 'r', createdAt: 't' }] }));
    expect(noEvidence.readiness.environment).toBe('NEEDS_REVIEW');
    const shortRationale = evaluate(baseInput({ env: signal as never, decisions: [{ findingKey: 'ENV:P1', decision: 'investigated_not_blocking', rationale: 'ok', evidenceUploadId: 'ev', reviewerName: 'r', createdAt: 't' }] }));
    expect(shortRationale.readiness.environment).toBe('NEEDS_REVIEW');
    const ok = evaluate(baseInput({ env: signal as never, decisions: [{ findingKey: 'ENV:P1', decision: 'investigated_not_blocking', rationale: 'Supplier land-use record shows replanting of an existing cocoa farm in 2023.', evidenceUploadId: 'ev', reviewerName: 'r', createdAt: 't' }] }));
    expect(ok.readiness).toMatchObject({ environment: 'REVIEWED_WITH_EVIDENCE', overall: 'READY_FOR_SIGN_OFF' });
    const kept = evaluate(baseInput({ env: signal as never, decisions: [{ findingKey: 'ENV:P1', decision: 'keep_on_hold', rationale: 'unexplained clearing', evidenceUploadId: null, reviewerName: 'r', createdAt: 't' }] }));
    expect(kept.readiness.overall).toBe('HOLD');
  });
  it('holds on missing plot geometry and on unsupported product', () => {
    const noGeom = evaluate(baseInput({ plots: { uploadId: 'u2', filename: 'p.geojson', sha256: 'y', features: [] } }));
    expect(noGeom.findings.find((f) => f.ruleId === 'PLOT-MISSING')?.refs[0]).toMatchObject({ row: 2, column: 'plot_refs' });
    const input = baseInput();
    input.shipment.fields.hsCode = { value: '1806', source: 'manual', revision: 2 };
    const ns = evaluate(input);
    expect(ns.readiness.record).toBe('NOT_SUPPORTED');
  });
  it('flags shipment net mass that does not match allocations', () => {
    const input = baseInput();
    input.shipment.fields.netMassValue = { value: '700', source: 'manual', revision: 2 };
    expect(evaluate(input).findings.map((f) => f.ruleId)).toContain('ALLOC-SHIP-TOTAL');
  });
  it('is deterministic', () => {
    expect(JSON.stringify(evaluate(baseInput()))).toBe(JSON.stringify(evaluate(baseInput())));
  });
});
