// Renders the exact 30 m dataset pixels that were sampled for a plot, coloured by their analysed class,
// with the submitted boundary drawn on top. Nothing here is a basemap or decorative imagery.
type Grid = { width: number; height: number; west: number; north: number; pixelDeg: number; classes: string };
type Geometry = { type: string; coordinates: any };

export const PIXEL_CLASSES: { id: number; label: string; color: string; pattern?: boolean }[] = [
  { id: 6, label: 'Loss 2021–2025 on land mapped as forest in 2020 (JRC)', color: '#b64436' },
  { id: 7, label: 'Loss 2021–2025, not mapped as forest in 2020', color: '#d98a3a' },
  { id: 5, label: 'Loss 2001–2020 (before cut-off, context only)', color: '#c8b48f' },
  { id: 3, label: 'Forest in 2020 (JRC), no loss recorded', color: '#5f8f74' },
  { id: 4, label: 'Not forest in 2020 (JRC), no loss recorded', color: '#e7e2d3' },
  { id: 2, label: 'Water (Hansen data mask)', color: '#9fb9cc' },
  { id: 1, label: 'No data — no usable observation', color: '#cfcfcf', pattern: true },
];

function decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function PixelMap({ grid, geometry, label }: { grid: Grid; geometry: Geometry | null; label: string }) {
  const cls = decode(grid.classes);
  const { width: w, height: h } = grid;
  // Build one path per class from horizontal runs (keeps the SVG small).
  const paths: Record<number, string> = {};
  for (let r = 0; r < h; r++) {
    let c = 0;
    while (c < w) {
      const v = cls[r * w + c]!;
      let e = c + 1;
      while (e < w && cls[r * w + e] === v) e++;
      if (v !== 0) paths[v] = (paths[v] ?? '') + `M${c} ${r}h${e - c}v1h${-(e - c)}z`;
      c = e;
    }
  }
  const toPx = ([lon, lat]: [number, number]) => `${((lon - grid.west) / grid.pixelDeg).toFixed(3)},${((grid.north - lat) / grid.pixelDeg).toFixed(3)}`;
  const rings: [number, number][][] = !geometry ? [] : geometry.type === 'Polygon' ? geometry.coordinates : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : [];
  const point = geometry?.type === 'Point' ? (geometry.coordinates as [number, number]) : null;
  const midLat = grid.north - (h * grid.pixelDeg) / 2;
  const pxMetres = grid.pixelDeg * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const scalePx = Math.max(1, Math.round(100 / pxMetres) || 1);
  const scaleM = Math.round(scalePx * pxMetres);
  const pad = Math.max(1, Math.round(Math.max(w, h) * 0.04));
  const used = new Set(Object.keys(paths).map(Number));
  return (
    <figure className="mapbox" style={{ margin: 0 }}>
      <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2 + 4}`} role="img" aria-label={`${label}: ${w} by ${h} dataset pixels with plot boundary`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="nodata" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="2" fill="#e6e6e6" />
            <line x1="0" y1="0" x2="0" y2="2" stroke="#a0a0a0" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={w} height={h} fill="#f8f7f3" stroke="#d9d6cc" strokeWidth={Math.max(w, h) / 400} />
        {PIXEL_CLASSES.map((pc) =>
          paths[pc.id] ? <path key={pc.id} d={paths[pc.id]} fill={pc.pattern ? 'url(#nodata)' : pc.color} shapeRendering="crispEdges" /> : null,
        )}
        {rings.map((ring, i) => (
          <polygon key={i} points={ring.map(toPx).join(' ')} fill="none" stroke="#1d2924" strokeWidth={Math.max(0.25, Math.max(w, h) / 160)} strokeLinejoin="round" />
        ))}
        {point && <circle cx={(point[0] - grid.west) / grid.pixelDeg} cy={(grid.north - point[1]) / grid.pixelDeg} r={Math.max(0.6, Math.max(w, h) / 60)} fill="none" stroke="#1d2924" strokeWidth={Math.max(0.25, Math.max(w, h) / 160)} />}
        <g transform={`translate(0 ${h + 1.5})`}>
          <rect width={scalePx} height={Math.max(0.4, h / 120)} fill="#1d2924" />
          <text x={scalePx + 1} y={Math.max(1.2, h / 50)} fontSize={Math.max(1.6, Math.max(w, h) / 28)} fill="#3a4640" fontFamily="IBM Plex Sans, sans-serif">
            {scaleM} m
          </text>
        </g>
      </svg>
      <figcaption>
        <div className="map-legend">
          {PIXEL_CLASSES.filter((pc) => used.has(pc.id)).map((pc) => (
            <span key={pc.id}>
              <i style={{ background: pc.pattern ? 'repeating-linear-gradient(45deg,#e6e6e6,#e6e6e6 2px,#a0a0a0 2px,#a0a0a0 3px)' : pc.color }} />
              {pc.label}
            </span>
          ))}
          <span>
            <i style={{ background: 'transparent', border: '2px solid #1d2924' }} />
            Boundary as submitted (source document)
          </span>
        </div>
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          Each cell is one 30 m Hansen pixel whose centre falls inside the boundary (Hansen GFC v1.13 annual loss 2001–2025; JRC GFC2020 V4 forest 2020). Cells outside the boundary are not drawn. A recorded loss can reflect clearing, fire, replanting or map error.
        </p>
      </figcaption>
    </figure>
  );
}
