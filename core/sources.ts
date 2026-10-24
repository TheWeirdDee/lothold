// Deterministic parsers for the two structured upload formats.
// Parsers never invent values: missing cells stay missing and are reported with their row/column.
import Papa from 'papaparse';
import { parseQuantity, type ParsedQuantity } from './quantity.ts';
import { ISO_ALPHA2 } from './reference.ts';
import { validatePlotGeometry, type GeometryReport } from './geometry.ts';
import { COUNTRY_BBOX } from './reference.ts';

export const SOURCES_PARSER_VERSION = 'sources-csv/2026-10-24.1';
export const PLOTS_PARSER_VERSION = 'plots-geojson/2026-10-24.1';
export const MAX_CSV_ROWS = 2_000;
export const MAX_FEATURES = 1_000;

export const SOURCE_COLUMNS = [
  { name: 'supplier_id', required: true, description: 'Identifier of the supplier, cooperative or producer group as used in your records.' },
  { name: 'supplier_name', required: false, description: 'Supplier name (kept private; never written on-chain).' },
  { name: 'source_lot_ref', required: true, description: 'The supplier’s source lot / batch reference that this shipment draws from.' },
  { name: 'source_lot_declared_quantity', required: true, description: 'Total quantity the supplier declared for that source lot.' },
  { name: 'allocated_quantity', required: true, description: 'Quantity of that source lot allocated to this shipment.' },
  { name: 'quantity_unit', required: true, description: 'Unit for both quantities: kg, t (metric tonnes) or g.' },
  { name: 'producer_country', required: true, description: 'ISO 3166-1 alpha-2 country of production, e.g. CI or GH.' },
  { name: 'plot_refs', required: true, description: 'Semicolon-separated plot references; each must match a plot_ref in the plots GeoJSON.' },
] as const;

export type CellRef = { row: number; column: string };

export type SourceRowIssue = {
  code: string;
  severity: 'hold' | 'warning';
  column: string;
  message: string;
  original: string;
};

export type SourceRow = {
  row: number; // 1-based data row number as shown in a spreadsheet (header = row 1, first data row = 2)
  raw: Record<string, string>;
  supplierId: string | null;
  supplierName: string | null;
  sourceLotRef: string | null;
  declaredQuantity: ParsedQuantity;
  allocatedQuantity: ParsedQuantity;
  producerCountry: string | null;
  plotRefs: string[];
  issues: SourceRowIssue[];
};

export type SourcesParse =
  | { ok: true; parserVersion: string; rows: SourceRow[]; headerIssues: string[]; extraColumns: string[] }
  | { ok: false; parserVersion: string; error: string };

function clean(v: unknown): string {
  return typeof v === 'string' ? v.replace(/^﻿/, '').trim() : '';
}

