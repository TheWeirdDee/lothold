// Exact areas on the WGS 84 ellipsoid via authalic (equal-area) latitude.
// Replaces spherical approximations, which overstated plot areas by about 0.4 % near 6°N
// (measured against pyproj.Geod; see scripts/gis-crosscheck.py).
const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;

/** Snyder's q(φ): proportional to the ellipsoidal area between the equator and latitude φ. */
function q(phi: number): number {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
}
const QP = q(Math.PI / 2);
/** Radius of the sphere with the same surface area as the ellipsoid. */
export const AUTHALIC_RADIUS = A * Math.sqrt(QP / 2);

/** Area (m²) of the cell bounded by two meridians dLonDeg apart and the parallels latSouth/latNorth. */
export function cellAreaM2(latSouthDeg: number, latNorthDeg: number, dLonDeg: number): number {
  return ((A * A) / 2) * dLonDeg * RAD * (q(latNorthDeg * RAD) - q(latSouthDeg * RAD));
}

/** Authalic latitude (radians) of a geodetic latitude in degrees. */
function authalic(latDeg: number): number {
  return Math.asin(Math.max(-1, Math.min(1, q(latDeg * RAD) / QP)));
}

/** Absolute area (m²) of one lon/lat ring, computed on the authalic sphere (equal-area mapping of WGS 84). */
export function ringAreaM2(ring: [number, number][]): number {
  const n = ring.length;
  if (n < 4) return 0;
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const p1 = ring[i]!;
    const p2 = ring[(i + 1) % (n - 1)]!;
    const p3 = ring[(i + 2) % (n - 1)]!;
    total += (p3[0] - p1[0]) * RAD * Math.sin(authalic(p2[1]));
  }
  return Math.abs((total * AUTHALIC_RADIUS * AUTHALIC_RADIUS) / 2);
}
