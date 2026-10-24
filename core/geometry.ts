// Deterministic GeoJSON plot validation following the EUDR Information System GeoJSON description
// (retrieved 2026-10-23, "Updated 17 August 2026"). Coordinates are never silently swapped or repaired.
import area from '@turf/area';
import kinks from '@turf/kinks';
import { polygon as turfPolygon } from '@turf/helpers';

export const GEOMETRY_RULES_VERSION = 'geometry-rules/2026-10-23.1';
export const POLYGON_REQUIRED_ABOVE_HA = 4;
export const MAX_VERTICES_PER_PLOT = 20_000;
export const MIN_POINT_AREA_HA = 0.0001;

export type Position = [number, number];
export type PlotGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export type GeometryIssueCode =
  | 'missing_geometry'
  | 'unsupported_type'
  | 'malformed_coordinates'
  | 'out_of_bounds'
  | 'possible_lat_lon_swap'
  | 'ring_not_closed'
  | 'too_few_positions'
  | 'self_intersection'
  | 'holes_not_supported'
  | 'degenerate_after_truncation'
  | 'zero_area'
  | 'too_many_vertices'
  | 'low_precision'
  | 'point_requires_polygon'
  | 'point_area_missing'
  | 'point_area_invalid'
  | 'crs_not_wgs84';

export type GeometryIssue = {
  code: GeometryIssueCode;
  severity: 'hold' | 'warning';
  message: string;
  /** JSON-pointer-like path into the source geometry, e.g. "coordinates/0/3". */
  path?: string;
  /** Explicit correction a reviewer may choose to apply; never applied automatically. */
  proposedCorrection?: { kind: 'swap_axes'; geometry: PlotGeometry; explanation: string };
};

export type GeometryReport = {
  rulesVersion: string;
  valid: boolean;
  geometryType: string | null;
  vertexCount: number;
  areaHa: number | null;
  declaredAreaHa: number | null;
  bbox: [number, number, number, number] | null;
  issues: GeometryIssue[];
};

function isPosition(p: unknown): p is number[] {
  return Array.isArray(p) && p.length >= 2 && p.length <= 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
}


function truncate6(n: number): number {
  return Math.trunc(n * 1e6) / 1e6;
}

function walkPositions(geom: PlotGeometry): Position[] {
  if (geom.type === 'Point') return [geom.coordinates];
  if (geom.type === 'Polygon') return geom.coordinates.flat();
  return geom.coordinates.flat(2);
}

function swapGeometry(geom: PlotGeometry): PlotGeometry {
  const sw = (p: Position): Position => [p[1], p[0]];
  if (geom.type === 'Point') return { type: 'Point', coordinates: sw(geom.coordinates) };
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map((r) => r.map(sw)) };
  return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map((r) => r.map(sw))) };
}

/**
 * Validates the shape of an untrusted geometry object. `declaredAreaHa` is the GeoJSON "Area" property
 * (hectares) which the EUDR system requires for points. `expectedCountryBbox` lets the caller detect
 * a likely axis swap when the declared production country is known.
 */
