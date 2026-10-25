// Engineering regression tests for the build audit of 25 October 2026 (geometry and ingestion findings 5, 6, 7, 9,
// 10 and 18). All inputs are invented test values; coordinates are probe shapes, not farms.
import { describe, expect, it } from 'vitest';
import { validatePlotGeometry, pointOnSurface, interiorPoints, pointInRing, type Position } from '../../core/geometry.ts';
import { parseSourcesCsv, parsePlotsGeoJson } from '../../core/sources.ts';

const HEADER = 'supplier_id,supplier_name,source_lot_ref,source_lot_declared_quantity,allocated_quantity,quantity_unit,producer_country,plot_refs';
const sq = (x: number, y: number, d: number) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];

describe('build audit: geometry', () => {
  it('finding 5: the sample point of a concave plot lies inside it, unlike the vertex mean', () => {
    // A thin "U": the vertex mean falls in the empty middle of the U.
    const u = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]].map(([x, y]): Position => [-7.2 + x! * 0.0001, 5.75 + y! * 0.0001]);
    const mean = u.slice(0, -1).reduce((s, p) => [s[0]! + p[0]! / 8, s[1]! + p[1]! / 8], [0, 0]);
    expect(pointInRing(mean[0]!, mean[1]!, u)).toBe(false);
    const p = pointOnSurface(u)!;
    expect(p).not.toBeNull();
    expect(pointInRing(p[0]!, p[1]!, u)).toBe(true);
  });
  it('finding 5: every MultiPolygon component gets its own interior sample point', () => {
    const g = { type: 'MultiPolygon' as const, coordinates: [[sq(-7.2, 5.75, 0.0001)], [sq(-7.19, 5.75, 0.0001)]] };
    const pts = interiorPoints(g as never);
    expect(pts).toHaveLength(2);
    g.coordinates.forEach((rings, i) => expect(pointInRing(pts[i]![0]!, pts[i]![1]!, rings[0] as never)).toBe(true));
  });
  it('finding 6: overlapping or duplicated MultiPolygon parts are rejected; separate and touching parts are fine', () => {
    const a = sq(-7.2, 5.75, 0.01);
    const dup = validatePlotGeometry({ type: 'MultiPolygon', coordinates: [[a], [a]] });
    expect(dup.valid).toBe(false);
    expect(dup.issues.map((i) => i.code)).toContain('multipolygon_overlap');
    const overlap = validatePlotGeometry({ type: 'MultiPolygon', coordinates: [[a], [sq(-7.195, 5.755, 0.01)]] });
    expect(overlap.issues.map((i) => i.code)).toContain('multipolygon_overlap');
    const inside = validatePlotGeometry({ type: 'MultiPolygon', coordinates: [[a], [sq(-7.198, 5.752, 0.002)]] });
    expect(inside.issues.map((i) => i.code)).toContain('multipolygon_overlap');
    const apart = validatePlotGeometry({ type: 'MultiPolygon', coordinates: [[a], [sq(-7.15, 5.75, 0.01)]] });
    expect(apart.issues.map((i) => i.code)).not.toContain('multipolygon_overlap');
    const touching = validatePlotGeometry({ type: 'MultiPolygon', coordinates: [[a], [sq(-7.19, 5.75, 0.01)]] });
    expect(touching.issues.map((i) => i.code)).not.toContain('multipolygon_overlap');
  });
});

describe('build audit: ingestion', () => {
  it('finding 7: a row with an extra value or a broken quote rejects the whole file', () => {
    const extra = parseSourcesCsv(`${HEADER}\nENG-S,ENG,ENG-L,1000,600,kg,CI,ENG-P,unexpected\n`);
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.error).toMatch(/structure is broken/);
    const quote = parseSourcesCsv(`${HEADER}\nENG-S,"ENG unterminated,ENG-L,1000,600,kg,CI,ENG-P\n`);
    expect(quote.ok).toBe(false);
  });
  it('finding 10: "::" in a supplier or lot identifier is a hold', () => {
    const r = parseSourcesCsv(`${HEADER}\nA::B,ENG,C,1000,600,kg,CI,ENG-P\nA,ENG,B::C,1000,600,kg,CI,ENG-P\n`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0]!.issues.map((i) => i.code)).toContain('reserved_separator');
      expect(r.rows[1]!.issues.map((i) => i.code)).toContain('reserved_separator');
    }
  });
  it('finding 9: a FeatureCollection member that is not a Feature is a hold', () => {
    const r = parsePlotsGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Banana', properties: { plot_ref: 'ENG-P' }, geometry: { type: 'Polygon', coordinates: [sq(-7.2, 5.75, 0.01)] } }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.features[0]!.issues.map((i) => i.code)).toContain('not_a_feature');
    const props = parsePlotsGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: ['x'], geometry: { type: 'Polygon', coordinates: [sq(-7.2, 5.75, 0.01)] } }] }));
    if (props.ok) expect(props.features[0]!.issues.map((i) => i.code)).toContain('invalid_properties');
  });
  it('finding 18: coordinate precision is judged per plot, not across the whole file', () => {
    const precise = '[[-7.200000,5.750000],[-7.190000,5.750000],[-7.190000,5.760000],[-7.200000,5.760000],[-7.200000,5.750000]]';
    const coarse = '[[-7.1,5.7],[-7.09,5.7],[-7.09,5.71],[-7.1,5.71],[-7.1,5.7]]';
    const text = `{"type":"FeatureCollection","features":[
      {"type":"Feature","properties":{"plot_ref":"ENG-PRECISE","note":[1,2,3]},"geometry":{"type":"Polygon","coordinates":[${precise}]}},
      {"type":"Feature","properties":{"plot_ref":"ENG-COARSE"},"geometry":{"type":"Polygon","coordinates":[${coarse}]}}]}`;
    const r = parsePlotsGeoJson(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = (ref: string) => r.features.find((f) => f.plotRef === ref)!.report.issues.map((i) => i.code);
      expect(codes('ENG-PRECISE')).not.toContain('low_precision');
      expect(codes('ENG-COARSE')).toContain('low_precision');
    }
  });
});