export function parseSourcesCsv(text: string): SourcesParse {
  const parserVersion = SOURCES_PARSER_VERSION;
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const fields = (parsed.meta.fields ?? []).map((f) => f.trim().toLowerCase());
  const missing = SOURCE_COLUMNS.filter((c) => c.required && !fields.includes(c.name)).map((c) => c.name);
  if (fields.length === 0) return { ok: false, parserVersion, error: 'The file has no header row.' };
  if (missing.length) {
    return {
      ok: false,
      parserVersion,
      error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the blank template to see the expected header row.`,
    };
  }
  const fatal = parsed.errors.find((e) => e.type === 'Delimiter' || e.code === 'UndetectableDelimiter');
  if (fatal) return { ok: false, parserVersion, error: `Could not read CSV structure: ${fatal.message}` };
  if (parsed.data.length > MAX_CSV_ROWS) return { ok: false, parserVersion, error: `The file has ${parsed.data.length} data rows; the limit is ${MAX_CSV_ROWS}.` };
  if (parsed.data.length === 0) return { ok: false, parserVersion, error: 'The file has a header row but no data rows.' };

  const headerIssues = parsed.errors
    .filter((e) => e.type === 'FieldMismatch')
    .map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  const known = new Set<string>(SOURCE_COLUMNS.map((c) => c.name));
  const extraColumns = fields.filter((f) => !known.has(f));

  const rows: SourceRow[] = parsed.data.map((r, i) => {
    const raw: Record<string, string> = {};
    for (const f of fields) raw[f] = clean(r[f]);
    const issues: SourceRowIssue[] = [];
    const req = (col: string, label: string) => {
      if (!raw[col]) issues.push({ code: `missing_${col}`, severity: 'hold', column: col, message: `${label} is empty.`, original: '' });
      return raw[col] || null;
    };
    const supplierId = req('supplier_id', 'Supplier ID');
    const sourceLotRef = req('source_lot_ref', 'Source lot reference');
    const declaredQuantity = parseQuantity(raw.source_lot_declared_quantity, raw.quantity_unit);
    const allocatedQuantity = parseQuantity(raw.allocated_quantity, raw.quantity_unit);
    if (!declaredQuantity.ok)
      issues.push({ code: `quantity_${declaredQuantity.reason}`, severity: 'hold', column: declaredQuantity.reason === 'unknown_unit' ? 'quantity_unit' : 'source_lot_declared_quantity', message: `Declared lot quantity: ${declaredQuantity.message}`, original: raw.source_lot_declared_quantity ?? '' });
    if (!allocatedQuantity.ok && !(allocatedQuantity.reason === 'unknown_unit' && !declaredQuantity.ok && declaredQuantity.reason === 'unknown_unit'))
      issues.push({ code: `quantity_${allocatedQuantity.reason}`, severity: 'hold', column: allocatedQuantity.reason === 'unknown_unit' ? 'quantity_unit' : 'allocated_quantity', message: `Allocated quantity: ${allocatedQuantity.message}`, original: raw.allocated_quantity ?? '' });
    if (declaredQuantity.ok && allocatedQuantity.ok && allocatedQuantity.grams > declaredQuantity.grams)
      issues.push({
        code: 'allocation_exceeds_declared_in_row',
        severity: 'hold',
        column: 'allocated_quantity',
        message: `Allocated quantity (${raw.allocated_quantity} ${raw.quantity_unit}) exceeds the declared source-lot quantity (${raw.source_lot_declared_quantity} ${raw.quantity_unit}).`,
        original: raw.allocated_quantity ?? '',
      });
    const countryRaw = raw.producer_country ?? '';
    let producerCountry: string | null = null;
    if (!countryRaw) issues.push({ code: 'missing_producer_country', severity: 'hold', column: 'producer_country', message: 'Producer country is empty.', original: '' });
    else if (!ISO_ALPHA2.has(countryRaw.toUpperCase()))
      issues.push({ code: 'invalid_producer_country', severity: 'hold', column: 'producer_country', message: `"${countryRaw}" is not an ISO 3166-1 alpha-2 country code.`, original: countryRaw });
    else producerCountry = countryRaw.toUpperCase();
    const plotRefs = (raw.plot_refs ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    if (plotRefs.length === 0) issues.push({ code: 'missing_plot_refs', severity: 'hold', column: 'plot_refs', message: 'No plot reference is listed for this source lot.', original: raw.plot_refs ?? '' });
    const dupes = plotRefs.filter((p, j) => plotRefs.indexOf(p) !== j);
    if (dupes.length) issues.push({ code: 'duplicate_plot_ref', severity: 'warning', column: 'plot_refs', message: `Plot reference listed twice: ${[...new Set(dupes)].join(', ')}.`, original: raw.plot_refs ?? '' });
    return {
      row: i + 2,
      raw,
      supplierId,
      supplierName: raw.supplier_name || null,
      sourceLotRef,
      declaredQuantity,
      allocatedQuantity,
      producerCountry,
      plotRefs: [...new Set(plotRefs)],
      issues,
    };
  });
  return { ok: true, parserVersion, rows, headerIssues, extraColumns };
}

export type PlotFeature = {
  featureIndex: number;
  plotRef: string | null;
  plotRefSource: 'plot_ref' | 'ProductionPlace' | null;
  producerCountry: string | null;
  producerName: string | null;
  declaredAreaHa: unknown;
  geometry: unknown;
  report: GeometryReport;
  issues: { code: string; severity: 'hold' | 'warning'; message: string }[];
};

export type PlotsParse =
  | { ok: true; parserVersion: string; features: PlotFeature[]; crs: unknown }
  | { ok: false; parserVersion: string; error: string };

export function parsePlotsGeoJson(text: string): PlotsParse {
  const parserVersion = PLOTS_PARSER_VERSION;
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    return { ok: false, parserVersion, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!doc || typeof doc !== 'object') return { ok: false, parserVersion, error: 'The file does not contain a GeoJSON object.' };
  const d = doc as { type?: string; features?: unknown; crs?: unknown };
  let rawFeatures: unknown[];
  if (d.type === 'FeatureCollection') {
    if (!Array.isArray(d.features)) return { ok: false, parserVersion, error: 'FeatureCollection has no "features" array.' };
    rawFeatures = d.features;
  } else if (d.type === 'Feature') rawFeatures = [d];
  else return { ok: false, parserVersion, error: `Expected a FeatureCollection or Feature; found type "${String(d.type)}". Each plot must be a Feature with a "plot_ref" property.` };
  if (rawFeatures.length === 0) return { ok: false, parserVersion, error: 'The FeatureCollection contains no features.' };
  if (rawFeatures.length > MAX_FEATURES) return { ok: false, parserVersion, error: `The file has ${rawFeatures.length} features; the limit is ${MAX_FEATURES}.` };

  // Count numeric literals inside arrays (coordinate positions) exactly as written in the file.
  let coarse = 0, total = 0;
  for (const m of text.matchAll(/[\[,]\s*-?\d+(?:\.(\d+))?(?:[eE][-+]?\d+)?\s*(?=[,\]])/g)) {
    total++;
    if ((m[1]?.length ?? 0) < 6) coarse++;
  }
  const rawPrecision = { coarse, total };
  const features: PlotFeature[] = rawFeatures.map((f, i) => {
    const feat = (f ?? {}) as { type?: string; properties?: Record<string, unknown> | null; geometry?: unknown };
    const props = feat.properties ?? {};
    const issues: PlotFeature['issues'] = [];
    const ref = typeof props.plot_ref === 'string' && props.plot_ref.trim() ? props.plot_ref.trim() : null;
    const place = typeof props.ProductionPlace === 'string' && props.ProductionPlace.trim() ? props.ProductionPlace.trim() : null;
    const plotRef = ref ?? place;
    if (!plotRef) issues.push({ code: 'missing_plot_ref', severity: 'hold', message: 'Feature has no "plot_ref" (or "ProductionPlace") property, so it cannot be linked to a source row.' });
    const pc = typeof props.ProducerCountry === 'string' ? props.ProducerCountry.trim().toUpperCase() : null;
    if (pc && !ISO_ALPHA2.has(pc)) issues.push({ code: 'invalid_producer_country', severity: 'hold', message: `ProducerCountry "${props.ProducerCountry as string}" is not an ISO 3166-1 alpha-2 code.` });
    for (const k of Object.keys(props)) {
      if (['productionplace', 'producercountry', 'producername', 'area'].includes(k.toLowerCase()) && !['ProductionPlace', 'ProducerCountry', 'ProducerName', 'Area'].includes(k))
        issues.push({ code: 'property_case', severity: 'warning', message: `Property "${k}" has the wrong letter case; the EUDR system only recognises "${k[0]!.toUpperCase()}${k.slice(1)}"-style names (ProductionPlace, ProducerCountry, ProducerName, Area).` });
    }
    const country = pc && ISO_ALPHA2.has(pc) ? pc : null;
    const report = validatePlotGeometry(feat.geometry, {
      declaredAreaHa: props.Area,
      expectedBbox: country ? COUNTRY_BBOX[country] ?? null : null,
      crs: d.crs,
      rawPrecision,
    });
    return {
      featureIndex: i,
      plotRef,
      plotRefSource: ref ? 'plot_ref' : place ? 'ProductionPlace' : null,
      producerCountry: country,
      producerName: typeof props.ProducerName === 'string' ? props.ProducerName : null,
      declaredAreaHa: props.Area,
      geometry: feat.geometry ?? null,
      report,
      issues,
    };
  });
  const seen = new Map<string, number>();
  for (const f of features) {
    if (!f.plotRef) continue;
    if (seen.has(f.plotRef)) f.issues.push({ code: 'duplicate_plot_ref', severity: 'hold', message: `plot_ref "${f.plotRef}" also appears on feature ${seen.get(f.plotRef)! + 1}. Each plot needs a unique reference.` });
    else seen.set(f.plotRef, f.featureIndex);
  }
  return { ok: true, parserVersion, features, crs: d.crs ?? null };
}

export function blankSourcesTemplate(): string {
  return SOURCE_COLUMNS.map((c) => c.name).join(',') + '\n';
}