export function validatePlotGeometry(
  raw: unknown,
  opts: { declaredAreaHa?: unknown; expectedBbox?: [number, number, number, number] | null; crs?: unknown; rawPrecision?: { coarse: number; total: number } } = {},
): GeometryReport {
  const issues: GeometryIssue[] = [];
  const report = (geometryType: string | null, extra: Partial<GeometryReport> = {}): GeometryReport => ({
    rulesVersion: GEOMETRY_RULES_VERSION,
    valid: !issues.some((i) => i.severity === 'hold'),
    geometryType,
    vertexCount: 0,
    areaHa: null,
    declaredAreaHa: null,
    bbox: null,
    issues,
    ...extra,
  });

  if (opts.crs !== undefined && opts.crs !== null) {
    const name = JSON.stringify(opts.crs);
    if (!/4326|CRS84|WGS ?84/i.test(name)) {
      issues.push({
        code: 'crs_not_wgs84',
        severity: 'hold',
        message: `The file declares a coordinate reference system (${name.slice(0, 80)}) other than WGS 84. Convert it to EPSG:4326 longitude/latitude before uploading; LotHold does not reproject undeclared or projected coordinates.`,
      });
      return report(null);
    }
  }

  if (raw == null || typeof raw !== 'object') {
    issues.push({ code: 'missing_geometry', severity: 'hold', message: 'No geometry was provided for this plot.' });
    return report(null);
  }
  const g = raw as { type?: unknown; coordinates?: unknown };
  const type = typeof g.type === 'string' ? g.type : null;
  if (type !== 'Point' && type !== 'Polygon' && type !== 'MultiPolygon') {
    issues.push({
      code: 'unsupported_type',
      severity: 'hold',
      message: `Geometry type "${String(g.type)}" is not accepted. Use Point, Polygon or MultiPolygon (LineString is not a production place).`,
    });
    return report(type);
  }

  // Structural check.
  const c = g.coordinates;
  let ok = false;
  if (type === 'Point') ok = isPosition(c);
  if (type === 'Polygon') ok = Array.isArray(c) && c.length > 0 && c.every((r) => Array.isArray(r) && r.every(isPosition));
  if (type === 'MultiPolygon')
    ok =
      Array.isArray(c) &&
      c.length > 0 &&
      c.every((p) => Array.isArray(p) && p.length > 0 && p.every((r) => Array.isArray(r) && r.every(isPosition)));
  if (!ok) {
    issues.push({ code: 'malformed_coordinates', severity: 'hold', message: `The ${type} coordinates array is malformed or contains non-numeric values.` });
    return report(type);
  }
  const geom = { type, coordinates: c } as PlotGeometry;
  const positions = walkPositions(geom);
  const vertexCount = positions.length;
  if (vertexCount > MAX_VERTICES_PER_PLOT) {
    issues.push({ code: 'too_many_vertices', severity: 'hold', message: `Plot has ${vertexCount} vertices; the supported limit is ${MAX_VERTICES_PER_PLOT}.` });
    return report(type, { vertexCount });
  }

  // Bounds and axis order.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  positions.forEach((p, i) => {
    const [x, y] = p;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < -180 || x > 180 || y < -90 || y > 90) {
      if (!issues.some((iss) => iss.code === 'out_of_bounds'))
        issues.push({
          code: 'out_of_bounds',
          severity: 'hold',
          message: `Coordinate ${i + 1} (${x}, ${y}) is outside longitude −180…180 / latitude −90…90.`,
          path: `coordinates[${i}]`,
        });
    }
  });
  const bbox: [number, number, number, number] = [minX, minY, maxX, maxY];
  const swapped = swapGeometry(geom);
  const inBox = (b: [number, number, number, number], ps: Position[]) =>
    ps.every(([x, y]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
  const swapProposal = {
    kind: 'swap_axes' as const,
    geometry: swapped,
    explanation: 'Every coordinate pair is read as (latitude, longitude). GeoJSON requires (longitude, latitude). Confirm with the supplier before applying.',
  };
  if (opts.expectedBbox) {
    const fitsAsIs = inBox(opts.expectedBbox, positions);
    const fitsSwapped = inBox(opts.expectedBbox, walkPositions(swapped));
    if (!fitsAsIs && fitsSwapped) {
      issues.push({
        code: 'possible_lat_lon_swap',
        severity: 'hold',
        message: 'The coordinates fall outside the declared production country, but would fall inside it if longitude and latitude were exchanged. LotHold has not changed them.',
        proposedCorrection: swapProposal,
      });
    } else if (!fitsAsIs && !issues.some((i) => i.code === 'out_of_bounds')) {
      issues.push({
        code: 'out_of_bounds',
        severity: 'hold',
        message: 'The geometry lies outside the bounding box of the declared production country.',
      });
    }
  } else if (issues.some((i) => i.code === 'out_of_bounds') && walkPositions(swapped).every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90)) {
    issues.push({
      code: 'possible_lat_lon_swap',
      severity: 'hold',
      message: 'Latitude values exceed ±90 but would be valid if longitude and latitude were exchanged. LotHold has not changed them.',
      proposedCorrection: swapProposal,
    });
  }

  // Precision is judged from the raw file text by the parser (JSON parsing drops trailing zeros).
  if (opts.rawPrecision && opts.rawPrecision.coarse > 0) {
    issues.push({
      code: 'low_precision',
      severity: 'warning',
      message: `${opts.rawPrecision.coarse} of ${opts.rawPrecision.total} coordinate values in the file are written with fewer than 6 decimal places. The EUDR Information System expects at least 6 (about 0.1 m); ask the supplier for the surveyed precision.`,
    });
  }

  let areaHa: number | null = null;
  let declaredAreaHa: number | null = null;

  if (geom.type === 'Point') {
    const a = opts.declaredAreaHa;
    if (a === undefined || a === null || a === '') {
      issues.push({
        code: 'point_area_missing',
        severity: 'hold',
        message: 'A point is only acceptable for plots of 4 ha or less, and its "Area" (hectares) is missing. Supply the plot area, or a polygon.',
      });
    } else if (typeof a !== 'number' || !Number.isFinite(a)) {
      issues.push({
        code: 'point_area_invalid',
        severity: 'hold',
        message: `"Area" must be a JSON number in hectares; received ${JSON.stringify(a)}. A quoted value such as "3" is read as 0 by the EUDR system.`,
      });
    } else if (a < MIN_POINT_AREA_HA) {
      issues.push({ code: 'point_area_invalid', severity: 'hold', message: `"Area" must be at least ${MIN_POINT_AREA_HA} ha; received ${a}.` });
    } else {
      declaredAreaHa = a;
      if (a > POLYGON_REQUIRED_ABOVE_HA)
        issues.push({
          code: 'point_requires_polygon',
          severity: 'hold',
          message: `Declared area ${a} ha exceeds ${POLYGON_REQUIRED_ABOVE_HA} ha, so a polygon boundary is required for cocoa. LotHold will not generate one.`,
        });
    }
    return report(type, { vertexCount, bbox, declaredAreaHa });
  }

  const polygons: Position[][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let total = 0;
  polygons.forEach((rings, pi) => {
    const prefix = geom.type === 'MultiPolygon' ? `coordinates[${pi}]` : 'coordinates';
    if (rings.length > 1) {
      issues.push({
        code: 'holes_not_supported',
        severity: 'hold',
        message: 'Polygons with holes are not accepted by the EUDR Information System. Split the shape into two polygons without holes.',
        path: `${prefix}[1]`,
      });
    }
    const ring = rings[0]!;
    if (ring.length < 4) {
      issues.push({ code: 'too_few_positions', severity: 'hold', message: `A polygon ring needs at least 4 positions; this one has ${ring.length}.`, path: `${prefix}[0]` });
      return;
    }
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      issues.push({
        code: 'ring_not_closed',
        severity: 'hold',
        message: 'The polygon is open: its first and last coordinates differ. Close it at the source; LotHold does not append a closing point.',
        path: `${prefix}[0]`,
      });
      return;
    }
    const truncated = ring.map((p) => [truncate6(p[0]), truncate6(p[1])] as Position);
    const unique = new Set(truncated.slice(0, -1).map((p) => `${p[0]},${p[1]}`));
    if (unique.size < truncated.length - 1) {
      issues.push({
        code: 'degenerate_after_truncation',
        severity: 'hold',
        message: 'Two or more vertices become identical when truncated to 6 decimals, as the EUDR system does; this can produce an invalid polygon.',
        path: `${prefix}[0]`,
      });
    }
    let poly;
    try {
      poly = turfPolygon([ring.map((p) => [p[0], p[1]])]);
    } catch (e) {
      issues.push({ code: 'malformed_coordinates', severity: 'hold', message: `Polygon could not be constructed: ${(e as Error).message}` });
      return;
    }
    const k = kinks(poly);
    if (k.features.length > 0) {
      const pt = k.features[0]!.geometry.coordinates;
      issues.push({
        code: 'self_intersection',
        severity: 'hold',
        message: `The boundary crosses itself near (${pt[0]!.toFixed(6)}, ${pt[1]!.toFixed(6)}). Self-intersecting ("figure eight") polygons are invalid.`,
        path: `${prefix}[0]`,
      });
    }
    const a = area(poly) / 10_000;
    if (!(a > 0) && k.features.length === 0) issues.push({ code: 'zero_area', severity: 'hold', message: 'The polygon encloses no area (all points on a line).', path: `${prefix}[0]` });
    total += a;
  });
  // Area of a self-intersecting or open ring is meaningless; report it as unknown rather than 0.
  areaHa = issues.some((i) => ['self_intersection', 'ring_not_closed', 'too_few_positions', 'malformed_coordinates'].includes(i.code)) ? null : Math.round(total * 10_000) / 10_000;
  return report(type, { vertexCount, bbox, areaHa, declaredAreaHa });
}

export function geometryFromValidated(raw: unknown): PlotGeometry {
  return raw as PlotGeometry;
}

/** Ray-casting point-in-ring test in planar lon/lat (adequate at plot scale). */
export function pointInRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0], yi = ring[i]![1], xj = ring[j]![0], yj = ring[j]![1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(x: number, y: number, geom: PlotGeometry): boolean {
  if (geom.type === 'Point') return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((rings) => pointInRing(x, y, rings[0]!) && !rings.slice(1).some((h) => pointInRing(x, y, h)));
}
